# 翻新项目平台 · Flip House Platform

为翻房公司把每套房的任务、交付物、文件、预算和实际执行记录放在一处。手机用于处理任务和反馈，网页用于安排工作、查看项目与分析数据；长期发展为可复用的翻房 SaaS 和房产 AI 助手。

## 当前方向（2026-09-15）

- **09-18 周五 demo**：独立账号，负责人在电脑分派任务，执行者在 iPhone 查看说明、反馈等待、提交结果，负责人确认后总览同步。
- **09-21 至 09-25 AWS 内部试用**：2–3 套在建房、持久化数据/文件、备份恢复与发布回退。
- **小企业首次云架构**：ECS/Fargate + RDS PostgreSQL + 私有 S3，现有前后端同域名部署；Cognito、IAM、ECR、Secrets Manager、CloudWatch、CDK 形成可延续的标准 AWS 基础。iPhone Safari 与主屏幕网页应用优先。
- 项目指引及 Jira 交付计划已整理：3 个交付目标、15 张原生子票。业务代码仍待开发，不要将建单当成已上线能力。

## AI 与开发者入口

| 文件 | 用途 |
|---|---|
| [AGENTS.md](AGENTS.md) | 所有 AI 开发助手的共同工作入口 |
| [CLAUDE.md](CLAUDE.md) | Claude Code 入口，引用共同规则 |
| [仓库与协作约定](docs/仓库与协作约定.md) | 正式 GitHub、统一项目入口、同步与协作规则 |
| [ROADMAP.md](ROADMAP.md) | 本周 demo、下周 AWS 与后续目标 |
| [产品方向与执行原则](docs/产品方向与执行原则.md) | FDE、任务说明、状态/证据、移动端、数据、AI 和 SaaS |
| [当前实现与版本核验](docs/当前实现与版本核验.md) | 当前分支与笔记本所述版本的差异 |
| [Jira 执行清单](docs/Jira执行清单_2026-09-15.md) | 真实票号、一次 push 的交付、依赖和日期 |
| [开发范围与完整验收](docs/本周开发Tickets_2026-09-15.md) | 三个交付目标的完整业务与技术依据 |
| [周五 demo 验收](docs/Demo验收_2026-09-18.md) | 跨设备流程、反例与真实 iPhone 验证 |
| [AWS 内部部署方案](docs/AWS内部部署方案.md) | ECS/RDS/S3/Cognito 与统一部署基础的取舍和上线条件 |

## 已核实的当前代码

核验基线：`0a459c1`（2026-09-15 的 origin/main）。笔记本提交 `7ffb139` 在 `upstream/main`（`LianCr/flip-house-platform`）取得，已由 **KAN-20 合入分支 `KAN-20-baseline-alignment`** 并跑过回归（六段兼容旧数据、水电密码边界、前端构建）；合入 main 前仍以 PR 验收为准。KAN-21 的项目授权、成员接口与真实验证不因「登录文件已存在」而关闭。

| 模块 | 当前代码包含 |
|---|---|
| 项目工作台 | 项目列表、按角色组合的小组件、预算/进展与更新记录 |
| 房产与新建项目 | 地址查找、模拟房产数据、多来源字段、冲突与来源追溯 |
| 项目总览与待办 | 六段清单 31 项（旧 29 个 key 全部沿用）、一段可多门（装修 = 开工 + final，卖房 = offer + 交割）、角色负责项、证据、D/J 节点确认、我的待办 |
| 文件和执行记录 | 文件/照片与步骤关联、水电账户、检查记录、采购记录 |
| 分析与预算 | 确定性交易计算、多版本分析、分析应用到预算、支出对照 |
| 助手 | 规则洞察与页面链接，尚无 LLM 调用 |
| 身份 | 账号密码登录与用户管理已在 KAN-20 分支集成（`auth.py`、`routers/auth.py`、`settings.py`）：`DEMO_MODE=1` 时仍可用 X-Actor 自报身份（演示站），`DEMO_MODE=0` 时未登录一律 401；水电账户密码只给紫 / 蓝 / K |
| 存储 | SQLite 与本地 uploads；`SEED_DEMO` 跟随 `DEMO_MODE`，生产空库不灌演示项目 |

