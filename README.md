> 新来的（人或 agent）先读根目录 `ROADMAP.md`：现状、时间线、路线图、AWS 落地、约束、上手。

# 翻新项目平台（Flip House Platform）· MVP 0

给房屋翻新转卖（house flipping）公司用的内部平台。以“项目”为中心，把一套房子从线索、买入、施工到卖出的数据放在一处，每个数字带来源，买前算账和买后记账连成一条线。

当前是 MVP 0：验证数据层思路，用模拟数据源演示。界面用 AWS 控制台的开源组件库 Cloudscape。

**在线演示**：[flip-house-platform-ryan.onrender.com](https://flip-house-platform-ryan.onrender.com)（Render 免费版，闲置后首次打开可能需要等待唤醒）

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/skyvision-ryan/flip-house-platform)

---

## 现在能做什么

| 页面 | 内容 |
|---|---|
| 工作台 | 今日关注一句话、地址搜索、12 个可拖拽小组件（需要关注、未来 30 天、在建花了多少、资金占用、阶段分布、线索漏斗、近 12 周支出、估算准不准、供应商前五、最近更新、项目列表） |
| 新建项目 | 输地址 → 自动补全房产数据（每个字段带来源与把握度）→ 定策略与阶段 → 自动预填交易分析；地址 + 地块号查重 |
| 项目页 · 总览 | 身份卡（交易结论 + 时间线）、本阶段要做的事三张卡、生命周期轨道、关键信息、预算：花在哪、哪超了、状态、风险 |
| 项目页 · 分析 | 交易分析器（参考 PropStream Fix & Flip Analyzer）：买入 / 持有含房贷 / 装修明细 / 卖出，即时指标、按目标利润率反推最高出价、成本结构；多版本；“应用到项目”把装修明细变成预算项 |
| 项目页 · 数据 | 房产规格（多来源、冲突选主值、人工修改留痕）、业主、按揭、成交史 |
| 项目页 · 文件 | 文件登记：类型、阶段、日期、对方、金额、来源 |
| 项目页 · 预算 | 汇总、预算 vs 实际（子弹图）、预算项、支出 |
| 助手抽屉 | Amazon Q 式面板，回答由规则从项目数据生成（明确标注不是大模型） |

明确不包含：登录、Lark 对接、真实房产数据接口、AI 调用、任务与排期、承包商模块。

---

## 本地运行

需要 Python 3.11+、Node 18+。

```bash
# 后端（第一次）
cd backend
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt

# 后端（每次）
./.venv/bin/uvicorn app.main:app --reload --port 8000
# 首次启动自动生成 8 个示例项目到 backend/data/app.db

# 前端（第一次）
cd frontend
npm install

# 前端（每次）
npm run dev
# 打开 http://localhost:5180
```

接口文档：http://127.0.0.1:8000/docs
重置示例数据：删除 `backend/data/`，重启后端。

---

## 部署（Render，推送即部署）

`render.yaml` 使用 Render Python 环境：构建时安装后端依赖并打包前端，运行时由同一个服务提供 API 和前端页面。Python 3.12 与 Node.js 22 分别由 `.python-version` 和 `.node-version` 指定。仓库保留 `Dockerfile`，供容器部署使用。

