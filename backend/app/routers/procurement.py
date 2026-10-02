"""采购清单：按节点波次管理选型 / 下单 / 到货 / 异常。"""

import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from io import BytesIO
from pathlib import Path
import warnings
from uuid import uuid4
from typing import Optional

from fastapi import Body, APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError
from sqlalchemy import select, update
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel, ConfigDict, Field
from fastapi.encoders import jsonable_encoder

from .. import models, schemas
from ..db import UPLOAD_DIR, get_db
from ..auth import current_user
from ..procurement_orders import order_material_projection, procurement_attention
from ..dictionaries import PROCUREMENT_STATUSES, PROCUREMENT_TEMPLATE, PROCUREMENT_WAVES
from ..message_codes import system_error
from .common import allowed, get_actor, log_update, require, require_user

router = APIRouter(prefix="/api", tags=["procurement"])

_STATUS_OK = {s["value"] for s in PROCUREMENT_STATUSES}


def _project(db: Session, project_id: int) -> models.Project:
    p = db.get(models.Project, project_id)
    if not p:
        raise HTTPException(404, "项目不存在")
    return p


def _rows(db: Session, project_id: int) -> list[models.ProcurementItem]:
    return list(db.scalars(select(models.ProcurementItem).where(models.ProcurementItem.project_id == project_id).order_by(models.ProcurementItem.sort_order, models.ProcurementItem.id)).all())


def ensure_procurement(db: Session, project_id: int, *, commit: bool = True, select_all: bool = False) -> list[models.ProcurementItem]:
    """按模板灌入行（建项目 / 初始化接口 / seed 用）；已有则原样返回。不在 GET 里调。"""
    rows = list(db.scalars(select(models.ProcurementItem).where(models.ProcurementItem.project_id == project_id).order_by(models.ProcurementItem.sort_order, models.ProcurementItem.id)).all())
    if rows:
        return rows
    for i, t in enumerate(PROCUREMENT_TEMPLATE):
        db.add(models.ProcurementItem(project_id=project_id, wave=t["wave"], name=t["name"], template_key=t.get("template_key"), template_name_snapshot=t["name"] if t.get("template_key") else None, status="pending_spec", sort_order=i,
                                      worklist_selected=True if select_all else None))
    db.commit() if commit else db.flush()
    return list(db.scalars(select(models.ProcurementItem).where(models.ProcurementItem.project_id == project_id).order_by(models.ProcurementItem.sort_order, models.ProcurementItem.id)).all())


def _summary(rows: list[models.ProcurementItem]) -> dict:
    counts = {s["value"]: 0 for s in PROCUREMENT_STATUSES}
    for r in rows:
        counts[r.status] = counts.get(r.status, 0) + 1
    return {
        "total": len(rows),
        "pending_spec": counts.get("pending_spec", 0),
        "pending_order": counts.get("pending_order", 0),
        "ordered": counts.get("ordered", 0),
        "received": counts.get("received", 0),
        "exception": counts.get("exception", 0),
        "na": counts.get("na", 0),
    }


def _access(db: Session, project_id: int, user: Optional[models.User], actor: str, *, read_only=False):
    permission = "procurement_read" if read_only else "procurement"
    require(actor, permission, what="操作项目采购")
    project = _project(db, project_id)
    if user is not None:
        # A demo role selector cannot widen an actual account's access.
        require(user.role_code, permission, what="操作项目采购")
        if not user.is_admin and not allowed(user.role_code, "workbench_all_projects"):
            member = db.scalar(select(models.ProjectMember.id).where(
                models.ProjectMember.project_id == project_id,
                models.ProjectMember.user_id == user.id, models.ProjectMember.active.is_(True)))
            if member is None:
                raise HTTPException(403, "你不是本项目的有效成员，不能查看或修改采购明细")
    if not read_only:
        from ..task_activity import observe_procurement
        observe_procurement(db, project_id, user)
    return project


def _in_worklist(row, projected, attention):
    # Existing purchases and actionable facts must never disappear through selection.
    if row.id in projected or attention[row.id]:
        return True
    if row.status == "na":
        return False
    if row.worklist_selected is not None:
        return row.worklist_selected
    # Preserve meaningful pre-existing work; untouched template rows stay in the picker.
    return row.status != "pending_spec" or any(getattr(row, field) is not None and getattr(row, field) != ""
        for field in ("note", "specification", "required_quantity", "quantity", "product_url", "needed_on",
                      "amount", "ordered_on", "expected_on", "retailer", "order_number")) or bool(row.images)


