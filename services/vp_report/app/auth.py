"""报告自己的访问控制：固定地址 + 首次口令 + 会话保持。

与业务系统完全无关：这里没有 users 表、没有 DEMO_MODE、没有 X-Actor。
报告服务不认业务登录状态，业务服务也拿不到这里的口令。

会话怎么签：
    signing_key = hmac(REPORT_SECRET, sha256(REPORT_PASSCODE))
    cookie      = "<过期时间戳>.<hmac(signing_key, 过期时间戳)>"

好处是不用会话表：
- REPORT_SECRET 固定 → 服务重启后旧会话仍然有效（免费套餐经常重启）。
- 换 REPORT_PASSCODE → 签名密钥随之改变 → **所有旧会话立即失效，而分享地址不变**。

REPORT_SECRET 缺失时**一律 503**，绝不退化成随机密钥——那样每次重启都会把
微信群里的人踢下线，且看起来"能用"。
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import threading
import time

from fastapi import Request, Response

from . import settings

log = logging.getLogger("vp_report.auth")

COOKIE_NAME = "vp_report"


def signing_key() -> bytes:
    """口令参与派生 → 换口令即吊销全部旧会话。"""
    passcode_digest = hashlib.sha256(settings.REPORT_PASSCODE.encode()).digest()
    return hmac.new(settings.REPORT_SECRET.encode(), passcode_digest, hashlib.sha256).digest()


def _sign(payload: str) -> str:
    return hmac.new(signing_key(), payload.encode(), hashlib.sha256).hexdigest()


def make_token() -> str:
    exp = int(time.time()) + settings.SESSION_DAYS * 86400
    return f"{exp}.{_sign(str(exp))}"


def token_valid(token: str | None) -> bool:
    if not token:
        return False
    try:
        exp_text, sig = token.split(".", 1)
        if not hmac.compare_digest(_sign(exp_text), sig):
            return False
        return int(exp_text) >= time.time()
    except (ValueError, TypeError):
        return False


def is_authed(request: Request) -> bool:
    if not settings.access_configured():
        return False
    return token_valid(request.cookies.get(COOKIE_NAME))


def check_passcode(supplied: str) -> bool:
    if not settings.REPORT_PASSCODE:
        return False
    return hmac.compare_digest(supplied.encode(), settings.REPORT_PASSCODE.encode())


def set_session(response: Response) -> None:
    response.set_cookie(
        COOKIE_NAME, make_token(),
        max_age=settings.SESSION_DAYS * 86400,
        httponly=True,
        # Lax 是必须的：从微信点开是顶层 GET 跳转，Strict 会让 cookie 发不出去
        samesite="lax",
        secure=settings.COOKIE_SECURE,
        path="/",
    )


def clear_session(response: Response) -> None:
    response.set_cookie(
        COOKIE_NAME, "", max_age=0, expires=0, httponly=True,
        samesite="lax", secure=settings.COOKIE_SECURE, path="/",
    )


def client_ip(request: Request) -> str:
    """取真实客户端 IP。

    Render 在前面放了反向代理。如果直接用 request.client.host，所有人都会是
    同一个代理 IP——一个人输错 5 次口令就会把整个微信群锁在外面。

    X-Forwarded-For 是从左到右追加的，最右边是离我们最近的一跳。声明可信代理
    层数 hops，取倒数第 hops 个：客户端伪造的前缀会被挤到左边，取不到。
    """
    hops = settings.TRUSTED_PROXY_HOPS
    if hops > 0:
        forwarded = request.headers.get("x-forwarded-for", "")
        parts = [p.strip() for p in forwarded.split(",") if p.strip()]
        if len(parts) >= hops:
            return parts[-hops]
    return request.client.host if request.client else "unknown"


class AttemptLimiter:
    """口令错误尝试限制。内存实现，只保证单进程。"""

    def __init__(self, max_attempts: int | None = None, window: int | None = None) -> None:
        self.max_attempts = max_attempts if max_attempts is not None else settings.MAX_ATTEMPTS
        self.window = window if window is not None else settings.ATTEMPT_WINDOW_SECONDS
        self._hits: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def _prune(self, now: float) -> None:
        for ip in list(self._hits):
            fresh = [t for t in self._hits[ip] if now - t < self.window]
            if fresh:
                self._hits[ip] = fresh
            else:
                del self._hits[ip]

    def locked(self, ip: str) -> bool:
        now = time.monotonic()
        with self._lock:
            self._prune(now)
            return len(self._hits.get(ip, [])) >= self.max_attempts

    def record_failure(self, ip: str) -> None:
        now = time.monotonic()
        with self._lock:
            self._prune(now)
            # 上限保护：别让伪造 IP 把内存撑爆
            if len(self._hits) > 5000:
                self._hits.clear()
            self._hits.setdefault(ip, []).append(now)

    def reset(self, ip: str) -> None:
        with self._lock:
            self._hits.pop(ip, None)
