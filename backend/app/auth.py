"""账号密码与会话：只用标准库，不加依赖。

密码：pbkdf2_hmac(sha256) + 随机盐，存成 "pbkdf2$迭代$盐$哈希"。
会话：cookie 里放 "用户id.过期时间戳.签名"，签名 = hmac(SECRET_KEY)。服务端不存会话表，改密码 / 停用靠查用户表。
"""

import hashlib
import hmac
import secrets
import time
from typing import Optional

from fastapi import Request, Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from . import models
from .settings import COOKIE_SECURE, SECRET_KEY, SESSION_DAYS

COOKIE_NAME = "session"
_ITER = 200_000


def normalize_email(value: str) -> str:
    return value.strip().lower()


def email_users(db: Session, email: str) -> list[models.User]:
    """兼容旧邮箱大小写和以邮箱作 username 的账号；歧义由调用方拒绝。"""
    email = normalize_email(email)
    return list(db.scalars(select(models.User).where(or_(
        func.lower(func.trim(models.User.email)) == email,
        func.lower(func.trim(models.User.username)) == email,
    ))).all())


def hash_password(pw: str) -> str:
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), _ITER).hex()
    return f"pbkdf2${_ITER}${salt}${h}"


def verify_password(pw: str, stored: str) -> bool:
    try:
        _, it, salt, h = stored.split("$")
        calc = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), int(it)).hex()
        return hmac.compare_digest(calc, h)
    except Exception:
        return False


def _sign(payload: str) -> str:
    return hmac.new(SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()


def make_token(user_id: int) -> str:
    payload = f"{user_id}.{int(time.time()) + SESSION_DAYS * 86400}"
    return f"{payload}.{_sign(payload)}"


def parse_token(token: Optional[str]) -> Optional[int]:
    """签名对且没过期就返回用户 id。"""
    if not token:
        return None
    try:
        uid, exp, sig = token.split(".")
        payload = f"{uid}.{exp}"
        if not hmac.compare_digest(_sign(payload), sig):
            return None
        if int(exp) < time.time():
            return None
        return int(uid)
    except Exception:
        return None


def current_user(request: Request, db: Session) -> Optional[models.User]:
    uid = parse_token(request.cookies.get(COOKIE_NAME))
    if uid is None:
        return None
    u = db.get(models.User, uid)
    if u is None or not u.active:
        return None
    return u


def set_session(response: Response, user_id: int) -> None:
    response.set_cookie(
        COOKIE_NAME, make_token(user_id), max_age=SESSION_DAYS * 86400,
        httponly=True, samesite="lax", secure=COOKIE_SECURE, path="/",
    )


def clear_session(response: Response) -> None:
    # 用同样的属性写一个立即过期的 cookie，浏览器才会认成同一个
    response.set_cookie(COOKIE_NAME, "", max_age=0, expires=0, httponly=True, samesite="lax", secure=COOKIE_SECURE, path="/")


def ensure_admin(db: Session, username: str, password: str) -> bool:
    """users 表为空时按环境变量建第一个管理员。返回是否新建。"""
    if not username or not password:
        return False
    if db.query(models.User).count() > 0:
        return False
    db.add(models.User(username=username, display_name=username, role_code="负责人", is_admin=True, password_hash=hash_password(password)))
    db.commit()
    return True
