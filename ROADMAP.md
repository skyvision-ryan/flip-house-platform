# ROADMAP — 翻新项目平台（Flip House OS）项目地图

> 给任何接手的人或 agent（Claude Code / Codex / Cursor）看的一页地图：**现在在哪、怎么走到这、往哪走、到公司内部 AWS 上用要经过什么、哪些不能碰、怎么跑起来。**
> 基线：提交 `c826cf7` + 工作区里的 P1 归一改动（2026-09-14 晚，未提交）。中文为主，关键名词英文。

---

## 0. 先读什么，守什么规矩

**阅读顺序**
1. `CLAUDE.md` — 客户给的产品大方向（三层：数据 / 智能 / 执行；AI 简报；MVP 顺序）。
2. `FLIP_WORKFLOW_FOR_CLAUDE.md` — 工作流领域模型（六段、workstream、milestone、task、dependency、blocker、gate）。
3. 本文 — 现状、时间线、路线、基础设施、约束、上手。
4. `docs/工作流集成_差距分析.md` — 现有代码与领域模型的逐项映射、P1–P6 计划。
5. `docs/权威流程对照审计_2026-09-14.md`、`docs/流程审计与开放问题_v3.md` — 两份审计（问题清单、开放问题）。
6. `README.md` — 实现层说明（按时间追加，末尾最新）。

**不变量（改之前先问用户）**
- 界面只用 Cloudscape 组件、中文；**不要任何进度条 / 步骤条 / 轨道式 UI**（用户三次否决）；信息要少、要直观。
- 大节点（门）由 **D 和 J 各勾一次**才过；负责人可代勾并记"代勾"；青、灰身份**看不到任何金额**。
- 客户原始资料（录音稿、采购表、流程图 jpg/png）**不入库**（`.gitignore` 已列），只留本地。
- 提交只含 `backend/ frontend/ docs/ README.md`；推 `main` 触发 Render 自动部署；提交信息中文。
- 先讨论再动手：大改动先出方案（用户偏好）。

---

## 1. 现状快照（2026-09-14 晚）

| 项 | 现状 |
|---|---|
| 技术栈 | React 18 + TS 5 + Vite 6 + Cloudscape 3（含 board-components）；FastAPI + SQLAlchemy 2 + Pydantic 2；SQLite；一个 Docker 容器同时服务前后端；Render 免费实例 https://flip-house-platform.onrender.com（上传文件不持久） |
| 代码量 | 约 8,400 行（后端 Python + 前端 TSX/TS） |
| 数据表（15） | properties、property_field_sources、owners、mortgages、sales_history、projects、budget_lines、expenses、files、deal_analyses、project_updates、project_steps、utility_accounts、inspections、procurement_items |
| 接口 | 44 个：项目 CRUD、房产字段多来源、文件（挂步骤、到期日、按身份限下载）、预算 / 支出、交易分析、清单勾选与门确认、更新记录、水电瓦斯、检查记录、采购、工作台（summary / widgets / role）、meta |
| 业务模板 | `STAGE_CHECKLIST` 六段 31 项（P1），每项带 owners / evidence / deliverable / ws；六道 D+J 门 + 一道证据门 |
| 角色与权限 | 14 个代号，四级（紫决策 老板/D/J、蓝统筹 负责人/L/PM、青执行 K/Z/S/W/A/设计师、灰外部 园丁/承包商）；`PERMISSIONS` 字典 + `require()` 403；身份来自前端 `X-Actor` 头（**无登录**） |
| 界面 | 工作台 22 个小组件按身份组合；项目页五个页签（总览 / 分析 / 数据 / 文件 / 预算）；总览 B = 六张步卡 + 本步面板；我的待办；新建向导 |
| 示例数据 | 10 套房覆盖六段（`backend/app/seed.py`，删 `backend/data/app.db` 重启即重灌） |
| 已验证 | 各身份接口权限与抹钱、六段阶段派生、门双勾、final 前置、照片自动打勾、采购证据、分析器算例；浏览器走过 J 建项目 → L 交照片 → D 填价 → D/J 过门 → K 只见待办 |

