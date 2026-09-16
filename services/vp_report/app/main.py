"""VP 手机进度报告——独立服务入口。

这个服务与主业务 FastAPI 完全隔离：
- 不 import backend/app 的任何东西
- 不认 DEMO_MODE、不认 X-Actor、不连业务数据库
- 自己的口令、自己的 Jira 只读凭证、自己的健康检查

跑起来：
    uvicorn app.main:app --app-dir services/vp_report --port 8100
"""

from __future__ import annotations

import logging
import secrets

from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response

from . import auth, render, settings, snapshot
from .jira_client import JiraClient
from .store import STATUS_LOADING, STATUS_UNAVAILABLE, SnapshotStore

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("vp_report")

app = FastAPI(title="VP 进度报告", version="2.0.0", docs_url=None, redoc_url=None, openapi_url=None)

limiter = auth.AttemptLimiter()


def _fetch() -> "snapshot.Snapshot":
    return snapshot.fetch(JiraClient())


store = SnapshotStore(_fetch)


# ---------- 安全响应头 ----------

@app.middleware("http")
async def security_headers(request: Request, call_next):
    nonce = secrets.token_urlsafe(16)
    request.state.nonce = nonce
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = (
        "default-src 'none'; "
        f"style-src 'nonce-{nonce}'; "
        f"script-src 'nonce-{nonce}'; "
        "connect-src 'self'; "
        "img-src data:; "
        "base-uri 'none'; "
        "form-action 'self'; "
        "frame-ancestors 'none'"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    # 报告内容不该被任何中间层或浏览器缓存下来
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    return response


def _nonce(request: Request) -> str:
    return getattr(request.state, "nonce", "")


def _configured() -> bool:
    return settings.jira_configured() and settings.access_configured()


def _config_error() -> Response:
    """配置不全一律通用 503。**不告诉客户端缺的是哪一个**，只写服务端日志。"""
    log.error("报告服务配置不全，缺少：%s", ", ".join(settings.missing_config()))
    return JSONResponse({"detail": "服务暂时不可用"}, status_code=503)


# ---------- 健康检查 ----------

@app.get("/healthz")
def healthz(request: Request, deep: int = 0) -> Response:
    """浅检查只看配置齐不齐，**不说缺的是哪一个**（那只写服务端日志）。

    `?deep=1` 会真的拿配好的凭证打一次 Jira，用来确认 token 类型（basic /
    bearer）配对了——部署到 Render 之后没有 shell，这是唯一能确认的方式。
    它要求已登录，且只回 true/false，不回账号名。
    """
    if not _configured():
        log.error("健康检查失败，缺少配置：%s", ", ".join(settings.missing_config()))
        return JSONResponse({"ok": False, "detail": "服务暂时不可用"}, status_code=503)

    if deep:
        if not auth.is_authed(request):
            return JSONResponse({"detail": "未授权"}, status_code=401)
        try:
            JiraClient().verify_auth()
        except Exception as exc:                      # noqa: BLE001
            log.error("Jira 凭证校验失败：%s", exc)
            return JSONResponse({"ok": False, "jira": False}, status_code=503)
        return JSONResponse({"ok": True, "jira": True})

    return JSONResponse({"ok": True, "service": "vp-report"})


# ---------- 页面 ----------

@app.get("/", response_class=HTMLResponse)
def index(request: Request) -> Response:
    if not _configured():
        return _config_error()
    if not auth.is_authed(request):
        return HTMLResponse(render.passcode_page(_nonce(request)))

    store.ensure_fresh()
    state = store.state()
    if state["status"] == STATUS_LOADING:
        return HTMLResponse(render.loading_page(_nonce(request)))
    if state["status"] == STATUS_UNAVAILABLE:
        return HTMLResponse(render.unavailable_page(state, _nonce(request)))
    return HTMLResponse(render.report_page(state, _nonce(request)))


@app.post("/login")
def login(request: Request, passcode: str = Form(default="")) -> Response:
    if not _configured():
        return _config_error()
    ip = auth.client_ip(request)
    if limiter.locked(ip):
        log.warning("口令尝试过多，暂时锁定：%s", ip)
        return HTMLResponse(
            render.passcode_page(_nonce(request), "尝试次数过多，请稍后再试。"),
            status_code=429)
    if not auth.check_passcode(passcode):
        limiter.record_failure(ip)
        return HTMLResponse(
            render.passcode_page(_nonce(request), "口令不正确。"), status_code=401)

    limiter.reset(ip)
    response = RedirectResponse("/", status_code=303)
    auth.set_session(response)
    return response


@app.post("/logout")
def logout() -> Response:
    response = RedirectResponse("/", status_code=303)
    auth.clear_session(response)
    return response


# ---------- 数据接口（未授权一律 401，与业务登录无关）----------

@app.get("/api/report/status")
def report_status(request: Request) -> Response:
    if not _configured():
        return _config_error()
    if not auth.is_authed(request):
        return JSONResponse({"detail": "未授权"}, status_code=401)
    store.ensure_fresh()
    state = store.state()
    return JSONResponse({
        "status": state["status"],
        "fetched_at": state["fetched_at"],
        "refreshing": state["refreshing"],
    })


@app.get("/api/report/data")
def report_data(request: Request) -> Response:
    if not _configured():
        return _config_error()
    if not auth.is_authed(request):
        return JSONResponse({"detail": "未授权"}, status_code=401)
    store.ensure_fresh()
    state = store.state()
    return JSONResponse({
        "status": state["status"],
        "fetched_at": state["fetched_at"],
        "snapshot": state["snapshot"],
    })


@app.post("/api/report/refresh")
def report_refresh(request: Request) -> Response:
    if not _configured():
        return _config_error()
    if not auth.is_authed(request):
        return JSONResponse({"detail": "未授权"}, status_code=401)
    triggered = store.ensure_fresh(manual=True)
    return JSONResponse({"triggered": triggered, "status": store.status()})
