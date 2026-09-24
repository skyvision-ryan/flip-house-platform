# 翻新项目平台 · Flip House Platform

每套房一个项目，连接任务、交付物、文件、预算和执行记录。手机用于执行与反馈，电脑用于安排与查看；长期发展为翻房 SaaS 和房产 AI 助手。

本机入口：`/Users/Ryan/Desktop/GitHub/flip-house-platform`。Documents 路径是兼容链接，同一时间只由一个助手修改。

近期方向（2026-09-17 会议）：让团队每天围绕每套房协作，信息组织顺序是**全部项目概况 → 单套房情况 → 本人负责的事项**，从一个新项目开始跑通。详见[产品方向](docs/产品方向与执行原则.md)。文档文件名中的日期是原始命名，正文维护当前计划。

## 去哪里看

| 想了解 | 唯一维护位置 |
|---|---|
| AI 如何工作 | [AGENTS.md](AGENTS.md)（Claude 自动引用） |
| 阶段目标 | [ROADMAP](ROADMAP.md) |
| 产品原则与待确认业务规则 | [产品方向](docs/产品方向与执行原则.md) |
| 已实现、已验证及未解决问题 | [版本核验](docs/当前实现与版本核验.md) |
| 开哪张票、依赖谁 | [Jira 执行清单](docs/Jira执行清单_2026-09-15.md)；状态以 Jira 实时记录为准 |
| 完整交付标准 | [范围与验收](docs/本周开发Tickets_2026-09-15.md)（含 09-17 会议新增的 T4 候选模块）、[验收脚本](docs/Demo验收_2026-09-18.md)（A 技术 demo / B 团队试用） |
| 云部署 | [AWS 统一方案](docs/AWS内部部署方案.md) |
| GitHub、目录和交接 | [协作约定](docs/仓库与协作约定.md) |
| 管理层进度报告怎么维护 | [VP 进度报告说明](docs/VP进度报告_设计与数据维护说明.md)；服务在 [services/vp_report](services/vp_report/README.md) |

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

### Demo 员工账号导入

员工使用邮箱和密码登录；邮箱忽略首尾空格与大小写，内部 `User.id` 保持不变。原账号名登录保留，便于已有管理员 / 演示账号继续使用。

本机名单 `users.local.json` 已被 `.gitignore` 忽略，**先用 `git check-ignore -v users.local.json` 确认，再保存名单**。内容为 JSON 数组，每项含 `name`、`email`、`role`；共享样例仅使用 `example.com` 地址。名单文件权限设为 `600`，密码不写入文件。

在应用已经初始化的数据库上，从仓库根目录执行（本机用 `backend/.venv/bin/python` 替代下列 `python`）：

```bash
read -r -s -p 'Initial password: ' INITIAL_PASSWORD
export INITIAL_PASSWORD
python scripts/provision_users.py /path/to/users.local.json
unset INITIAL_PASSWORD
```

以上为 Bash 命令，也可在运行本次代码的 Render 服务 Shell 使用。必须沿用该服务的 `DB_URL` / `DATA_DIR`，不能在另一个临时 Shell 的空 SQLite 库里导入。将本机名单通过私有方式放到上述路径，不通过公开仓库传递。当前 `render.yaml` 声明的数据路径是 `/tmp/flip-house-platform-data`，不能据此承诺重部署后的持久化。

重复导入只更新已有账号的姓名和角色，保留 ID、密码、启用状态、管理员状态和成员关系；只有显式加 `--reset-password` 才重置名单内的已有密码。整批输入无效时不写入。脚本不建项目成员、不改其他账号、不发邮件、不改 demo/seed 逻辑；负责人可用现有「加入项目并分派」把员工加入演示房。

角色代码与权限见[版本核验](docs/当前实现与版本核验.md)的 Demo 员工账号段落。邮箱歧义（旧库重复）拒绝登录与导入，需管理员先整理；不会任选其中一个账号。

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
- `services/vp_report/`：KAN-40 管理层进度报告，**独立服务**（独立进程、依赖与发布）。
  只读 Jira、口令访问，不 import backend/app，也不认 `DEMO_MODE` / `X-Actor`。
  代码已通过回归，但**尚未部署，也未在真机验证**。
- `scripts/`：本地检查、工作区核对与 Jira REST 回退工具。
- `docs/reference/`：保留的原始业务参考件，不是当前开发指令。

旧方案、旧审计全文和旧打印稿已从活动目录退役，可从 Git 历史 `73a01c2` 追溯。已知未解决事项收拢在版本核验中，旧文件退役不代表问题解决。