def _payload(db, project_id):
    rows = _rows(db, project_id)
    projected = order_material_projection(db, rows)
    attention = procurement_attention(rows, projected)
    items = [schemas.ProcurementItemOut.model_validate({**schemas.ProcurementItemOut.model_validate(r).model_dump(), **projected.get(r.id, {}), "attention_reasons": attention[r.id], "in_worklist": _in_worklist(r, projected, attention)}) for r in rows]
    return schemas.ProcurementListOut(items=items, summary=_summary(items), template_missing=not rows)


def _validated(data):
    data = dict(data)
    for key in ("needed_on", "product_url"):
        if data.get(key) is not None:
            data[key] = str(data[key])
    for key in ("name", "note", "specification", "unit", "use_location"):
        if key in data and isinstance(data[key], str):
            data[key] = data[key].strip() or None
    if "name" in data and not data["name"]:
        raise HTTPException(422, "材料名称不能为空")
    if "wave" in data and data["wave"] not in {w["value"] for w in PROCUREMENT_WAVES}:
        raise HTTPException(422, "未知采购节点")
    if "status" in data and data["status"] not in _STATUS_OK:
        raise HTTPException(400, "未知采购状态")
    return data


@router.get("/me/procurement-tracking", response_model=schemas.ProcurementTrackingOut)
def procurement_tracking(db: Session = Depends(get_db), me: models.User = Depends(require_user)):
    require(me.role_code, "procurement_read", what="查看采购订单跟进")
    projects = select(models.Project)
    if not me.is_admin and not allowed(me.role_code, "workbench_all_projects"):
        projects = projects.where(models.Project.id.in_(select(models.ProjectMember.project_id).where(
            models.ProjectMember.user_id == me.id, models.ProjectMember.active.is_(True))))
    scoped_projects = db.scalars(projects.order_by(models.Project.created_at.desc(), models.Project.id.desc())).all()
    visible = {p.id: p.name for p in scoped_projects}
    rows = db.scalars(select(models.ProcurementItem).where(models.ProcurementItem.project_id.in_(visible))
                      .order_by(models.ProcurementItem.project_id, models.ProcurementItem.sort_order, models.ProcurementItem.id)).all()
    projected = order_material_projection(db, rows)
    attention = procurement_attention(rows, projected)
    from .tasks import _tasks_payload
    tasks = []
    for project in scoped_projects:
        purchase = db.scalar(select(models.Task).where(models.Task.project_id == project.id, models.Task.step_key == "purchase"))
        if purchase:
            tasks.extend(_tasks_payload(db, project, [purchase], me.role_code))
    return {"tasks": tasks, "projects": [{"id": p.id, "name": p.name, "address": p.property.address_std} for p in scoped_projects],
            "items": [{**schemas.ProcurementItemOut.model_validate(row).model_dump(), **projected.get(row.id, {}), "attention_reasons": attention[row.id], "in_worklist": _in_worklist(row, projected, attention), "project_name": visible[row.project_id]} for row in rows], "source": "manual",
            "new_requirements": _new_requirements(db, me, rows, projected, visible), "arrivals": _arrivals(db, visible)}


def _new_requirements(db: Session, me: models.User, rows, projected, visible: dict) -> list[dict]:
    """Requirements colleagues added in the last 30 days that nobody has acted on: still pending_spec, no order. No read state is stored."""
    cutoff = (datetime.now() - timedelta(days=30)).isoformat(timespec="seconds")
    by_id = {row.id: row for row in rows}
    events = db.scalars(select(models.TaskEvent).where(models.TaskEvent.kind == "procurement_requirement_added",
        models.TaskEvent.project_id.in_(visible), models.TaskEvent.created_at >= cutoff).order_by(models.TaskEvent.created_at.desc(), models.TaskEvent.id.desc())).all()
    output, seen = [], set()
    for event in events:
        after = json.loads(event.after_json or "{}")
        row = by_id.get(after.get("item_id"))
        if row is None or row.id in seen or event.actor_user_id == me.id or row.status != "pending_spec" or row.id in projected:
            continue
        seen.add(row.id)
        actor = db.get(models.User, event.actor_user_id) if event.actor_user_id else None
        output.append({"item_id": row.id, "project_id": row.project_id, "project_name": visible[row.project_id], "name": row.name, "wave": row.wave,
                       "added_by": actor.display_name if actor else "", "added_at": event.created_at})
    return output


