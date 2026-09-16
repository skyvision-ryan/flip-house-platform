# 翻新项目平台 · Flip House Platform

每套房一个项目，连接任务、交付物、文件、预算和执行记录。手机用于执行与反馈，电脑用于安排与查看；长期发展为翻房 SaaS 和房产 AI 助手。

本机入口：`/Users/Ryan/Desktop/GitHub/flip-house-platform`。Documents 路径是兼容链接，同一时间只由一个助手修改。

## 去哪里看

| 想了解 | 唯一维护位置 |
|---|---|
| AI 如何工作 | [AGENTS.md](AGENTS.md)（Claude 自动引用） |
| 阶段目标 | [ROADMAP](ROADMAP.md) |
| 产品原则与待确认业务规则 | [产品方向](docs/产品方向与执行原则.md) |
| 已实现、已验证及未解决问题 | [版本核验](docs/当前实现与版本核验.md) |
| 开哪张票、依赖谁 | [Jira 执行清单](docs/Jira执行清单_2026-09-15.md)；状态以 Jira 实时记录为准 |
| 完整交付标准 | [范围与验收](docs/本周开发Tickets_2026-09-15.md)、[iPhone 验收](docs/Demo验收_2026-09-18.md) |
| 云部署 | [AWS 统一方案](docs/AWS内部部署方案.md) |
| GitHub、目录和交接 | [协作约定](docs/仓库与协作约定.md) |

## 本地准备

版本：Python **3.12**、Node **22**（`.python-version` / `.node-version`）。从仓库根目录运行，不要使用 macOS 自带的旧 Python 创建环境。

```bash
python3.12 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements-dev.txt
npm --prefix frontend ci
```

若 Homebrew 默认 Node 仍为旧版，在当前终端选择已安装的 22：

```bash
export PATH="$(brew --prefix node@22)/bin:$PATH"
node --version
```

两个终端分别从根目录运行：

```bash
cd backend
./.venv/bin/uvicorn app.main:app --reload --port 8000
```

```bash
npm --prefix frontend run dev
```

网页：`http://localhost:5180`；API：`http://127.0.0.1:8000/docs`。

## 配置与数据

配置源：[settings.py](backend/app/settings.py)。默认 `DEMO_MODE=1`，允许演示身份切换；`SEED_DEMO` 默认跟随它，空库会生成合成项目。默认数据在 `backend/data/`，附件在其 `uploads/`，均不入 Git。

正式模式使用 `DEMO_MODE=0`、`SEED_DEMO=0`、固定 `SECRET_KEY`、`ADMIN_USER` / `ADMIN_PASSWORD`（仅空用户表时创建首个管理员）。凭证通过环境注入，不写进仓库。生产 Cookie 默认仅 HTTPS；本地 HTTP 登录测试可临时设 `COOKIE_SECURE=0`，不能照搬到正式站点。

`DB_URL` 已支持配置连接地址；PostgreSQL 驱动/迁移与真实验收仍待 KAN-22。`STORAGE` / `S3_BUCKET` 目前只是配置入口，设置它们不会自动获得 S3 存储。登录已经存在，但项目授权仍待 KAN-21，当前版本不能据此装入真实内部资料。

## 验证

从根目录运行：

```bash
python3 scripts/check_local.py
```

它检查 Python/Node 版本，在临时数据目录运行后端 unittest、隔离的 hooks 测试，再执行前端完整构建。不会访问 Jira、推送、部署或使用实际业务数据库。

单独检查：

```bash
python3 .claude/hooks/test_check_commit.py
npm --prefix frontend run build
git diff --check
```

本次新增 `.github/workflows/ci.yml`，合入后会在 PR/main 运行后端测试、守卫测试和前端构建。本地 hooks 只辅助 Claude，仍不能代替 CI。

## 部署记录

仓库记录的 [Render 演示站](https://flip-house-platform-ryan.onrender.com) 跟踪 origin/main。2026-09-15 实测 `/api/health` 返回 `73a01c2`，与当时 main 一致；免费层首次冷启动可能超过 30 秒。`/api/health` 返回 `ok` 和 `RENDER_GIT_COMMIT` 短号（本地为 local）。演示站仅使用合成资料，不依赖临时磁盘保证持久化。

KAN-39 增加 `.github/workflows/jira-deployment.yml`：main push 后等待 Render 健康端点出现本次提交，再登记 GitHub Deployment（`staging`）供 Jira 显示。它只记录部署结果，不执行部署。本次本地审计没有发布线上版本。

AWS 仍按既定 ECS/Fargate + RDS + S3 + Cognito 方案实施。

## 代码地图

- `backend/app/`：配置、身份、数据模型、六段/证据计算、金额分析与 API。
- `frontend/src/`：工作台、项目、待办、登录/用户页面与组件；规则助手尚未接 LLM。
- `.claude/`：引用共同规则的命令与辅助 hooks。
- `scripts/`：本地检查、工作区核对与 Jira REST 回退工具。
- `docs/reference/`：保留的原始业务参考件，不是当前开发指令。

旧方案、旧审计全文和旧打印稿已从活动目录退役，可从 Git 历史 `73a01c2` 追溯。已知未解决事项收拢在版本核验中，旧文件退役不代表问题解决。
