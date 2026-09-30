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

### Render 现有业务数据持久化迁移

`render.yaml` 的主业务配置是迁移目标，不代表线上已生效。使用最低付费 Compute、5 GB 磁盘、单实例、手动部署及 `/api/health`；VP 服务保持独立。不要直接 Apply：Free 实例升级和挂盘可能替换实例，必须先取得当前数据库和全部附件的完整备份。

1. 暂停业务写入，使用 SQLite backup API 导出数据库（包含已提交 WAL），连同全部 `uploads` 保存至服务之外。保留原 `SECRET_KEY` 和账号密码哈希，不截图重建账号，不运行演示重置。Free 无 Shell 时先由 Render 支持确认能否安全导出；不得先部署导出工具。
2. 校验数据库完整性、各表记录和附件 SHA-256，在隔离环境恢复演练。完整备份未验证前保持旧实例与配置不动。
3. 协调一次维护窗口升级 Compute、挂盘并恢复数据。磁盘挂到现有 `/tmp/flip-house-platform-data`，保持已存附件绝对路径；这是显式磁盘挂载点，不能仅设置同名环境变量。先通过付费实例的 Shell/SSH 完成恢复，再启动业务；空盘启动失败是预期保护，不可用演示初始化绕过。
4. 设置 `DATA_DIR` 和 `PERSISTENT_DISK_PATH` 为上述挂载点，`DEMO_MODE=0`、`SEED_DEMO=0`、`COOKIE_SECURE=1`、`STORAGE=local`，保留原 `SECRET_KEY`；移除 `TEAM_DEMO_RESET_ID`。将启动命令替换为 `python scripts/start_persistent.py`，不再使用 `start_team_demo.py`。Blueprint 未声明的旧环境变量仍须在控制台核查，不能假定自动删除。
5. 验证原账号、权限、全部房屋、任务状态、采购事实和附件，再进行受控重启及重新部署核对。自动部署保持关闭，防止备份前误发布。

启动守卫在导入业务应用前核验真实挂载、原数据库与附件，拒绝空库或错误配置；每次启动先保存 SQLite 一致性副本。`startup-backups` 在同一磁盘，**不是异地备份**，不自动删除历史；需监控容量，确认外部副本后人工清理。正式迁移完成后，每次发布前以及有业务变动的工作日应暂停写入执行并下载备份，定期做恢复演练：

```bash
python scripts/storage_backup.py --data-dir /tmp/flip-house-platform-data --destination /tmp/flip-house-platform-data/manual-backups --writes-paused
```

`--writes-paused` 是操作员确认，不会自行冻结业务。备份包含敏感数据库，仅通过私有渠道下载至受限目录，不能进 Git。验证 `manifest.json` 的数据库与附件哈希，存在 `INCOMPLETE` 时不能使用；清单不会把“生成成功”冒充“恢复演练通过”。Render 磁盘快照不能代替 SQLite 一致性备份。当前工具不包含自动异地备份服务。

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

以上为 Bash 命令，也可在运行本次代码的 Render 服务 Shell 使用。必须沿用该服务的 `DB_URL` / `DATA_DIR`，不能在另一个临时 Shell 的空 SQLite 库里导入。将本机名单通过私有方式放到上述路径，不通过公开仓库传递。只有实际挂载磁盘并完成上述迁移验收，才能确认数据持久化；路径名称本身不提供保障。

重复导入只更新已有账号的姓名和角色，保留 ID、密码、启用状态、管理员状态和成员关系；只有显式加 `--reset-password` 才重置名单内的已有密码。整批输入无效时不写入。脚本不建项目成员、不改其他账号、不发邮件、不改 demo/seed 逻辑；负责人可用现有「加入项目并分派」把员工加入演示房。

角色代码与权限见[版本核验](docs/当前实现与版本核验.md)的 Demo 员工账号段落。邮箱歧义（旧库重复）拒绝登录与导入，需管理员先整理；不会任选其中一个账号。

### 可选：Free Render 全员团队演示启动

需要真实账号登录、使用合成房屋进行演示时，可在**主业务服务**显式选择以下 Start Command（从仓库根目录执行）：

```bash
python scripts/start_team_demo.py
```

