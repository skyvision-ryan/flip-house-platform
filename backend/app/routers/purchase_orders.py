"""KAN-54: permission-scoped, versioned orders rooted in project procurement rows."""
from datetime import datetime
from hashlib import sha256
import json
import re
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from pydantic import Field, ValidationError
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..purchase_orders import OrderDocument, Receipt, Record, order_label, order_summary, parse_order_text, vendor_key
from .common import allowed, log_update, require, require_user
from .procurement import _access
from ..procurement_workflow import require_purchase_assigned

router = APIRouter(prefix="/api", tags=["purchase-orders"])


class SaveOrder(Record):
    request_key: UUID
    expected_version: int | None = Field(default=None, ge=1)
    document: OrderDocument
    source_text: str = Field(default="", max_length=40000)
    note: str = Field(default="", max_length=2000)


class ImportOrder(Record):
    text: str = Field(min_length=1, max_length=40000)


class ReceiveOrder(Record):
    request_key: UUID
    expected_version: int = Field(ge=1)
    receipt: Receipt


class VoidReceipt(Record):
    request_key: UUID
    expected_version: int = Field(ge=1)
    reason: str = Field(min_length=1, max_length=1000)


def _hash(value):
    return sha256(json.dumps(jsonable_encoder(value), sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _keys(doc):
    vendor = vendor_key(doc.vendor)
    number = re.sub(r"\s+", "", doc.order_number).casefold()
    if not vendor or not number:
        raise HTTPException(422, "请填写可识别的商家和订单号；线下购买可使用收据编号")
    return vendor, number


def _order(db, oid, me, *, read_only=False):
    order = db.get(models.PurchaseOrder, oid)
    if order is None: raise HTTPException(404, "订单不存在")
    _access(db, order.project_id, me, me.role_code, read_only=read_only)
    return order


def _validate(db, pid, doc):
    material_ids = {line.material_id for line in doc.lines}
    found = set(db.scalars(select(models.ProcurementItem.id).where(models.ProcurementItem.project_id == pid,
                                                                  models.ProcurementItem.id.in_(material_ids))).all())
    if material_ids != found:
        raise HTTPException(422, "每件商品必须关联本房采购表中的材料，不能跨房关联")
    if doc.buyer_user_id is not None:
        buyer = db.get(models.User, doc.buyer_user_id)
        if not buyer or not buyer.active:
            raise HTTPException(422, "采购负责人账号无效")
        _access(db, pid, buyer, buyer.role_code)
    summary = order_summary(doc)
    if summary["difference"] and not doc.reconciliation_note:
        raise HTTPException(422, "订单金额与明细不一致，请修正或填写差额原因后保存为待核对记录")


def _result(db, order, *, history=False):
    doc = OrderDocument.model_validate_json(order.document)
    user = db.get(models.User, order.updated_by)
    project = db.get(models.Project, order.project_id)
    result = {"id": order.id, "project_id": order.project_id, "project_name": project.name,
              "version": order.version, "document": doc.model_dump(mode="json"),
              "summary": jsonable_encoder(order_summary(doc)), "created_at": order.created_at, "updated_at": order.updated_at,
              "updated_by": user.display_name if user else "已停用账号"}
    if history:
        result["events"] = [{"version": e.version, "kind": e.kind,
                             "actor": db.get(models.User, e.actor_id).display_name,
                             "created_at": e.created_at, **json.loads(e.snapshot)}
                            for e in db.scalars(select(models.PurchaseOrderEvent).where(
                                models.PurchaseOrderEvent.order_id == order.id).order_by(models.PurchaseOrderEvent.version.desc())).all()]
    return result


def _retry(db, key, fingerprint, me, order_id=None):
    event = db.scalar(select(models.PurchaseOrderEvent).where(models.PurchaseOrderEvent.request_key == str(key)))
    if event:
        order = _order(db, event.order_id, me)
        if event.actor_id != me.id or event.fingerprint != fingerprint or (order_id is not None and order.id != order_id):
            raise HTTPException(409, "请求键已被其他操作使用，请重新载入后重试")
        return _result(db, order, history=True)


def _write(db, order, doc, me, key, fingerprint, version, kind, source="", note=""):
    _validate(db, order.project_id, doc)
    vendor, number = _keys(doc)
    now = datetime.now().isoformat(timespec="microseconds")
    try:
        if version is not None:
            changed = db.execute(update(models.PurchaseOrder).where(models.PurchaseOrder.id == order.id,
                models.PurchaseOrder.version == version).values(document=doc.model_dump_json(), version=version + 1,
                vendor_key=vendor, number_key=number, updated_by=me.id, updated_at=now)
                .execution_options(synchronize_session=False))
            if changed.rowcount != 1:
                db.rollback()
                raise HTTPException(409, "订单刚被同事修改。输入已保留，请重新载入核对后保存")
            next_version = version + 1
        else:
            order.document = doc.model_dump_json()
            order.vendor_key, order.number_key = vendor, number
            order.version = 1
            db.add(order); db.flush(); next_version = 1
        db.add(models.PurchaseOrderEvent(order_id=order.id, version=next_version, request_key=str(key),
            fingerprint=fingerprint, kind=kind, actor_id=me.id,
            snapshot=json.dumps({"document": doc.model_dump(mode="json"), "source_text": source, "note": note}, ensure_ascii=False)))
        log_update(db, order.project_id, me.role_code, "procurement", f"{me.display_name} {kind}：{order_label(doc)}")
        db.commit()
    except IntegrityError:
        db.rollback()
        retry = _retry(db, key, fingerprint, me)
        if retry: return retry
        raise HTTPException(409, "此商家订单号已有记录。请打开原订单核对；一个订单只能归属一套房")
    db.expire_all()
    return _result(db, db.get(models.PurchaseOrder, order.id), history=True)


@router.get("/purchase-orders")
def list_orders(project_id: int | None = None, db: Session = Depends(get_db), me=Depends(require_user)):
    require(me.role_code, "procurement_read", what="查看采购订单")
    query = select(models.PurchaseOrder)
    if project_id is not None:
        _access(db, project_id, me, me.role_code, read_only=True)
        query = query.where(models.PurchaseOrder.project_id == project_id)
    elif not me.is_admin and not allowed(me.role_code, "workbench_all_projects"):
        query = query.where(models.PurchaseOrder.project_id.in_(select(models.ProjectMember.project_id).where(
            models.ProjectMember.user_id == me.id, models.ProjectMember.active.is_(True))))
    return [_result(db, order) for order in db.scalars(query.order_by(models.PurchaseOrder.updated_at.desc())).all()]


@router.get("/purchase-orders/{order_id}")
def get_order(order_id: int, db: Session = Depends(get_db), me=Depends(require_user)):
    return _result(db, _order(db, order_id, me, read_only=True), history=True)


@router.post("/projects/{project_id}/purchase-orders/preview")
def preview(project_id: int, body: ImportOrder, db: Session = Depends(get_db), me=Depends(require_user)):
    _access(db, project_id, me, me.role_code)
    result = parse_order_text(body.text)
    draft = result["draft"]
    material_rows = db.scalars(select(models.ProcurementItem).where(models.ProcurementItem.project_id == project_id)).all()
    for line in draft["lines"]:
        # Suggest only an unambiguous exact material name, never merge similar nodes.
        matches = [m.id for m in material_rows if m.name == line["name"]]
        if len(matches) == 1: line["material_id"] = matches[0]
    result["existing_order_id"] = None
    if draft["vendor"] and draft["order_number"]:
        existing = db.scalar(select(models.PurchaseOrder).where(models.PurchaseOrder.vendor_key == vendor_key(draft["vendor"]),
            models.PurchaseOrder.number_key == re.sub(r"\s+", "", draft["order_number"]).casefold()))
        if existing:
            if existing.project_id == project_id: result["existing_order_id"] = existing.id
            else: result["warnings"].append("此商家订单号已登记在其他房屋，请核实归属后继续；不能跨房重复建立。")
    return result


@router.post("/projects/{project_id}/purchase-orders", status_code=201)
def create_order(project_id: int, body: SaveOrder, db: Session = Depends(get_db), me=Depends(require_user)):
    _access(db, project_id, me, me.role_code)
    fingerprint = _hash({"project_id": project_id, **body.model_dump(mode="json")})
    retry = _retry(db, body.request_key, fingerprint, me)
    if retry: return retry
    require_purchase_assigned(db, project_id)
    if body.document.receipts or body.document.adjustments:
        raise HTTPException(422, "请先保存订单，再登记实际收货或退货退款")
    if body.expected_version is not None: raise HTTPException(422, "新订单不应携带旧版本")
    order = models.PurchaseOrder(project_id=project_id, request_key=str(body.request_key), fingerprint=fingerprint,
                                 created_by=me.id, updated_by=me.id)
    return _write(db, order, body.document, me, body.request_key, fingerprint, None, "建立订单", body.source_text, body.note)


@router.put("/purchase-orders/{order_id}")
def save_order(order_id: int, body: SaveOrder, db: Session = Depends(get_db), me=Depends(require_user)):
    order = _order(db, order_id, me)
    fingerprint = _hash(body.model_dump(mode="json"))
    retry = _retry(db, body.request_key, fingerprint, me, order_id)
    if retry: return retry
    if body.expected_version is None: raise HTTPException(422, "缺少订单版本，请重新载入")
    old = OrderDocument.model_validate_json(order.document)
    if body.document.receipts != old.receipts:
        raise HTTPException(422, "实际收货只能通过收货登记或撤销登记修改")
    new_lines = {line.id: line for line in body.document.lines}
    for line in old.lines:
        if any(any(a.line_id == line.id for a in r.lines) for r in old.receipts):
            if line.id not in new_lines or new_lines[line.id].material_id != line.material_id:
                raise HTTPException(422, "已有收货历史的商品不能移除或改绑采购项")
    if body.document.adjustments[:len(old.adjustments)] != old.adjustments:
        raise HTTPException(422, "已有退货退款记录不能覆盖，请保留历史")
    return _write(db, order, body.document, me, body.request_key, fingerprint, body.expected_version,
                  "更新订单", body.source_text, body.note)


@router.post("/purchase-orders/{order_id}/receipts")
def receive_order(order_id: int, body: ReceiveOrder, db: Session = Depends(get_db), me=Depends(require_user)):
    order = _order(db, order_id, me)
    fingerprint = _hash(body.model_dump(mode="json"))
    retry = _retry(db, body.request_key, fingerprint, me, order_id)
    if retry: return retry
    record = body.receipt.model_copy(update={"confirmed_by": me.id, "confirmed_name": me.display_name,
                                           "recorded_at": datetime.now().isoformat(), "void_reason": ""})
    data = json.loads(order.document); data["receipts"].append(record.model_dump(mode="json"))
    try: doc = OrderDocument.model_validate(data)
    except ValidationError as e: raise HTTPException(422, str(e.errors()[0]["msg"]))
    return _write(db, order, doc, me, body.request_key, fingerprint, body.expected_version, "确认收货", note=record.note)


@router.post("/purchase-orders/{order_id}/receipts/{receipt_id}/void")
def void_receipt(order_id: int, receipt_id: str, body: VoidReceipt, db: Session = Depends(get_db), me=Depends(require_user)):
    order = _order(db, order_id, me)
    fingerprint = _hash({"receipt_id": receipt_id, **body.model_dump(mode="json")})
    retry = _retry(db, body.request_key, fingerprint, me, order_id)
    if retry: return retry
    data = json.loads(order.document)
    receipt = next((r for r in data["receipts"] if r["id"] == receipt_id), None)
    if receipt is None: raise HTTPException(404, "收货记录不存在")
    if receipt["void_reason"]: raise HTTPException(409, "该收货记录已撤销")
    receipt["void_reason"] = body.reason
    try: doc = OrderDocument.model_validate(data)
    except ValidationError as e: raise HTTPException(422, str(e.errors()[0]["msg"]))
    return _write(db, order, doc, me, body.request_key, fingerprint, body.expected_version, "撤销收货登记", note=body.reason)