def _arrivals(db: Session, visible: dict) -> list[dict]:
    """Derived, unstored: outstanding lines and delivery batches whose estimated arrival is today or past (LA)."""
    from ..purchase_orders import OrderDocument, order_label, order_summary
    from decimal import Decimal
    today = datetime.now(ZoneInfo("America/Los_Angeles")).date()
    output = []
    for order in db.scalars(select(models.PurchaseOrder).where(models.PurchaseOrder.project_id.in_(visible))).all():
        doc = OrderDocument.model_validate_json(order.document)
        summary = order_summary(doc)
        facts = {line["id"]: line for line in summary["lines"]}
        base = {"order_id": order.id, "project_id": order.project_id, "project_name": visible[order.project_id], "order_title": order_label(doc)}
        for line in doc.lines:
            fact = facts[line.id]
            if line.quantity is not None and line.quantity <= line.cancelled_quantity: continue
            if not line.expected_on or line.expected_on > today or fact["remaining"] == 0: continue
            output.append({**base, "kind": "line", "line_id": line.id, "material_id": line.material_id, "name": line.name, "expected_on": line.expected_on.isoformat(),
                           "days_overdue": (today - line.expected_on).days, "remaining": None if fact["remaining"] is None else str(fact["remaining"]), "unit": line.unit, "tracking_url": str(line.tracking_url) if line.tracking_url else None})
        for delivery in doc.deliveries:
            if not delivery.expected_on or delivery.expected_on > today or not delivery.allocations: continue
            done = True
            for allocation in delivery.allocations:
                if facts.get(allocation.line_id, {}).get("remaining") == 0: continue
                received = sum((a.quantity for receipt in doc.receipts if not receipt.void_reason and receipt.delivery_id == delivery.id
                                for a in receipt.lines if a.line_id == allocation.line_id), Decimal(0))
                if received < allocation.quantity: done = False; break
            if done: continue
            first = next((l for l in doc.lines if l.id == delivery.allocations[0].line_id), None)
            output.append({**base, "kind": "delivery", "line_id": first.id if first else None, "material_id": first.material_id if first else None, "name": delivery.label, "expected_on": delivery.expected_on.isoformat(),
                           "days_overdue": (today - delivery.expected_on).days, "remaining": None, "unit": first.unit if first else "", "tracking_url": str(delivery.tracking_url) if delivery.tracking_url else None})
    output.sort(key=lambda a: (a["expected_on"], a["order_id"], a["name"]))
    return output