此命令仅用于可丢弃的合成演示，不能用于已有人工业务数据。正式迁移目标使用上面的持久化启动守卫；不修改 VP 报告服务。

先在服务的私有环境变量中配置完整参数，真实名单、密码及密钥不写入 Git、启动命令或日志：

| 环境变量 | 配置要求 |
|---|---|
| `DATA_DIR` | 显式绝对路径，例如 `/tmp/flip-house-platform-data`；此启动器只使用其 `app.db` 与 `uploads/` |
| `DEMO_MODE`、`SEED_DEMO` | 两项都必须为 `0`，使用真实登录且不运行默认演示种子 |
| `SECRET_KEY` | 固定的随机密钥，至少 32 字符；重部署保持相同值 |
| `ADMIN_USER` | 需要创建或沿用的管理员登录名；已有用户时必须对应唯一启用管理员 |
| `ADMIN_PASSWORD` | 通过私有环境提供；仅空用户表创建首个管理员时使用，现有管理员密码不被覆盖 |
| `INITIAL_PASSWORD` | 通过私有环境提供的员工初始密码；仅创建缺失账号时使用，不重置已有密码 |
| `TEAM_DEMO_USERS_JSON` | 完整私有 JSON 数组，各项含 `name`、`email`、`role`；必须恰含已确认的七位员工和职责角色 |
| `TEAM_DEMO_USERS_FILE` | 可替代 JSON 环境变量，指向服务内私有名单文件；与 `TEAM_DEMO_USERS_JSON` 二选一。Free 演示优先使用 JSON 环境变量，无需通过 Shell 导入文件 |
| `TEAM_DEMO_HOUSES` | `3`（默认三房）或 `1`（仅一套装修房；采购为需求，现场创建订单和收货） |
| `TEAM_DEMO_RESET_ID` | 仅明确授权清空业务数据时设置新的唯一标识，并同时设 `TEAM_DEMO_HOUSES=1`。启动前备份，保留所有账号身份及权限，将密码设为私有 `INITIAL_PASSWORD`，重建一房；同一标识在同一数据目录仅执行一次 |
| `TEAM_DEMO_AS_OF` | 可选，格式 `YYYY-MM-DD`；本次演示可设 `2026-09-25`。未设置时以洛杉矶当天生成相对日期；已有三房不会随此变量改变日期 |
| `STORAGE`、`DB_URL` | `STORAGE` 留空或设 `local`；`DB_URL` 留空，或严格指向 `DATA_DIR/app.db` 的 SQLite URL，不连接其他数据库 |

启动器先校验配置与名单：空库创建首个管理员及缺失员工，再由 [prepare_team_demo.py](scripts/prepare_team_demo.py) 按 `TEAM_DEMO_HOUSES` 生成合成房屋、成员分派、任务及附件。用户信息与演示房屋分别使用事务；如果房屋生成失败，服务不会启动，已创建的账号保留供下一次重试。生成器在首次写入项目前备份数据库与附件并验证恢复副本，备份位于 `DATA_DIR/team-demo-backups/`。

已有完整 `team-v1` 三房时，重复启动保留账号的姓名、角色、ID、密码以及团队已做的操作；不会重新铺数据。若存在旧项目、部分演示、错误角色、停用账号或不一致的成员身份，启动拒绝继续，不自动删除或替换。需要迁移时，先通过 `prepare_team_demo.py --help` 查看只读预览及显式替换参数，核对项目 ID 和备份范围后另行执行；正常启动不替换；本次清空演示专用的 `TEAM_DEMO_RESET_ID` 是显式例外，失败恢复备份，成功后保留该标识避免重复清空。Free 实例数据目录丢失时会重新初始化，因此不能作为持续业务资料的持久化方案。

Free 环境的临时数据库和附件可能在重启或重新部署后丢失；此方案接受丢失后按私有环境重建演示初始数据，**不能恢复丢失前的操作**。同一临时磁盘内的备份也不构成持久化保障。这里的房屋、金额、文件与历史均为合成，账号按私有名单创建；不改变邮件发送配置。

发布后应核对 `/api/health` 的提交号，使用管理员和员工账号分别登录，确认可见项目、本人任务及职责权限。主业务保持手动部署。以上是可选演示说明，不代表该配置已在线部署或完成团队验收。

### 本地自动检查

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