---

## 2. 业务骨架一页

```text
① 预买房          ② 买房与过户           ③ 装修                      ④ 预上市        ⑤ 卖房上市              ⑥ 售出收尾
尽调 / 看房 /      融资 ∥ 检查 ∥ 测量设计    设计 ∥ permit ∥ 施工 ∥ 采购 ∥ 检查   staging ∥ agent   园林 · offer · 过户文件      关水电瓦斯
财务(算账、定价)   → ◆Close escrow → 水电   ◆可以开工 … ◆final(City验收)      → ◆上市(证据门)   ◆收到offer … ◆交割完成      退保险
→ ◆Open escrow
```

- **门（gate）**：`confirm: [D, J]` 的项，`project_steps` 存 `key:D`、`key:J` 两条，都勾才过；`listing` 是证据门（有挂牌日期即过）。当前段 = 第一段"还有门没过"的段；门后的事没做会进"前面没确认"，不阻塞。
- **交付物（deliverable）五种**：file / photo / field / record / confirm；交了就自动 done（`steps._evidence` 规则：`file:` `photo:` `field:` `expense:` `procurement:critical` `utilities:on|off` `inspections:any|final` `analysis:any`）。紫蓝可"手工确认（无证据）"，青灰不能。
- **阶段派生**：`projects.stage/substage` 由清单当前段推导写回（`steps.sync_legacy_stage`），只为旧筛选与状态规则；不再手改。
- **事实 vs 推断**：负责人确认过的写在第 7 节；角色与定稿项的对应、门的位置是我们的推断，见差距分析第 3、4 节。

---

## 3. 走到这里的时间线

| 日期 | 事 | 提交 |
|---|---|---|
| 09/08 | MVP 0：项目为中心的数据层、地址补全（mock）、字段多来源、文件登记、预算 vs 实际；Cloudscape 中文界面 | `09b7914` |
| 09/09 | 交易分析器（买入 / 持有 / 装修 / 卖出 / 最高出价）；Render 部署 | — |
| 09/11 | 与负责人对齐：她是"看"的人，各人自己填 → 身份切换、负责人圆标、更新记录、六阶段清单（24 条原稿） | `d02c204` |
| 09/14 上午 | 录音稿纠正：五段、水电瓦斯三家、permit 拿到文件才开工、检查次数不固定、D+J 确认大节点、施工 L+D 管 | — |
| 09/14 中 | 四级权限、交付物驱动清单、总览 B 四版迭代（最终：步卡 + 本步面板）、工作台 B/M 重排、检查记录、水电瓦斯、保险到期 | — |
| 09/14 下午 | 团队定稿流程图（6 段 35 项）、采购表；两份审计；第一批修复（完成误判、第二道门、final 前置、抹钱四处出口、权限漏洞、分析器本金） | `72ec551` |
| 09/14 下午 | Cursor 加采购模块与深链；评审后修四处；工作台按身份动态组合（22 个小组件） | `c826cf7` |
| 09/14 晚 | `FLIP_WORKFLOW_FOR_CLAUDE.md` 到；差距分析；**P1 归一**：六段模板 + workstream 标签、一段多门、阶段派生 | 未提交 |

---

## 4. 产品方向（不变）

```text
        数据层 ✅ 基本成型          流程层 🟡 进行中（P1 完成）           智能层 ⬜ 未开始
  房产 / 项目 / 文件 / 预算 /    六段 · 门 · 交付物 · 角色 · 工作台   输地址 → 尽调 + 估值 + 策略 + 预算
  分析 / 采购 / 检查 / 水电      ↓ P2–P6：任务实例 · 依赖 · 阻塞 ·    ↓ 公司历史回灌：估算 vs 实际
                                  下一步 · permit 循环 · 付款 · 高管视图
```

核心问题只有一句：**每套房现在在发生什么、什么卡住、谁负责、下一步是什么。**（FLIP_WORKFLOW §37）
CLAUDE.md 的"AI 属性简报"= 六段的第①段（预买房尽调 + 估值），排在 Phase D，前提是 Phase B 接上真实数据源。

