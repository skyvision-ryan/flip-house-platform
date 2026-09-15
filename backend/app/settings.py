"""所有部署相关配置集中在这里读环境变量；本地开发不设任何变量也能跑。"""

import os
import secrets
import sys
from pathlib import Path


def _bool(name: str, default: bool) -> bool:
    v = os.getenv(name)
    if v is None or v == "":
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


DATA_DIR = Path(os.getenv("DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
UPLOAD_DIR = DATA_DIR / "uploads"

# 数据库：默认本地 SQLite；上云时给 postgresql+psycopg://user:pw@host/db
DB_URL = os.getenv("DB_URL") or f"sqlite:///{DATA_DIR / 'app.db'}"

# 演示模式：1 = 没登录也可用顶栏"我是"自报身份（本地开发、Render 演示）；0 = 必须登录（公司内部）
DEMO_MODE = _bool("DEMO_MODE", True)
# 是否灌十套示例房：默认跟随演示模式；生产空库设 0
SEED_DEMO = _bool("SEED_DEMO", DEMO_MODE)

# 会话签名密钥：生产必须设置；没设就每次启动随机（重启后所有人要重新登录）
SECRET_KEY = os.getenv("SECRET_KEY") or secrets.token_hex(32)
if not os.getenv("SECRET_KEY") and not DEMO_MODE:
    print("警告：没有设置 SECRET_KEY，重启后所有登录会失效。", file=sys.stderr)
SESSION_DAYS = int(os.getenv("SESSION_DAYS", "14"))
COOKIE_SECURE = _bool("COOKIE_SECURE", not DEMO_MODE)  # 生产走 HTTPS，cookie 只在 HTTPS 下发

# 文件存储：local（默认，存 DATA_DIR/uploads）或 s3（D2 接）
STORAGE = os.getenv("STORAGE", "local")
S3_BUCKET = os.getenv("S3_BUCKET", "")

CORS_ORIGINS = [o.strip() for o in os.getenv(
    "CORS_ORIGINS", "http://localhost:5180,http://127.0.0.1:5180,http://localhost:5173,http://127.0.0.1:5173"
).split(",") if o.strip()]

# 首次启动 users 表为空时自动建的管理员（不设就不建；DEMO_MODE 下不设也能用 X-Actor）
ADMIN_USER = os.getenv("ADMIN_USER", "")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")

PROVIDER = os.getenv("PROVIDER", "mock")