目标六段：预买房 → 买房与过户 → 装修 → 预上市 → 卖房上市 → 售出收尾。账号/六段基线在 T1 对齐，真正可分派的项目任务在 T2 实现，iPhone 交接在 T3 验收。

## 本地运行

仓库部署版本文件使用 Python 3.12 和 Node.js 22；依赖见 backend/requirements.txt 与 frontend/package.json。

```bash
# 后端首次准备
cd backend
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt

# 启动后端
./.venv/bin/uvicorn app.main:app --reload --port 8000
```

```bash
# 另一个终端，从仓库根目录开始
cd frontend
npm install
npm run dev
```

前端访问 `http://localhost:5180`，API 文档 `http://127.0.0.1:8000/docs`。现有启动逻辑在空库时自动生成示例项目，实际内部上线前必须按 ROADMAP 改为明确的演示 seed 开关。

### 验证

```bash
# 前端
cd frontend
npm run build
```

```bash
# 后端，从仓库根目录开始；现有测试还需要 httpx
cd backend
./.venv/bin/pip install httpx
./.venv/bin/python -m unittest discover -s tests
```

与改动相关的权限、任务、证据、迁移和设备验证标准见各 ticket。文档修改检查链接、日期与 `git diff --check` 即可。

## 当前演示部署记录

仓库记录的演示地址：[Render demo](https://flip-house-platform-ryan.onrender.com)。本次文档更新未重新核验在线健康或执行部署。

- `render.yaml` 使用 Render Python 环境，构建后端依赖及前端，由同一服务提供 API/网页；`Dockerfile` 保留给容器部署。
- 当前仓库记录的服务追踪 `main`，main 的 push/merge 会触发自动部署；其他分支不会直接发布该服务。
- `/api/health` 返回 `ok` 和当前 `RENDER_GIT_COMMIT` 的短提交号（本地为 local），发布后用它核对目标版本。
- 现有演示采用模拟数据与临时磁盘；重新部署不能作为持久化保证。公开演示环境只使用合成资料，真实内部数据进入有账号和持久化保障的环境。
- 当前代码读取 `PORT`、`DATA_DIR`、`PROVIDER`、`FRONTEND_DIST` 等环境变量；`DB_URL`、正式登录与 S3 等配置仍需按统一代码基线核验/实现。

下周新 AWS 部署使用 [当前方案](docs/AWS内部部署方案.md)。App Runner 旧建议已调整；本轮没有创建 AWS 资源，也没有把 Render 的部署配置改成 AWS。

## 模块地图

```text
backend/app/
  main.py / db.py           应用启动、数据目录与连接
  models.py / schemas.py    数据模型与接口结构
  dictionaries.py          角色、权限、阶段与交付物字典
  steps.py                 证据、确认和进度计算
  analysis.py              确定性交易分析
  routers/                 项目、文件、预算、步骤、检查、采购等接口
  providers/               外部数据接口抽象，当前为模拟源
frontend/src/
  App.tsx                  外壳、路由、演示身份与助手抽屉
  pages/                   工作台、待办、项目、新建页面
  components/              清单、上传、检查、采购相关视图与图表
  lib/                     角色、动作、规则洞察、格式等
  api/client.ts            前后端接口契约
docs/
  当前文档                  方向、基线、任务、验收、AWS
  历史审计与流程             保留业务证据和未关闭问题；顶部注明历史状态
  archive/                 旧 README 与产品研究框架
```

## 历史资料

[原 README 与实现日志](docs/archive/README_2026-09-14.md)、[原产品研究框架](docs/archive/产品研究框架_2026-09-14.md)保留用于追溯。历史工作流、角色和审计文件可按需阅读，其排期与实现状态不覆盖当前方向和实际代码核验。
