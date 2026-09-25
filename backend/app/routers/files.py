import re
import shutil
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..db import UPLOAD_DIR, get_db
from ..dictionaries import FILE_DEFAULT_OWNER, FILE_TYPES, MONEY_DOCS, STEP_BY_KEY, tier_of
from .common import allowed, can_read_money, get_actor, log_update

router = APIRouter(prefix="/api", tags=["files"])

STAGE_OF_TYPE = {t["value"]: t["stage"] for t in FILE_TYPES}
FILE_TYPES_LABEL = {t["value"]: t["label"] for t in FILE_TYPES}


def _can_touch(actor: str, doc_type: str | None, step_key: str | None, uploaded_by: str | None = None) -> bool:
    """紫蓝随便传；青灰只能传自己那一步的东西（按 step 的负责人或文件类型的默认上传人）。"""
    if allowed(actor, "upload_any") or uploaded_by == actor:
        return True
    # 新职责角色只继承对应交付能力；不替换旧字母代号、不继承 D/J 或统筹权限。
    if actor == "Permit/设计":
        owners = {"Z", "设计师"}
        return bool(owners.intersection(STEP_BY_KEY.get(step_key or "", {}).get("owners", []))) or FILE_DEFAULT_OWNER.get(doc_type or "") in owners
    if actor == "项目助理":
        return doc_type == "insurance"
    if actor == "财务" and doc_type == "invoice":
        return True
    if step_key and actor in STEP_BY_KEY.get(step_key, {}).get("owners", []):
        return True
    return tier_of(actor) == "teal" and FILE_DEFAULT_OWNER.get(doc_type or "other") == actor


def _out(rec: models.ProjectFile, actor: str) -> schemas.FileOut:
    """不能看钱的身份，金额抹掉。"""
    o = schemas.FileOut.model_validate(rec)
    if not can_read_money(actor):
        o.amount = None
    return o


def _can_download(actor: str, rec: models.ProjectFile) -> bool:
    if can_read_money(actor):
        return True
    if rec.uploaded_by == actor:
        return True
    is_photo = (rec.mime or "").startswith("image/")
    if tier_of(actor) == "grey":
        return is_photo
    return rec.doc_type not in MONEY_DOCS


def _safe(name: str) -> str:
    return re.sub(r"[^\w.\-一-鿿]+", "_", name)[:120] or "file"


@router.get("/projects/{project_id}/files", response_model=list[schemas.FileOut])
def list_files(project_id: int, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    rows = db.scalars(select(models.ProjectFile).where(models.ProjectFile.project_id == project_id)
                      .order_by(models.ProjectFile.uploaded_at.desc())).all()
    if tier_of(actor) == "grey":
        # 外部人员只看照片和自己传的
        rows = [f for f in rows if (f.mime or "").startswith("image/") or f.uploaded_by == actor]
    return [_out(f, actor) for f in rows]


@router.post("/projects/{project_id}/files", response_model=schemas.FileOut, status_code=201)
async def upload(project_id: int, file: UploadFile = File(...), doc_type: Optional[str] = Form(None),
                 doc_date: Optional[str] = Form(None), counterparty: Optional[str] = Form(None),
                 amount: Optional[float] = Form(None), uploaded_by: Optional[str] = Form(None),
                 expires_at: Optional[str] = Form(None), step_key: Optional[str] = Form(None),
                 db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    if not db.get(models.Project, project_id):
        raise HTTPException(404, "项目不存在")
    if step_key and step_key not in STEP_BY_KEY:
        raise HTTPException(400, "未知清单项")
    if not _can_touch(actor, doc_type, step_key):
        raise HTTPException(403, f"{actor} 不能传这类文件，只能交自己那一步的东西")
    if uploaded_by and uploaded_by != actor and not allowed(actor, "upload_any"):
        uploaded_by = actor  # 只有紫蓝能代别人登记上传人
    folder = UPLOAD_DIR / str(project_id)
    folder.mkdir(parents=True, exist_ok=True)
    rec = models.ProjectFile(project_id=project_id, filename=file.filename or "file", stored_path="",
                             mime=file.content_type, doc_type=doc_type or "other",
                             stage=STAGE_OF_TYPE.get(doc_type or "other"), doc_date=doc_date,
                             counterparty=counterparty, amount=amount, source="upload", expires_at=expires_at or None, step_key=step_key or None,
                             uploaded_by=uploaded_by or (actor if actor != "负责人" else FILE_DEFAULT_OWNER.get(doc_type or "other", actor)))
    db.add(rec)
    db.flush()
    target = folder / f"{rec.id}_{_safe(rec.filename)}"
    with target.open("wb") as fh:
        shutil.copyfileobj(file.file, fh)
    rec.stored_path = str(target)
    rec.size = target.stat().st_size
    step_title = STEP_BY_KEY[step_key]["title"] if step_key else None
    log_update(db, project_id, rec.uploaded_by or actor, "file", f"上传了{FILE_TYPES_LABEL.get(rec.doc_type, '文件')}：{rec.filename}" + (f"（“{step_title}”）" if step_title else ""))
    db.commit()
    db.refresh(rec)
    return _out(rec, actor)


@router.patch("/files/{file_id}", response_model=schemas.FileOut)
def patch_file(file_id: int, body: schemas.FilePatch, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    rec = db.get(models.ProjectFile, file_id)
    if not rec:
        raise HTTPException(404, "文件不存在")
    if not _can_touch(actor, rec.doc_type, rec.step_key, rec.uploaded_by):
        raise HTTPException(403, f"{actor} 不能改别人登记的文件")
    data = body.model_dump(exclude_unset=True)
    if not allowed(actor, "upload_any") and {"doc_type", "step_key", "uploaded_by"} & set(data):
        raise HTTPException(403, f"{actor} 不能改文件的类型、挂的步骤或上传人")
    for k, v in data.items():
        setattr(rec, k, v)
    if body.doc_type:
        rec.stage = STAGE_OF_TYPE.get(body.doc_type, rec.stage)
    log_update(db, rec.project_id, actor, "file", f"修改了文件登记：{rec.filename}")
    db.commit()
    db.refresh(rec)
    return _out(rec, actor)


@router.get("/files/{file_id}/download")
def download(file_id: int, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    rec = db.get(models.ProjectFile, file_id)
    if not rec:
        raise HTTPException(404, "文件不存在")
    if not _can_download(actor, rec):
        raise HTTPException(403, f"{actor} 不能下载这个文件")
    return FileResponse(rec.stored_path, filename=rec.filename, media_type=rec.mime or "application/octet-stream")


@router.delete("/files/{file_id}", status_code=204)
def delete_file(file_id: int, db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    rec = db.get(models.ProjectFile, file_id)
    if not rec:
        raise HTTPException(404, "文件不存在")
    if not _can_touch(actor, rec.doc_type, rec.step_key, rec.uploaded_by):
        raise HTTPException(403, f"{actor} 不能删别人的文件")
    log_update(db, rec.project_id, actor, "file", f"删掉了文件：{rec.filename}")
    try:
        import os
        os.remove(rec.stored_path)
    except OSError:
        pass
    db.delete(rec)
    db.commit()
