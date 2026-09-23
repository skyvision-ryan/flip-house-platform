"""登录、当前用户、用户管理（管理员）。"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..auth import clear_session, current_user, hash_password, set_session, verify_password
from ..db import get_db
from ..dictionaries import ROLE_BY_CODE, TIERS, tier_of
from ..models import now_iso
from ..settings import DEMO_MODE

router = APIRouter(prefix="/api", tags=["auth"])


class LoginIn(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str
    display_name: str
    role_code: str
    role_label: str
    tier: str
    tier_label: str
    is_admin: bool
    active: bool
    email: Optional[str] = None
    created_at: str
    last_login_at: Optional[str] = None


class MeOut(UserOut):
    demo_mode: bool


class UserIn(BaseModel):
    username: str
    display_name: str
    role_code: str
    password: str
    is_admin: bool = False
    email: Optional[str] = None


class UserPatch(BaseModel):
    display_name: Optional[str] = None
    role_code: Optional[str] = None
    is_admin: Optional[bool] = None
    active: Optional[bool] = None
    password: Optional[str] = None
    email: Optional[str] = None


def _clean_email(v: Optional[str]) -> Optional[str]:
    """只做最基本的形状检查；真正能不能收到，由邮件块的发送记录说话。"""
    v = (v or "").strip()
    if not v:
        return None
    if "@" not in v or v.startswith("@") or v.endswith("@") or " " in v:
        raise HTTPException(400, "邮箱格式不对")
    return v


def _out(u: models.User) -> dict:
    t = tier_of(u.role_code)
    return dict(
        id=u.id, username=u.username, display_name=u.display_name, role_code=u.role_code,
        role_label=ROLE_BY_CODE.get(u.role_code, {}).get("label", u.role_code),
        tier=t, tier_label=TIERS.get(t, {}).get("label", t),
        is_admin=u.is_admin, active=u.active, email=u.email, created_at=u.created_at, last_login_at=u.last_login_at,
    )


def _check_role(code: str) -> None:
    if code not in ROLE_BY_CODE:
        raise HTTPException(400, f"没有这个角色代号：{code}")


@router.post("/auth/login", response_model=MeOut)
def login(body: LoginIn, response: Response, db: Session = Depends(get_db)):
    u = db.scalar(select(models.User).where(models.User.username == body.username.strip()))
    if u is None or not u.active or not verify_password(body.password, u.password_hash):
        raise HTTPException(401, "账号或密码不对")
    u.last_login_at = now_iso()
    db.commit()
    set_session(response, u.id)
    return {**_out(u), "demo_mode": DEMO_MODE}


@router.post("/auth/logout")
def logout(response: Response):
    clear_session(response)
    return {"ok": True}


@router.get("/auth/me", response_model=MeOut)
def me(request: Request, db: Session = Depends(get_db)):
    u = current_user(request, db)
    if u is None:
        raise HTTPException(401, "还没登录")
    return {**_out(u), "demo_mode": DEMO_MODE}


@router.get("/auth/mode")
def mode(db: Session = Depends(get_db)):
    """登录页用：是否演示模式、系统里有没有账号。"""
    return {"demo_mode": DEMO_MODE, "has_users": db.query(models.User).count() > 0}


# ---------- 用户管理：只有管理员 ----------
def admin_user(request: Request, db: Session = Depends(get_db)) -> models.User:
    u = current_user(request, db)
    if u is None:
        raise HTTPException(401, "还没登录")
    if not u.is_admin:
        raise HTTPException(403, "只有管理员能管理用户")
    return u


@router.get("/users", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db), _: models.User = Depends(admin_user)):
    return [_out(u) for u in db.scalars(select(models.User).order_by(models.User.id)).all()]


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(body: UserIn, db: Session = Depends(get_db), _: models.User = Depends(admin_user)):
    name = body.username.strip()
    if not name:
        raise HTTPException(400, "账号不能为空")
    if len(body.password) < 6:
        raise HTTPException(400, "密码至少 6 位")
    _check_role(body.role_code)
    if db.scalar(select(models.User).where(models.User.username == name)):
        raise HTTPException(409, "账号已存在")
    u = models.User(username=name, display_name=body.display_name.strip() or name, role_code=body.role_code,
                    is_admin=body.is_admin, password_hash=hash_password(body.password), email=_clean_email(body.email))
    db.add(u)
    db.commit()
    db.refresh(u)
    return _out(u)


@router.patch("/users/{user_id}", response_model=UserOut)
def patch_user(user_id: int, body: UserPatch, db: Session = Depends(get_db), me_: models.User = Depends(admin_user)):
    u = db.get(models.User, user_id)
    if u is None:
        raise HTTPException(404, "用户不存在")
    if body.display_name is not None:
        u.display_name = body.display_name.strip() or u.username
    if body.role_code is not None:
        _check_role(body.role_code)
        u.role_code = body.role_code
    if body.is_admin is not None:
        if u.id == me_.id and not body.is_admin:
            raise HTTPException(400, "不能取消自己的管理员")
        u.is_admin = body.is_admin
    if body.active is not None:
        if u.id == me_.id and not body.active:
            raise HTTPException(400, "不能停用自己")
        u.active = body.active
    if body.password:
        if len(body.password) < 6:
            raise HTTPException(400, "密码至少 6 位")
        u.password_hash = hash_password(body.password)
    if "email" in body.model_fields_set:
        u.email = _clean_email(body.email)
    db.commit()
    db.refresh(u)
    return _out(u)