@router.get("/projects/{project_id}/procurement", response_model=schemas.ProcurementListOut)
def list_procurement(project_id: int, request: Request, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    _access(db, project_id, current_user(request, db), actor, read_only=True)
    return _payload(db, project_id)


@router.post("/projects/{project_id}/procurement/init", response_model=schemas.ProcurementListOut)
def init_procurement(project_id: int, body: dict | None = Body(default=None), db: Session = Depends(get_db), me: models.User = Depends(require_user)):
    _access(db, project_id, me, me.role_code)
    if body:
        raise HTTPException(422, "初始化清单不接收材料字段；采购需求请从材料接口维护，购买事实请通过订单管理记录")
    had = bool(_rows(db, project_id))
    rows = ensure_procurement(db, project_id, commit=False)
    if not had:
        log_update(db, project_id, me.role_code, "procurement", f"按采购表模板建了 {len(rows)} 行采购清单")
    db.commit()
    return _payload(db, project_id)


@router.post("/projects/{project_id}/procurement", response_model=schemas.ProcurementListOut, status_code=201)
def create_procurement(project_id: int, body: schemas.ProcurementCreateIn, db: Session = Depends(get_db), me: models.User = Depends(require_user)):
    _access(db, project_id, me, me.role_code)
    raw = body.model_dump(exclude_unset=True, exclude={"request_key"})
    fingerprint = json.dumps(jsonable_encoder(raw), sort_keys=True, ensure_ascii=False)
    def retry():
        prior = db.scalar(select(models.ProcurementRequest).where(models.ProcurementRequest.request_key == body.request_key))
        if prior:
            if prior.project_id != project_id or prior.actor_id != me.id or prior.body_json != fingerprint:
                raise HTTPException(409, "请求键已被其他新增操作使用")
            payload = _payload(db, project_id); payload.created_item_id = prior.item_id
            return payload
    if body.request_key:
        prior = retry()
        if prior: return prior
    data = _validated(raw)
    wave = data.pop("wave", "other")
    # Additional needs supplement the baseline, including on a not-yet-initialized project.
    rows = ensure_procurement(db, project_id, commit=False)
    row = models.ProcurementItem(project_id=project_id, **data, wave=wave, worklist_selected=True,
        sort_order=max((i.sort_order for i in rows), default=-1) + 1,
        updated_by=me.display_name, updated_by_user_id=me.id)
    db.add(row)
    reason = f"新增采购需求：{row.name}"
    try:
        db.flush()
        if body.request_key:
            db.add(models.ProcurementRequest(request_key=body.request_key, project_id=project_id,
                actor_id=me.id, body_json=fingerprint, item_id=row.id))
        from .tasks import _event
        purchase = db.scalar(select(models.Task).where(models.Task.project_id == project_id, models.Task.step_key == "purchase"))
        _event(db, purchase, project_id, "procurement_requirement_added", me, after={"item_id": row.id, "name": row.name, "wave": wave}, reason=reason)
        log_update(db, project_id, me.role_code, "procurement", reason)
        db.commit()
    except IntegrityError:
        db.rollback()
        if body.request_key:
            prior = retry()
            if prior: return prior
        raise HTTPException(409, "新增需求发生冲突，请重新载入后重试")
    payload = _payload(db, project_id)
    payload.created_item_id = row.id
    return payload


@router.patch("/procurement/{item_id}", response_model=schemas.ProcurementListOut)
def patch_procurement(item_id: int, body: schemas.ProcurementPatchIn, db: Session = Depends(get_db), me: models.User = Depends(require_user)):
    row = db.get(models.ProcurementItem, item_id)
    if not row:
        raise HTTPException(404, "采购项不存在")
    _access(db, row.project_id, me, me.role_code)
    data = body.model_dump(exclude_unset=True)
    expected = data.pop("expected_updated_at", None)
    if "status" in data and order_material_projection(db, [row]):
        raise HTTPException(409, "本项购买信息由关联订单自动更新，请在订单中修改或登记收货；无需重复维护材料状态")
    data = _validated(data)
    if not data:
        return _payload(db, row.project_id)
    if row.status == "na" and data.get("status") in {"pending_spec", "pending_order"}:
        data["worklist_selected"] = True  # Restoring an excluded need makes it actionable again.
    data.update(updated_by=me.display_name, updated_by_user_id=me.id,
                updated_at=datetime.now().isoformat(timespec="microseconds"))
    if "name" in data and data["name"] != row.name:
        data.update(template_key=None, template_name_snapshot=None)
    statement = update(models.ProcurementItem).where(models.ProcurementItem.id == item_id)
    if expected is not None:
        statement = statement.where(models.ProcurementItem.updated_at == expected)
    result = db.execute(statement.values(**data).execution_options(synchronize_session=False))
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "这项材料刚被同事修改，请重新载入后再保存；你的输入仍保留")
    log_update(db, row.project_id, me.role_code, "procurement", f"{me.display_name} 更新采购材料「{row.name}」")
    project_id = row.project_id
    db.commit()
    db.expire_all()
    return _payload(db, project_id)


_LEGACY_PURCHASE_FIELDS = ("retailer", "order_number", "amount", "ordered_on", "received_on")