---

## 5. 路线图

### Phase A — 工作流引擎（P2–P6，对应差距分析第 7 节）
| 步 | 做什么 | 完成标志 |
|---|---|---|
| P2 实例化 | `project_tasks` 表（从模板实例化 + 老项目迁移）；`compute_steps` 读实例；总览 B 按 workstream 分组；任务可改负责人 / 到期日 / 不适用 / 加自定义任务 | 一套房能定制清单，待办与总览一致 |
| P3 依赖与阻塞 | `task_dependencies`（finish-to-start）、`blockers` 表；READY / BLOCKED 派生；四条自动阻塞（permit 补件、检查没过、缺货、保险到期）搬后端；阻塞面板带负责人与解决 | 缺货 → 施工任务 BLOCKED，解决后恢复 |
| P4 下一步引擎 | 后端 `next_actions`：未完成 ∧ 依赖满足 ∧ 可操作，按逾期 / 阻塞 / 门 / 到期排序；替换 `next_up`、`my_todo` | 每套房前三条与人工判断一致 |
| P5 装修专项 | `permits` 多轮状态；施工工序里程碑进模板；检查挂里程碑；采购加 vendor / 预算 / 交期并生成阻塞；`payments` + 可付款判定（检查通过 + 审批） | 检查 failed → 里程碑 REWORK 且不可付款 |
| P6 高管视图 | 进度按里程碑；健康含阻塞；Closing / Listing readiness %；每日摘要自动生成 | 30 秒回答 FLIP_WORKFLOW §34 十问 |

### Phase B — 真实身份与真实数据
| 工作包 | 内容 | 依赖 |
|---|---|---|
| B1 用户与登录 | `users` 表（账号、显示名、角色代号、级别）；登录（先自建密码 / JWT，上 AWS 后可换 Cognito）；`X-Actor` 改为从会话取；角色代号与真名对应（J=Jessie，George / Tiffany 待确认） | 无 |
| B2 文件存储 | 上传改存 S3（本地开发用 MinIO 或本地目录开关）；缩略图；`files.stored_path` 改 key | B1 |
| B3 Lark 只读迁移 | 等开发者权限；导入现有表 / 文件夹；来源标 `lark`，不改原表 | 客户 |
| B4 房产数据源 | 接一家（候选见 `docs/候选API方案.docx`）：地址 → 房产字段 / AVM / comps；替换 `providers/mock.py` | 老板定预算 |
| B5 采购表字段 | 按 J 的表补数量 / 价格 / 供应商 / 交期 | 客户 |

### Phase C — 公司内部 AWS 上线
目标是**同一个容器**不改架构地搬上去，数据换成托管服务：

```text
用户（公司内网 / VPN 或 Cognito 登录）
   └─ CloudFront + ACM 域名（可选）
        └─ App Runner（或 ECS Fargate）跑现有 Docker 镜像（前端静态 + FastAPI）
              ├─ RDS PostgreSQL（替换 SQLite；SQLAlchemy 不用改模型）
              ├─ S3（文件 / 照片，替换 backend/data/uploads）
              ├─ Secrets Manager（数据库密码、API key、JWT 密钥）
              └─ CloudWatch Logs + 告警
```
| 工作包 | 内容 | 完成标志 |
|---|---|---|
| C1 数据库 | `DB_URL` 环境变量化；`_ensure_columns` 换 Alembic 迁移；SQLite → Postgres 导出导入脚本；seed 只在空库跑 | 本地 Postgres 跑通全部 curl 验证 |
| C2 存储 | B2 完成 + 生产桶策略（私有、预签名 URL 下载沿用身份规则） | 下载权限与现在一致 |
| C3 部署 | ECR 镜像；App Runner 服务 + 环境变量；健康检查 `/api/health` 返回提交号；`render.yaml` 保留为演示环境 | push main → 自动构建上线 |
| C4 访问控制 | Cognito 用户池（或公司 SSO）+ B1 的角色绑定；只开放内网 / 登录后访问 | 未登录 401，四级权限不变 |
| C5 运维 | RDS 自动快照 + 一次恢复演练；S3 版本化；CloudWatch 错误告警到 Lark 群 | 恢复演练记录在 README |
| C6 成本 | 量级：App Runner 小实例 + RDS t4g.micro + S3 ≈ 每月几十美元 | 老板确认 |

