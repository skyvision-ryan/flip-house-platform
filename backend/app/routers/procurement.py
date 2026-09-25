"""采购清单：按节点波次管理选型 / 下单 / 到货 / 异常。"""

from datetime import datetime
from io import BytesIO
from pathlib import Path
import warnings
from uuid import uuid4
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .. import models, schemas
from ..db import UPLOAD_DIR, get_db
from ..auth import current_user
from ..dictionaries import PROCUREMENT_STATUSES, PROCUREMENT_TEMPLATE, PROCUREMENT_WAVES
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


def ensure_procurement(db: Session, project_id: int, *, commit: bool = True) -> list[models.ProcurementItem]:
    """按模板灌入行（建项目 / 初始化接口 / seed 用）；已有则原样返回。不在 GET 里调。"""
    rows = list(db.scalars(select(models.ProcurementItem).where(models.ProcurementItem.project_id == project_id).order_by(models.ProcurementItem.sort_order, models.ProcurementItem.id)).all())
    if rows:
        return rows
    for i, t in enumerate(PROCUREMENT_TEMPLATE):
        db.add(models.ProcurementItem(project_id=project_id, wave=t["wave"], name=t["name"], status="pending_spec", sort_order=i))
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


def _access(db: Session, project_id: int, user: Optional[models.User], actor: str):
    require(actor, "procurement", what="操作项目采购")
    project = _project(db, project_id)
    if user is not None:
        # A demo role selector cannot widen an actual account's access.
        require(user.role_code, "procurement", what="操作项目采购")
        if not user.is_admin and not allowed(user.role_code, "workbench_all_projects"):
            member = db.scalar(select(models.ProjectMember.id).where(
                models.ProjectMember.project_id == project_id,
                models.ProjectMember.user_id == user.id, models.ProjectMember.active.is_(True)))
            if member is None:
                raise HTTPException(403, "你不是本项目的有效成员，不能查看或修改采购明细")
    return project


def _payload(db, project_id):
    rows = _rows(db, project_id)
    return schemas.ProcurementListOut(items=rows, summary=_summary(rows), template_missing=not rows)


def _validated(data, project, row=None):
    data = dict(data)
    for key in ("ordered_on", "expected_on", "received_on", "product_url", "order_url", "tracking_url"):
        if data.get(key) is not None:
            data[key] = str(data[key])
    for key in ("name", "note", "delivery_address", "specification", "retailer", "order_number", "carrier", "tracking_number", "follow_up"):
        if key in data and isinstance(data[key], str):
            data[key] = data[key].strip() or None
    if "name" in data and not data["name"]:
        raise HTTPException(422, "材料名称不能为空")
    if "wave" in data and data["wave"] not in {w["value"] for w in PROCUREMENT_WAVES}:
        raise HTTPException(422, "未知采购节点")
    if "status" in data and data["status"] not in _STATUS_OK:
        raise HTTPException(400, "未知采购状态")
    def resulting(key):
        return data.get(key, getattr(row, key, None))
    for key in ("expected_on", "received_on"):
        if resulting(key) and resulting("ordered_on") and resulting(key) < resulting("ordered_on"):
            raise HTTPException(422, "预计或实际到货日期不能早于下单日期")
    if "delivery_type" in data:
        if data["delivery_type"] == "project":
            data["delivery_address"] = project.property.address_std
        elif data["delivery_type"] is None:
            data["delivery_address"] = None
        elif row and data["delivery_type"] != row.delivery_type and "delivery_address" not in data:
            data["delivery_address"] = None
    if "delivery_address" in data and resulting("delivery_type") == "project":
        data["delivery_address"] = project.property.address_std
    if resulting("delivery_type") == "custom" and not resulting("delivery_address"):
        raise HTTPException(422, "请填写自定义收货地址")
    if "delivery_address" in data and resulting("delivery_type") is None and data["delivery_address"]:
        raise HTTPException(422, "请先选择收货地点")
    return data