@router.delete("/procurement/{item_id}", response_model=schemas.ProcurementListOut)
def delete_procurement(item_id: int, expected_updated_at: str = Query(min_length=1), db: Session = Depends(get_db), me: models.User = Depends(require_user)):
    """Hard delete of a mis-added requirement. Rows with orders, images or legacy purchase facts stay; use 本房不需要 to keep a reason."""
    row = db.get(models.ProcurementItem, item_id)
    if not row:
        raise HTTPException(404, "采购项不存在")
    _access(db, row.project_id, me, me.role_code)
    if row.id in order_material_projection(db, [row]):
        raise system_error(409, "server.procurement.row.has.orders")
    if row.images:
        raise system_error(409, "server.procurement.row.has.images")
    if any(getattr(row, field) not in (None, "") for field in _LEGACY_PURCHASE_FIELDS):
        raise system_error(409, "server.procurement.row.has.legacy.purchase")
    if row.updated_at != expected_updated_at:
        raise HTTPException(409, "这项材料刚被同事修改，请重新载入后再保存；你的输入仍保留")
    project_id, name = row.project_id, row.name
    from .tasks import _event
    purchase = db.scalar(select(models.Task).where(models.Task.project_id == project_id, models.Task.step_key == "purchase"))
    for request in db.scalars(select(models.ProcurementRequest).where(models.ProcurementRequest.item_id == row.id)).all():
        db.delete(request)
    db.delete(row)
    _event(db, purchase, project_id, "procurement_requirement_removed", me, after={"item_id": item_id, "name": name, "wave": row.wave},
           reason=f"{me.display_name} 删除采购需求「{name}」")
    log_update(db, project_id, me.role_code, "procurement", f"{me.display_name} 删除采购需求「{name}」")
    db.commit()
    db.expire_all()
    return _payload(db, project_id)


class NotNeededItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: int = Field(gt=0)
    updated_at: str = Field(min_length=1)


class WorklistItem(NotNeededItem):
    selected: bool


class WorklistSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[WorklistItem] = Field(min_length=1, max_length=200)


@router.post("/projects/{project_id}/procurement/worklist", response_model=schemas.ProcurementListOut)
def select_worklist(project_id: int, body: WorklistSelection, db: Session = Depends(get_db), me=Depends(require_user)):
    _access(db, project_id, me, me.role_code)
    from ..procurement_workflow import require_purchase_assigned
    require_purchase_assigned(db, project_id)
    ids = [item.id for item in body.items]
    if len(set(ids)) != len(ids): raise HTTPException(422, "采购项重复")
    rows = list(db.scalars(select(models.ProcurementItem).where(models.ProcurementItem.project_id == project_id, models.ProcurementItem.id.in_(ids))))
    if len(rows) != len(ids): raise HTTPException(422, "只能选择本房采购项")
    projected = order_material_projection(db, rows)
    attention = procurement_attention(rows, projected)
    for item in body.items:
        row = next(r for r in rows if r.id == item.id)
        if (not item.selected and (row.id in projected or attention[row.id])) or (item.selected and row.status == "na"):
            raise HTTPException(409, "已关联订单或需处理的材料保留在清单中；本房不需要项请先修改需求状态")
    now = datetime.now().isoformat(timespec="microseconds")
    for item in body.items:
        changed = db.execute(update(models.ProcurementItem).where(models.ProcurementItem.id == item.id,
            models.ProcurementItem.updated_at == item.updated_at).values(worklist_selected=item.selected,
            updated_by=me.display_name, updated_by_user_id=me.id, updated_at=now).execution_options(synchronize_session=False))
        if changed.rowcount != 1:
            db.rollback(); raise HTTPException(409, "材料刚被同事修改，整批未保存，请刷新后重试")
    log_update(db, project_id, me.role_code, "procurement", f"{me.display_name} 调整本次采购清单：{len(body.items)} 项")
    db.commit(); db.expire_all()
    return _payload(db, project_id)