### Phase D — 智能层（CLAUDE.md 的核心承诺）
| 工作包 | 内容 |
|---|---|
| D1 AI 属性简报 | 输地址 → 尽调三项自动查（B4 数据源）+ 估值 + 装修策略 + 预算 + ROI，每个数带来源与置信度；LLM 只做编排与解释，不发明数字 |
| D2 历史回灌 | 已售项目的估算 vs 实际（预算、售价、工期）回到分析器默认值与置信度 |
| D3 每日摘要 | 从 `project_updates` + 阻塞 + 下一步自动生成负责人 / 老板的日报（先文本，后 Lark 机器人推送） |
| D4 提醒推送 | 到期、阻塞、审批请求 → Lark |

**顺序建议**：A(P2–P4) → B1 → C1–C3（先内部小范围用起来）→ A(P5–P6) → B2–B4 → C4–C5 → D。

---

## 6. 各阶段的"做完了"怎么判

- Phase A 完成 = 对 N Holmes、Parkville 两套示例房，30 秒内能答 FLIP_WORKFLOW §34 的十个问题（阶段、进度、在做什么、卡什么、为什么、谁负责、下一步、哪个里程碑有风险、是否按期、需要谁审批）。
- Phase B 完成 = 真人用自己的账号登录，看到自己的待办，传一张照片进 S3，Lark 里的一套房数据出现在系统里。
- Phase C 完成 = 公司内网打开域名即用，数据库在 RDS，做过一次恢复演练，一周无人工干预。
- Phase D 完成 = 输一个新地址，两分钟内得到带来源的简报，负责人能挑战每个数字。

---

## 7. 已定决策与约束（改前先问）

**负责人（客户对接人）确认的业务事实**
- 剪草在上市之后；水电瓦斯在 close escrow 时开；staging 要等 final 通过。
- 每个大节点由 D、J 一起确认；施工进度与临时安排由 L+D 管，PM 执行汇报。
- J = Jessie，兼采购；采购按需用节点分四组（水电检查前 / 长交期 / 防水后 final 前 / 院子）。
- 拿到 permit 文件才能开工；检查每套房 2–3 次不固定，不要固定打勾。
- 她是"看"的人，各人自己填；先电脑版后手机版；希望系统主动提醒（套数、卖出、超预算）。

**用户（产品负责人）的偏好**
- 不要进度条 / 步骤条；大节点能打勾要保留；页面信息少而直观；每个身份看到的东西不同，紫和老板最全。
- Cloudscape 风格、中文；先讨论再动手；提交前先本地看。

**明确不做（早期）**
- 完整 ERP、替代全部 Lark 流程、完整承包商 App、施工会计、自建 AVM、自建 MLS、通用工作流引擎、通知系统先于核心流程、AI 图生成。

---

## 8. 必须问清的问题（前 8 条，全表见差距分析第 8 节与权威审计第 10 节）
1. 门的位置与审批范围（老板要不要确认？"收到 offer"还是"接受 offer"过门？）
2. 第二 lender 的性质、"更新"与"解除登记"指什么。
3. 5.6 签署、交割、5.7 解除服务、6.1 售出各以什么事件为准。
4. 3.7 是内部进度检查还是市政中期检查；City 验收几次。
5. 装修付款按什么节点、谁批。
6. 园林、承包商选择、深度清洁、escrow/title、lender 收尾各由谁做。
7. 承包商进不进系统；执行角色是否需要看部分金额。
8. 角色代号与真名（George、Tiffany 是谁）。

---

## 9. 上手

