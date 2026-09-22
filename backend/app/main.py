import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select

from . import models
from .auth import ensure_admin
from .db import SessionLocal, init_db
from .migrations import run_migrations
from .providers import get_provider
from .routers import analyses, auth, budget, dashboard, files, lookup, meta, ops, procurement, projects, property_data, steps
from .settings import ADMIN_PASSWORD, ADMIN_USER, CORS_ORIGINS, SEED_DEMO


@asynccontextmanager
async def lifespan(app: FastAPI):
    # KAN-71：先校验数据源配置。未实现的 PROVIDER 在这里就抛，服务起不来，
    # 部署直接失败、旧版本继续在线——不能等到首次查询才出错。
    get_provider()
    init_db()
    with SessionLocal() as db:
        # 一次性数据迁移。不放 init_db()：那里只管建表，测试也会调它。
        for rep in run_migrations(db):
            print(f"迁移 {rep.key}：{rep.status}，影响 {rep.affected} 行")
        if SEED_DEMO and db.scalar(select(models.Project).limit(1)) is None:
            from .seed import seed
            seed(db)
        if ensure_admin(db, ADMIN_USER, ADMIN_PASSWORD):
            print(f"已创建管理员账号：{ADMIN_USER}")
    yield


app = FastAPI(title="翻新项目平台 API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (auth, meta, dashboard, lookup, projects, property_data, files, budget, analyses, steps, ops, procurement):
    app.include_router(r.router)


@app.get("/api/health")
def health():
    return {"ok": True, "commit": os.getenv("RENDER_GIT_COMMIT", "local")[:7]}


# ---- 生产环境：同一容器提供前端静态文件（本地开发时 dist 不存在则跳过）----
DIST = Path(os.getenv("FRONTEND_DIST", Path(__file__).resolve().parents[2] / "frontend" / "dist"))
if (DIST / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(404)
        candidate = DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(DIST / "index.html")