class BulkNotNeeded(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[NotNeededItem] = Field(min_length=1, max_length=200)
    reason: str = Field(min_length=1, max_length=1000)


@router.post("/projects/{project_id}/procurement/not-needed", response_model=schemas.ProcurementListOut)
def not_needed(project_id: int, body: BulkNotNeeded, db: Session = Depends(get_db), me=Depends(require_user)):
    _access(db, project_id, me, me.role_code)
    if not body.reason.strip(): raise HTTPException(422, "请填写本房不需要这些材料的原因")
    ids = [item.id for item in body.items]
    if len(set(ids)) != len(ids): raise HTTPException(422, "采购项重复")
    rows = list(db.scalars(select(models.ProcurementItem).where(models.ProcurementItem.project_id == project_id, models.ProcurementItem.id.in_(ids))))
    if len(rows) != len(ids): raise HTTPException(422, "只能选择本房采购项")
    if order_material_projection(db, rows): raise HTTPException(409, "已关联订单的材料请先在订单处理取消或退货，不能直接标为不需要")
    now = datetime.now().isoformat(timespec="microseconds")
    for item in body.items:
        row = next(r for r in rows if r.id == item.id)
        changed = db.execute(update(models.ProcurementItem).where(models.ProcurementItem.id == row.id,
            models.ProcurementItem.updated_at == item.updated_at).values(status="na",
            note="；".join(filter(None, [row.note, "本房不需要：" + body.reason.strip()])), updated_by=me.display_name,
            updated_by_user_id=me.id, updated_at=now).execution_options(synchronize_session=False))
        if changed.rowcount != 1:
            db.rollback(); raise HTTPException(409, "材料刚被同事修改，整批未保存，请刷新后重试")
    log_update(db, project_id, me.role_code, "procurement", f"{me.display_name} 将 {len(rows)} 项标为本房不需要：{body.reason.strip()}")
    db.commit(); db.expire_all()
    return _payload(db, project_id)


_IMAGE_LIMIT = 8 * 1024 * 1024
_IMAGE_MIMES = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}


@router.post("/procurement/{item_id}/images", response_model=schemas.ProcurementImageOut, status_code=201)
async def upload_image(item_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), me: models.User = Depends(require_user)):
    row = db.get(models.ProcurementItem, item_id)
    if row is None:
        raise HTTPException(404, "采购项不存在")
    _access(db, row.project_id, me, me.role_code)
    if len(row.images) >= 12:
        raise HTTPException(422, "每件材料最多保留 12 张图片")
    content = await file.read(_IMAGE_LIMIT + 1)
    if len(content) > _IMAGE_LIMIT:
        raise HTTPException(413, "图片不能超过 8 MB")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(content)) as picture:
                mime = _IMAGE_MIMES.get(picture.format)
                if not mime or picture.width * picture.height > 25_000_000:
                    raise ValueError("unsupported image")
                picture.verify()
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(422, "请上传有效的 JPG、PNG 或 WebP 图片（不超过 2500 万像素）")
    folder = UPLOAD_DIR / "procurement" / str(row.project_id)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / uuid4().hex
    rec = models.ProcurementImage(item_id=item_id, filename=Path(file.filename or "image").name[:200],
        stored_path=str(path), mime=mime, size=len(content), uploaded_by_user_id=me.id)
    try:
        path.write_bytes(content)
        db.add(rec)
        log_update(db, row.project_id, me.role_code, "procurement", f"{me.display_name} 为「{row.name}」添加图片")
        db.commit()
    except Exception:
        db.rollback()
        path.unlink(missing_ok=True)
        raise
    return rec


@router.get("/procurement-images/{image_id}")
def read_image(image_id: int, request: Request, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    rec = db.get(models.ProcurementImage, image_id)
    row = db.get(models.ProcurementItem, rec.item_id) if rec else None
    if row is None:
        raise HTTPException(404, "图片不存在")
    _access(db, row.project_id, current_user(request, db), actor, read_only=True)
    if not Path(rec.stored_path).is_file():
        raise HTTPException(404, "图片文件不可用，请重新上传")
    return FileResponse(rec.stored_path, media_type=rec.mime, headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"})


@router.delete("/procurement-images/{image_id}", status_code=204)
def delete_image(image_id: int, db: Session = Depends(get_db), me: models.User = Depends(require_user)):
    rec = db.get(models.ProcurementImage, image_id)
    row = db.get(models.ProcurementItem, rec.item_id) if rec else None
    if row is None:
        raise HTTPException(404, "图片不存在")
    _access(db, row.project_id, me, me.role_code)
    path = Path(rec.stored_path)
    log_update(db, row.project_id, me.role_code, "procurement", f"{me.display_name} 移除「{row.name}」的图片")
    db.delete(rec)
    db.commit()
    path.unlink(missing_ok=True)