```bash
# 后端
cd backend && python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
rm -f data/app.db && rm -rf data/uploads          # 重置示例数据（启动时自动灌 10 套房）
./.venv/bin/uvicorn app.main:app --port 8000
# 前端
cd frontend && npm install && npx vite --port 5180   # 代理 /api → 8000
npx tsc -b && npm run build                          # 提交前必过
```
- 切身份：顶栏"我是"，或浏览器 `localStorage.setItem('actor','K')`；接口用 `X-Actor: <URL 编码的代号>` 头。
- 快速验证（10 条）：`GET /api/health` 提交号；`GET /api/projects` 十套房当前段；`X-Actor: K` 看 `/api/projects/1` 钱为 null、`/api/projects/1/budget-summary` 403；`X-Actor: D` `POST /api/projects/4/steps/open_escrow` 200、`X-Actor: K` 403；`X-Actor: %E5%9B%AD%E4%B8%81` 传 `step_key=mow` 照片 201、传 permit 403；`GET /api/dashboard/role` 分别用 K / Z / 老板 看块不同；`POST .../steps/final` 对无 final 检查的项目 400。
- 部署：`git push origin main` → Render 自动构建，`/api/health` 的 `commit` 变成新提交号即上线。
- 客户资料在仓库根目录本地存在但不入库：`专业流程 完整版.jpg`（团队定稿流程）、`整理录音.rtf`、`项目采购进度(1).xlsx`。

**目录地图**
```text
backend/app/dictionaries.py   业务字典：六段模板、角色、权限、采购模板、工作台布局、文件类型
backend/app/steps.py          清单引擎：证据规则、门、当前段、阶段派生
backend/app/status.py         项目健康三态
backend/app/analysis.py       交易分析算式（前端 lib/analysis.ts 同步）
backend/app/routers/          projects 项目 · property_data 房产字段 · files 文件 · budget 预算 · analyses 分析 ·
                              steps 勾与门 · ops 水电与检查 · procurement 采购 · dashboard 工作台 · meta 字典 · lookup 地址
backend/app/seed.py           十套示例房
frontend/src/pages/           Dashboard 工作台 · MyTodo 待办 · AddProject 向导 · project/* 项目页五个页签
frontend/src/components/      StepsPanel 总览 B · UploadForm · MyTodoTable · InspectionsPanel · UtilitiesPanel · UpdatesList · OwnerTag
frontend/src/lib/             role 身份与权限 · stepActions 动作与深链 · insights 提醒规则 · analysis 算式 · meta 字典
docs/                         审计与方案文档；评审标注对照表（页面字母块）
```

---

## 10. 四天上线冲刺（2026-09-15 → 09-18）：公司内部小范围用起来

**范围铁律**：上线的是现在的六段流程（P1）。四天只做"能让真人安全地用"的四件事：登录、云数据库、云存储、部署。工作流引擎 P2–P6 放到上线后第一周起边用边补。理由：P2 要改数据模型并迁移老数据，和换数据库同周做会互相干扰。

| 天 | 目标 | 做什么 | 完成标志 |
|---|---|---|---|
| **D1 周一** 登录与配置 | 身份不再自报 | 后端：`users` 表（账号、显示名、角色代号、密码哈希、是否管理员）、`/api/auth/login`、`/api/auth/me`、`/api/users`（管理员增删改）；`get_actor` 改为从登录会话（HttpOnly cookie + 签名 token）取角色代号，`X-Actor` 只在 `DEMO_MODE=1` 时可用。前端：登录页、顶栏显示登录人、"我是"切换只对管理员且 DEMO_MODE 才显示。配置全部环境变量化：`DB_URL`、`STORAGE=local\|s3`、`S3_BUCKET`、`SECRET_KEY`、`CORS_ORIGINS`、`SEED_DEMO`。 | 本地 SQLite 下：未登录 401；K 登录只看待办；管理员建用户 |
| **D2 周二** 云数据库与存储 | 程序不改，数据换托管 | 本地 Docker 跑 Postgres 过完全部 curl 验证（第 9 节十条）；`SEED_DEMO=0` 时空库启动；文件上传改 `boto3` 存 S3，下载走后端校验权限后 302 到预签名 URL（保留本地目录模式给开发）；`.dockerignore` 排除 data；镜像推 ECR。 | Postgres + S3 本地模式跑通同一套验证 |
| **D3 周三** AWS 搭建与部署 | 内网能打开 | 一个 region 内：RDS PostgreSQL（t4g.micro，私有子网，自动快照 7 天）、S3 私有桶（版本化）、Secrets Manager 存 DB 密码 / SECRET_KEY、App Runner 服务跑 ECR 镜像 + VPC connector 连 RDS、CloudWatch 日志 + 5xx 告警；App Runner 自带 HTTPS 域名，公司域名 + ACM 可后补。首批用户由管理员建（老板、负责人、D、J、K、Z、L、PM）。 | `https://<apprunner>/api/health` 返回提交号；用真账号登录走一遍 J 建项目 → L 传照片 → D/J 过门 |
| **D4 周四** 试运行与缓冲 | 真房子进系统 | 与负责人一起把 2–3 套在建房手工录入（项目、买入价、日期、已过的门、已有文件）；跑 D3 的走查清单；修当天发现的问题；RDS 做一次手工快照并演练恢复到测试库；写 `docs/运维手册.md`（重启、看日志、改密码、恢复）。留半天缓冲给 AWS 权限 / 网络类问题。 | 负责人用自己账号打开，能看到真房子的当前段和待办；恢复演练有记录 |