@router.get("/me/procurement-tracking", response_model=schemas.ProcurementTrackingOut)
def procurement_tracking(db: Session = Depends(get_db), me: models.User = Depends(require_user)):
    require(me.role_code, "procurement", what="查看采购订单跟进")
    projects = select(models.Project)
    if not me.is_admin and not allowed(me.role_code, "workbench_all_projects"):
        projects = projects.where(models.Project.id.in_(select(models.ProjectMember.project_id).where(
            models.ProjectMember.user_id == me.id, models.ProjectMember.active.is_(True))))
    scoped_projects = db.scalars(projects.order_by(models.Project.id)).all()
    visible = {p.id: p.name for p in scoped_projects}
    rows = db.scalars(select(models.ProcurementItem).where(models.ProcurementItem.project_id.in_(visible))
                      .order_by(models.ProcurementItem.project_id, models.ProcurementItem.sort_order, models.ProcurementItem.id)).all()
    return {"projects": [{"id": p.id, "name": p.name, "address": p.property.address_std} for p in scoped_projects],
            "items": [{**schemas.ProcurementItemOut.model_validate(row).model_dump(), "project_name": visible[row.project_id]} for row in rows], "source": "manual"}


@router.get("/projects/{project_id}/procurement", response_model=schemas.ProcurementListOut)
def list_procurement(project_id: int, request: Request, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    _access(db, project_id, current_user(request, db), actor)
    return _payload(db, project_id)


@router.post("/projects/{project_id}/procurement/init", response_model=schemas.ProcurementListOut)
def init_procurement(project_id: int, db: Session = Depends(get_db), me: models.User = Depends(require_user)):
    _access(db, project_id, me, me.role_code)
    had = bool(_rows(db, project_id))
    rows = ensure_procurement(db, project_id, commit=False)
    if not had:
        log_update(db, project_id, me.role_code, "procurement", f"按采购表模板建了 {len(rows)} 行采购清单")
    db.commit()
    return _payload(db, project_id)


@router.post("/projects/{project_id}/procurement", response_model=schemas.ProcurementListOut, status_code=201)
def create_procurement(project_id: int, body: schemas.ProcurementCreateIn, db: Session = Depends(get_db), me: models.User = Depends(require_user)):
    project = _access(db, project_id, me, me.role_code)
    data = _validated(body.model_dump(exclude_unset=True), project)
    wave = data.pop("wave", "other")
    row = models.ProcurementItem(project_id=project_id, **data, wave=wave,
        sort_order=max((i.sort_order for i in _rows(db, project_id)), default=-1) + 1,
        updated_by=me.display_name, updated_by_user_id=me.id)
    db.add(row)
    log_update(db, project_id, me.role_code, "procurement", f"{me.display_name} 新增采购材料「{row.name}」（待选型）")
    db.commit()
    payload = _payload(db, project_id)
    payload.created_item_id = row.id
    return payload


@router.patch("/procurement/{item_id}", response_model=schemas.ProcurementListOut)
def patch_procurement(item_id: int, body: schemas.ProcurementPatchIn, db: Session = Depends(get_db), me: models.User = Depends(require_user)):
    row = db.get(models.ProcurementItem, item_id)
    if not row:
        raise HTTPException(404, "采购项不存在")
    project = _access(db, row.project_id, me, me.role_code)
    data = body.model_dump(exclude_unset=True)
    expected = data.pop("expected_updated_at", None)
    mark_checked = data.pop("mark_checked", False)
    data = _validated(data, project, row)
    if mark_checked:
        data.update(checked_at=datetime.now().isoformat(timespec="seconds"), checked_by_user_id=me.id)
    if not data:
        return _payload(db, row.project_id)
    data.update(updated_by=me.display_name, updated_by_user_id=me.id,
                updated_at=datetime.now().isoformat(timespec="microseconds"))
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
    _access(db, row.project_id, current_user(request, db), actor)
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