当前服务已在 `My Workspace` 创建：[Render 控制台](https://dashboard.render.com/web/srv-dak9kap42hec739p4pig)。日常更新只需 push 或合并到 `main`，无需重复创建服务。当前服务由控制台管理配置；`render.yaml` 记录对应配置，供重建或新建 Blueprint 使用。

1. 用 GitHub 账号登录 [render.com](https://render.com)。
2. New → **Blueprint** → 通过已连接的 GitHub 账号选择 `skyvision-ryan/flip-house-platform` → Apply，创建 `flip-house-platform-ryan` 服务。首次构建约 3–5 分钟。
3. 服务跟踪 `main`，Auto-Deploy 设置为 **On Commit**（`autoDeployTrigger: commit`）。之后每次推送或合并到 `main`，Render 自动构建并部署；其他分支的 push 不更新该站点。
4. 在 Render 的 Deploys 页面查看部署结果和触发原因。健康检查路径设为 `/api/health`，接口返回 `ok` 和当前部署提交号；自动部署完成后可与 GitHub `main` 的最新提交核对。

自动部署需要连接 GitHub 账号并授权该仓库。仅通过 Public Git Repository URL 创建的服务不支持自动部署，无需另外配置定时任务或部署钩子。

免费版说明：15 分钟无访问会休眠，再打开约 30 秒；磁盘是临时的，每次部署示例数据自动重建，上传的文件不保留。换到 AWS App Runner、Railway 等平台时同一个 Dockerfile 可直接用。

### 环境变量（全部可不设，本地开发零配置）

| 变量 | 默认 | 说明 |
|---|---|---|
| `DEMO_MODE` | `1` | `1`：没登录也能用顶栏"我是"自报身份（本地、Render 演示）。`0`：必须登录，`X-Actor` 头一律不认（公司内部上线用这个） |
| `SEED_DEMO` | 跟随 `DEMO_MODE` | `1` 首次启动灌十套示例房；`0` 空库 |
| `ADMIN_USER` / `ADMIN_PASSWORD` | 空 | `users` 表为空时自动建这个管理员（角色负责人）。上线第一次启动必设，之后可删 |
| `SECRET_KEY` | 随机 | 登录 cookie 的签名密钥。生产必设，否则每次重启所有人要重新登录 |
| `SESSION_DAYS` | `14` | 登录保持天数 |
| `COOKIE_SECURE` | `DEMO_MODE=0` 时为 1 | cookie 只走 HTTPS。本地用 `DEMO_MODE=0` 测试时设 `0` |
| `DB_URL` | 本地 SQLite | 上云填 `postgresql+psycopg://user:pw@host/db`（D2） |
| `STORAGE` / `S3_BUCKET` | `local` | 文件存本地目录还是 S3（D2 接） |
| `CORS_ORIGINS` | 本地 5180 / 5173 | 逗号分隔。同一容器提供前端时不需要 |
| `DATA_DIR` | `backend/data` | SQLite 与上传目录 |
| `PROVIDER` | `mock` | 房产数据源 |
| `PORT` | 平台注入 | |

**登录与账号（2026-09-14 晚加）**：`users` 表一个人一条，账号绑一个角色代号（代号决定权限，见"角色、权限与交付物"）。登录是账号密码，密码 pbkdf2 加盐存，会话是 HttpOnly cookie 里的签名 token，不加第三方依赖。管理员在侧栏"用户"页建账号、改角色、重置密码、停用；`DEMO_MODE=1` 下管理员还能用顶栏临时切身份看别人看到的。水电瓦斯账户密码只回给紫、蓝和 K，其他人拿到的是空。

本地按正式模式跑一遍：

```bash
cd backend
DEMO_MODE=0 COOKIE_SECURE=0 ADMIN_USER=admin ADMIN_PASSWORD=改我 ./.venv/bin/uvicorn app.main:app --port 8000
```

---

## 目录结构

```
backend/app/
  main.py          FastAPI 入口、跨域、静态托管（生产）
  db.py            SQLite（SQLAlchemy，换 Postgres 不改业务代码）
  models.py        房产、字段来源、业主、按揭、成交史、项目、预算项、支出、文件、交易分析
  schemas.py       请求 / 响应结构
  dictionaries.py  阶段 / 状态 / 预算类别 / 文件类型 / 来源 / 分析默认值
  status.py        项目健康状态规则（可人工覆盖）
  analysis.py      交易分析公式与预填（确定性计算，不含 AI）
  providers/       外部数据源抽象层；mock.py 为模拟源，换真源只实现同一个类
  routers/         meta、dashboard、lookup、projects、property_data、files、budget、analyses
  seed.py          示例数据：8 个项目、147 条支出、48 份文件、12 份分析、2 处多来源冲突
frontend/src/
  App.tsx          外壳：顶栏（地址搜索、评审标注开关）、侧栏、右侧助手抽屉
  pages/Dashboard.tsx        工作台（可拖拽看板，布局记在浏览器）
  pages/AddProject.tsx       新建项目向导
  pages/project/             项目页：总览 / 分析 / 数据 / 文件 / 预算
  components/charts/         图表组件包（见下）
  components/                来源标签、字段与来源、生命周期条、工作流卡、助手、评审标注
  lib/analysis.ts            与后端同一套分析公式（即时重算）
  lib/insights.ts            规则洞察：超支 / 落后 / 缺数据 / 缺文件 / 待定价 / 未算账
docs/
  候选API方案.docx          5 个非 AI 数据接口 + AI 搭配方案 + 地址补全与合并规则
  评审标注对照表.md         界面上黄色字母圆标的含义
CLAUDE.md                    产品研究框架与工作原则
```

---

## 数据层的三个核心机制

- **字段多来源**：同一字段可有多条来源记录（公共记录、Lark、人工、估算、AI），一条为主值。人工修改不覆盖旧值，只新增一条并设为主值；多来源不一致时界面标“有冲突”，人来选。
- **查重钥匙**：标准地址 + 地块号（APN）。新建项目命中已有房产会提示。
- **文件登记**：文件除了存，还登记类型、阶段、日期、对方、金额、来源；`extracted_text` 预留给后续 AI 抽取。

交易分析器把“买前估算”写成预算项，之后实际支出对着它记，估算准不准就有了对照（工作台“估算准不准”小组件）。

---

## 图表组件包

`frontend/src/components/charts/`：自建的“薄标记”图表，配色只用 Cloudscape 设计令牌（分类色前 7 位已用色盲可辨性脚本验证）。图形按“读者要做什么”选：

| 问题 | 组件 |
|---|---|
| 一个数字是多少 | `StatTile` |
| 一个比例离上限多远 | `Meter`（灰底 = 上限，超出段红） |
| 一组“实际 vs 目标” | `BulletList` / `InlineBar`（子弹图：灰底 = 目标，彩条 = 实际，超出段红，同组共用一把尺） |
| 一组量的大小 | `HBars` |
| 部分对整体 | `StackedBar`（可加参考线） |
| 随时间怎么变 | `Trend` |
| 流程走到哪 | `SegmentTrack` |
| 偏差是正是负 | `DeltaBadge` |

---

## 评审标注

每个功能块标题前有黄底黑字的字母圆标（同一页面内 A、B、C…），开会时口头引用（“总览 C 改进 xxx”）。对照表见 `docs/评审标注对照表.md`；顶栏“评审标注：开/关”可隐藏。

---

## 分工、阶段清单与更新记录（2026-09-11）

- **我是谁**：顶栏“我是：负责人 ▾”切换身份（A D J K L S W Z / 设计师 / 园丁 / 负责人，代号来自业务负责人手写流程，不写真名）。没有登录，身份存在本机浏览器，每个请求带 `X-Actor` 头。
- **蓝色圆标**：每个功能块标“谁负责”，映射在 `backend/app/dictionaries.py` 的 `OWNER_MAP`，前端 `components/OwnerTag.tsx`。
- **文件记“谁传的”**：`project_files.uploaded_by`；上传表单默认当前身份，负责人代传时按文件类型给默认（`FILE_DEFAULT_OWNER`）；登记表可按人筛。
- **更新记录**：`project_updates` 表，上传文件 / 改字段 / 记支出 / 加预算项 / 应用分析 / 编辑项目 / 勾清单时各记一条；工作台“谁更新了什么”、总览“最近更新”。
- **阶段清单**：`STAGE_CHECKLIST` 六个阶段（来自负责人的 24 条），每项带负责人和证据规则（`file:<类型>` / `field:<字段>` / `expense:any` / `manual`）；有证据自动打勾，其余手动勾存 `project_steps`；`backend/app/steps.py` 算“现在到哪一步、轮到谁、前面还有什么没勾”。总览“现在到哪一步”、工作台“每套房轮到谁”、头部阶段徽章都读它。
- **旧库补列**：`db.init_db()` 用 PRAGMA 查缺补漏，不引入迁移工具。

## 路线图

1. 接入公司 Lark：只读盘点 → 目标模型映射 → 清洗（AI 提议、人审批）→ 单向同步。
2. 接真实数据源：Google 地理编码与街景、RentCast、ATTOM、HouseCanary（见 `docs/候选API方案.docx`）。
3. AI：文件自动分类与抽取、街景风格与状况判断、助手接大模型（界面不变）。
4. 用公司历史项目替换分析器里的行业默认值（装修单价、持有月数、卖出比例）。

## 流程按录音稿重拆（2026-09-14）

- **五个阶段**：`STAGE_CHECKLIST` 改为负责人自己拆的 买 / 贷 / 设计定稿 + permit / 施工 + 采购 / 卖。每个阶段带一句 `desc` 说明谁管、什么是前提。
- **大节点 D + J 双勾**：带 `confirm: ["D","J"]` 的项在 `project_steps` 里存两条（`open_escrow:D`、`open_escrow:J`），两条都在才算过。`POST /steps/{key}` 用 `confirm_as` 指明替谁勾；当前身份就是 D 或 J 则不用传；负责人代勾记成“D（负责人 代勾）”。
- **水电瓦斯**：`utility_accounts` 每套房三行（water / electric / gas），`GET/PUT /api/projects/{id}/utilities/{kind}`。每家可保存官网或登录页网址，在新标签页打开；账号、登录名、密码支持复制当前输入值（密码仍默认隐藏，空值禁用）。网址仅接受 HTTP(S)，旧库启动时自动补充可空的 `website` 列。证据规则 `utilities:on`（三家都开过）/ `utilities:off`（三家都关）。
- **检查记录**：`inspections` 一次一行，`is_final` + `passed` 触发 `inspections:final`，`final` 大节点自动过；任一通过触发 `inspections:any`。接口 `/api/projects/{id}/inspections`、`/api/inspections/{iid}`。
- **保险到期**：`files.expires_at`；工作台“未来 30 天”和“需要关注”都会提。
- **分工调整**：J = Jessie，兼采购（原 A）；新增 PM；施工进度与临时安排由 L + D 定。permit 默认范围在 `PERMIT_RULE`（常识值，每套房可改）。
- **还没做**：采购清单（等 J 的采购表定字段，预算页留了位置）；密码谁能看（没有登录，回头定）。

## 角色、权限与交付物（2026-09-14 晚，流程审计 v2）

- 理解文档：`docs/流程角色与交付物_v2.md`（给客户核对；⚠ 项待确认）。
- **四级权限**：`ROLES` / `TIERS` / `PERMISSIONS` 在 `dictionaries.py`。紫 决策（老板、D、J）、蓝 统筹（负责人、L、PM）、青 执行（K、Z、S、W、A、设计师）、灰 外部（园丁、承包商）。后端 `common.require()` 越权返回 403；`project_out(actor)` 对青灰抹掉钱（`money_hidden`）；预算、分析、工作台三个路由整体挂 `_guard`。前端 `lib/role.ts::useRole()` 读同一份字典决定页签、按钮、首页。
- **交付物**：`STAGE_CHECKLIST` 每项带 `deliverable {kind: file|photo|field|record|confirm|tick}`；`files.step_key` 把文件挂到步骤；新证据规则 `photo:<step_key>`；大节点 `evidence: confirm` 只认 D、J 的勾。
- **清单表** `StepsPanel`：事 · 谁 · 要交什么 · 状态；按钮直接交（`UploadForm` 复用，`patchProject` 填数）。
- **我的待办** `pages/MyTodo.tsx`：青灰身份首页。
- 新文件类型：量尺记录、定稿图纸、permit 申请回执、offer、卖房文件包、签署版卖房文件、现场照片。

## 流程审计 v3（2026-09-14，以团队定稿为准）

团队定稿的完整流程（`专业流程 完整版.jpg`，6 段 33 项）与系统现有五段清单的逐项映射、门的位置、角色推断、缺失对象、要强制的前置和 24 个开放问题，见 `docs/流程审计与开放问题_v3.md`。下一轮按它重排清单。

## 第一批最小修复（2026-09-14 晚）

按两份审计核实的 P0：`compute_steps` 的"全部完成"要求前段无遗留；总览 B 面板按顺序渲染每段所有大节点；`final` 门要求最近一次 `is_final` 检查 passed；青灰身份在 steps 证据 / updates 文本 / files.amount / 下载四处抹钱（`MONEY_FIELDS`、`MONEY_DOCS` 在 `dictionaries.py`）；房产字段写接口加 `require(edit_project)`；非 `upload_any` 的上传人强制为本人、PATCH 不能改类型 / 步骤 / 上传人；分析器 `amortize()` 拆利息与本金，权益倍数改为回收现金 ÷ 现金投入（前后端同改）。

## 工作台按身份动态组合（2026-09-14）

`DASHBOARD_LAYOUTS` / `WIDGET_ACCESS`（`dictionaries.py`）定每个身份的默认小组件；`GET /api/dashboard/role` 一次返回该身份能看的专属块（待我确认的门、我的待办、采购异常、施工现场、水电瓦斯与保险、permit 与检查、设计交付、卖出文件、老板总览），没权限的块不返回。`/summary` 与 `/widgets` 对看不到钱的身份给无钱版。前端 `Dashboard.tsx` 按 `meta.dashboard_layouts[actor]` 生成默认布局，存储键按身份分开；`MyTodoTable` 同时给待办页和小组件用。

## 工作流集成 P1：归一（2026-09-14 晚）

差距分析见 `docs/工作流集成_差距分析.md`。P1 只改配置与派生逻辑：`STAGE_CHECKLIST` 改为六段（预买房 / 买房与过户 / 装修 / 预上市 / 卖房上市 / 售出收尾），每项加 `ws` workstream 标签，项 key 全部沿用；一段可多门（`stage_progress[].gates`，段推进要求所有门过）；门可以是证据门（`listing`，confirm 为空）；新增 `analysis:any` 证据与 `home_inspection`、`analysis` 两项；`projects.stage/substage` 由清单派生（`steps.sync_legacy_stage`，`project_out` 时写回），PATCH 忽略手改，编辑弹窗里只读，线索子阶段仍可手改。