**D1 完成情况（2026-09-14 晚）**：登录、账号管理、`get_actor` 走会话、配置环境变量化、水电密码分级——全部做完并验证（curl 十项 + 浏览器走查 K 登录 / 管理员建账号 / 演示模式切身份）。没做的：S3、Postgres（D2）。用户已定：自建账号密码；上线空库只建用户；水电密码存但只给紫蓝和 K；**AWS 还没有账号**，见下面开户单。

**AWS 开户单（用户 D1–D2 完成，做完 D3 才能建资源）**
1. 用公司邮箱在 aws.amazon.com 开账号（root）。绑公司信用卡。
2. root 立刻开 MFA（手机验证器）。root 之后只用来付账，不做日常操作。
3. IAM → 建用户 `flip-admin`，附 `AdministratorAccess`，开控制台登录 + 访问密钥；密钥放到本机 `aws configure`（不要发到聊天工具里）。
4. Billing → Budgets 建一个 $50 / 月告警到公司邮箱。
5. 选 region：建议 **us-east-2（俄亥俄）**，离 KC 近、价格低；所有资源都建在这一个 region。
6. 记下 12 位账号 ID，给我。
7. 可选：Organizations 里再开一个 `dev` 子账号做测试，这周先不用。

**上线后第一周（边用边补）**
- P2 任务实例（可增删改任务、改负责人、到期日、不适用）→ P3 依赖与阻塞 → P4 下一步引擎。每完成一步部署一次，用户反馈直接进开放问题清单。
- 采购表字段（等 J）、Lark 导入（等权限）、房产数据源（等预算）按到齐顺序插进来。

**上线前必须由你定的（D1 早上就要）**
1. AWS 账号与 region（谁有权限建资源；建议 us-west-2 或离 KC 近的 us-east-2）。
2. 登录方式：先自建账号密码（四天内可控）；Cognito / 公司 SSO 放到 C4。
3. 首批用户名单与角色代号对应（含 George、Tiffany 是谁）。
4. 上线时数据库是空库还是保留十套示例房（建议空库 + 一个"演示"环境保留示例）。
5. 密码类信息（水电瓦斯账户密码）是否允许存系统；不允许就 D1 一并改成"找 K 要"。

**明确不在这四天里**：P2–P6、Lark 迁移、真实房产数据、手机端、通知推送、公司域名、Cognito、Alembic（继续用启动补列，Postgres 下同样有效）。

**风险与兜底**
- AWS 网络（App Runner 连 RDS 的 VPC connector）最容易卡：D3 上午先做这一步；实在不通就临时让 RDS 公网可达 + 安全组只放 App Runner 出口 IP，D4 再收紧。
- 文件迁移：Render 上的示例文件不迁；真房子的文件从 D4 开始传。
- 回滚：Render 演示环境保留不动，出问题内部先用 Render 地址顶两天。
