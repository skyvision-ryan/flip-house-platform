# Native Chinese / English

KAN-53 is independent of the retained KAN-54 procurement workflow. Both locales ship in the application. There are no translation SDK requests, keys, metered services, subscriptions or new servers.

## Runtime contract

- `LanguageProvider` subscribes to one synchronous i18next instance and drives Cloudscape, `html.lang`, title and React rendering. Never put language in router keys, business-fetch effects, draft initialization, or board persistence.
- `display.language.v1` follows the device preference convention and is shared by login and authenticated pages. Storage failures fall back to the current session. The language control applies immediately; Done only closes the dialog.
- `catalog/*.json` contains semantic keys with `[zh-CN, en]` resources. `MessageKey`, paired resource checks, placeholder checks and plural checks guard additions. No sentence should be assembled by translating individual Chinese words.
- `systemText` is a compatibility boundary for known system labels/messages. Do not use it for arbitrary employee notes, identities, filenames or addresses. Prefer semantic keys for new UI. System metadata retains stable object identity and untranslated `code` / `value` fields.
- HTTP errors keep `detail` and add recognized `message_code` + `message_params`. Unknown messages retain their original details. Task events render their structured kind/before/after/participants; original text and employee reasons remain unchanged.
- New task/material templates carry a stable `template_key` and the original template name snapshot. A display alias is used only while the current name matches that snapshot. Renaming a material clears provenance. Existing rows without reliable provenance are not guessed or backfilled.
- Date-only values never become business-timezone instants. Explicit-offset timestamps use America/Los_Angeles; legacy naive timestamps retain their recorded clock. USD, precision, raw units and all calculations remain unchanged.

## Coverage and checks

Review every reachable route, not just navigation: login/settings; workspace and project list; new/edit project; overview/tasks/history; analysis/data/files/budget; procurement requirements/material details/orders/receiving/returns; utilities/inspections; users; design directions and all permitted role previews; assistant/help/card feedback; empty/loading/error/readonly states; Cloudscape dates/upload/pagination/ARIA.

`python3 scripts/check_local.py` discovers the resource/state guards and backend provenance/access regressions. The static scan excludes comments and checks JSX text/attributes, stable option values and filter state; it is not a substitute for browser inspection of API-generated content. Browser acceptance uses an isolated synthetic database, six role logins, desktop and a 390 px viewport, plus mid-edit language changes, rapid switching, refresh and logout/login. iPhone hardware acceptance remains a separate test.

## Terminology contract

| 中文 / term | English display | Meaning / boundary |
|---|---|---|
| 修改密码 / 重置密码 | Change password / Reset password | Self-service requires the current password; admin reset sets a replacement. Existing passwords cannot be viewed. Both revoke other sessions. |
| 开始托管 | Open Escrow | Purchase-decision milestone; not transfer of title |
| 完成购入过户 | Close of Escrow | Purchase closing; distinguish sale closing by context |
| 挂牌 | Listing / Listed for sale | Marketing/listing status; not sold |
| 软装布置 | Staging | Preparing the property for sale; not construction staging |
| 购房验屋 | Home Inspection | Buyer/property condition inspection |
| 市政最终检查 | Final Inspection | Latest final inspection fact; not every inspection |
| Permit 申请 / 签发 / 检查通过 | Permit application / Permit issued / Inspection passed | Distinct facts; an uploaded file is not approval |
| 采购需求 | Procurement requirement | What is needed; no payment or receipt implied |
| 订单 / 收货 / 退货 / 退款 | Order / Receiving / Return / Refund | Separate purchase facts; return does not imply refund |
| 未下单 / 已下单 | Not ordered / Ordered | Ordering progress only |
| 部分到货 / 已备齐 | Partially received / All required items ready | Receipt/requirement coverage; not financial completion |
| 未采购完成 | Procurement incomplete | Requirement remains unmet; may include unplaced or outstanding orders |
| 预计到货 / 实际收货 | Estimated arrival / Actual receipt | Estimate versus recorded business date |
| 到期 / 超期 | Due / Overdue | Estimated arrival is today / already past, while quantity is still outstanding; a list marker, not a receipt fact |
| 录入时间 | Recorded at | When the order record was created in the platform; distinct from the order date |
| 订单标题 | Order title | Optional buyer-given name for an order; merchant + order number remain the identity |
| 装修预算 | Renovation budget | Planned renovation amount |
| 商品金额 | Item amount | Order line amount; excludes unallocated order charges |
| 订单实付 | Recorded order payment | Recorded payment, not financial verification |
| 退款后净额 | Recorded net order amount | Payments minus recorded refunds |
| ARV | After-repair value (ARV) | Estimated value after renovation; not an actual sale price |
| APN | Assessor's parcel number (APN) | Parcel identifier; never translated |
| 贷款本金 / 利息 | Loan principal / Interest | Distinct inputs/costs |
| `profit_margin_pct` | Return on total cost | Existing formula: profit ÷ total costs × 100; not revenue profit margin |
| `roi_pct` | Return on cash invested | Existing formula: profit ÷ cash invested × 100; not annualized |
| 项目负责人 / 任务负责人 | Project lead / Assignee | Role versus assigned person; property owner is a different concept |
| 购买／持有公司 | Purchasing / holding company | Project-level optional text; independent of public-record Owner and order purchasing entity |
| 主负责人 / 协办 | Primary assignee / Assistant | One primary and at most one assistant on the same task; assistant assignment grants no additional module or approval rights |
| 任务条件已满足 / 本次记录已满足 | Task requirements met / Current record meets the requirement | Ordinary template tasks follow property evidence; ongoing construction, mowing and inspections are not permanently completed by one record. |
| 确认 / 审核 / 审批 | Confirm / Review / Approval | Use Approval only where the actual workflow is approval |

## Remaining free-content scope

Native catalogs do not translate employee-entered descriptions, remarks, custom names, old unstructured history, or old template-looking records without trustworthy provenance. Inputs always show and save the original. PDF/image/contract originals remain untouched. These are an explicit remaining scope, not a claim of complete English reading.

Zero-API-fee candidates: desktop Chrome's on-device Translator API (language-pack download, unsupported on mobile per official documentation); a locally executed open model through WASM/WebGPU (model download/storage, device CPU/GPU/memory and license review required). Neither has been connected or sent real business data. They do not currently establish a single, fast, professionally reliable solution across desktop and iPhone Safari at no added hosting cost. No free trial is treated as a permanent service.

A future content adapter must authorize the existing field first, translate only visible authorized content, protect identity/SKU/address/number/unit tokens, cache by account+record+field+content-version+target-language+glossary-version, deduplicate requests, discard stale results, clear on logout/account change, retain original on failure, and expose a small Original text action. It must never replace editor drafts or write translation results into business history. Local device processing avoids transmitting content but still requires actual device and terminology-quality evaluation.

## 所有后续开发者的交付协议

本文件是唯一维护说明，以上 Terminology contract 是唯一专业术语表。根 `AGENTS.md` 和 PR 模板只链接本文件。协议适用于所有开发助手和人员，不依赖个人记忆。新增或修改任何用户可见功能，中文、英文、业务正确性与英文排版必须同步完成。

### 复用入口与可照用的例子

- 资源：按模块放在 `frontend/src/i18n/catalog/*.json`，再导入 `resources.ts`。每个语义 key 对应严格的 `[中文, English]`，不要用中文作 key、重复英文页面或拼接词序。相同中文但业务含义不同要分 key，例如 `task.assignee` 与项目角色。
- React 页面用 `useLanguage()` 订阅，再用 `m()`（现有组件常用别名 `uiText`）。`m` 本身不会订阅 React。模块顶层不要把翻译结果存成常量；在 render 内计算，或沿用现有动态 getter。已有系统标签兼容入口是 `systemText`，新功能优先使用语义 key。
- `systemText` 不是内容翻译服务：只能传明确归属系统的标签，禁止对输入、姓名、地址、描述、附件名、历史原文一概调用它。

以下 key、函数和路径均已在仓库存在；新功能按含义新增资源，不借用语义不合适的 key。

```tsx
// 标题、按钮、表单、必填校验；见 components/DisplaySettings.tsx 等现有组件。
import { m } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
function Example() {
  useLanguage();
  // draft 保持原始输入；错误尽量存 code，render 时翻译。
  return <FormField label={m('procurementFields.required.quantity')}
    errorText={missing ? m('validation.required') : undefined}>
    <Input value={draft.quantity} onChange={({detail}) => edit(detail.value)} />
  </FormField>;
}
// 页面标题 m('settings.title')；关闭按钮 m('common.done')。
```

```ts
// catalog/events.json：整个句子作为资源；不要把“项”和 count 拼起来。
// "counts.items_one": ["{{count}} 项", "{{count}} item"]
// "counts.items_other": ["{{count}} 项", "{{count}} items"]
m('counts.items', { count: items.length });
m('event.assigned', { person: participant.name }); // 人名原值，不翻译。
// 下拉 label 与 value 分离；metadata 的 label 动态翻译，value 始终保留。
const options = meta.procurement_statuses.map(item => ({
  value: item.value, label: item.label,
}));
// selected value 仍是 pending_order；不得把 m(...) 存进筛选或权限判断。
```

后端系统错误在 `backend/app/message_codes.json` 注册稳定 code 及兼容原文，并在 `catalog/server.json` 给出双语。新增调用用现有模块的显式入口，不再新增靠中文判断的控制流：

```py
from app.message_codes import system_error
raise system_error(403, 'server.fileDownloadDenied', actor=actor)
# main.py 的 exception_metadata 保留 detail，并添加 message_code/message_params。
# 旧 HTTPException 仍走 message_metadata 兼容映射，不改变状态码和权限校验。
```

前端 API 错误经 `messageFromCode` 显示；未知错误原样保留以便诊断。分支判断用 HTTP status/稳定 code，不匹配中文句子。动态 params 可能含业务值，不要随意递归翻译。状态说明使用稳定状态字段选择完整句子；`stepDisplay.ts` 已按 `photo_count` 和 `final_inspection_passed` 判断，禁止恢复中文前缀判断。

历史事件沿用 `TaskEvent.kind/before/after/participant_names/reason` 与 `taskDisplay.ts:eventText`。新事件先定义稳定 kind 和事实参数，再加双语完整句子；事件原文及员工原因不修改。旧未知 kind 返回原始 `text`。禁止切换语言时生成事件、更新时间或通知。

任务及采购模板：

1. 在 `backend/app/dictionaries.py` 定义稳定 step key / `template_key`，在 `catalog/templates.json` 添加配对译名。
2. 初始化时只给新实例保存 `template_key`、`template_name_snapshot`。显示调用 `taskTitle`、`materialName`；订单只在可靠关联且名称仍匹配快照时用 `orderLineName`。
3. 人工改名后保留人工原文；不能按名称或排序猜测旧记录来源、批量回填或覆盖。
4. 单位保留原始 API 值，例如订单默认仍为 `件`。只在阅读界面映射已知单位；未知或人工单位保留原值。不能将 `each` 写回原来 `件` 的业务字段。单位的新别名须进入资源并测试中英创建结果一致。
5. 分析默认行也保留来源快照；编辑器展示原始 label，译名仅作阅读说明。不得把译文自动存回输入。

```tsx
// 日期与金额：lib/format.ts 的 dateStr/dateTime/money，不能直接 new Date(dateOnly)
<span>{dateStr(record.needed_on)}</span>
<span>{money(record.amount, 2)}</span> // USD；未知 —，0 是已知零。
<Button ariaLabel={m('imageViewer.close.image')} />
// 图表 label/tooltip/legend/empty/ARIA 一并走 m；数值、刻度和公式不变。
// Cloudscape 自定义 i18nStrings 同样使用 m；Provider 不会覆盖手写属性。
```

语言只影响显示。不得把语言放入 Router key、business fetch 的依赖、表单初始化或看板存储。`languageStore.ts` 只触发 React render；`LanguageProvider` 共用同一状态驱动 Cloudscape、标题和 html lang。不得在组件局部再建一套语言状态。

### 术语与变更审查

新增房产、施工、采购、财务术语时，先核对字段、分母、状态和实际流程，再同步本文件术语表及资源。特别核对 `analysis.py`：`profit_margin_pct` 是利润÷总成本，显示 Return on total cost；`roi_pct` 是利润÷现金投入；都不等于年化回报。Permit application / Permit issued / Inspection passed、Return / Refund 以及 Ordered / Received 必须保持区分。

改名时搜索资源 key、直接引用、API metadata、模板来源与事件显示；必要时保留旧 code 的兼容映射。词表只管显示，不替换 `role_code`、中文预算分类、文件阶段、接口 value 或权限标识。有业务歧义须明确字段和候选含义，不能将所有“确认”译成 Approval 或所有“负责人”译成 Owner。

### 自动检查与最小例外

快速检查（Node 22）：

```sh
cd frontend
npm run check:i18n
```

完整本地交付检查（仓库根目录）：

```sh
python3 scripts/check_local.py
```

`check_local.py` 自动发现全部 `*.test.ts` 和后端 tests；`.github/workflows/ci.yml` 明确执行 `npm run check:i18n`，后端 discover 包括 `test_native_i18n.py`。不得只新增脚本而不进入这两条执行链。

| 自动守卫 | 实际覆盖 |
|---|---|
| `coverage.test.ts` / `checks.ts` | 每份 catalog 已打包、key 不覆盖、双语二元结构、非空值、参数一致、复数双分支；直接翻译调用无失效 key/缺参；JSX 文本及属性、弹窗标题、ARIA、自定义提示对象、错误 setter 的中英文硬编码；裸 key 文本、翻译写入 value/key/filter、native option 缺少稳定 value |
| `i18n.test.ts` | 权限角色原值、metadata 身份、单位默认、模板来源/人工名称/旧记录、结构化事件、USD 精度、日期事实、storage 失败 |
| `state.test.ts` | 使用真实语言订阅及 React 18 renderer，连续切换时草稿、金额、人员、房屋、筛选、展开/弹窗状态和对象身份保留；不重新挂载或重复业务 effect |
| `backend/tests/test_native_i18n.py` | 后端 HTTPException/ValueError 字面量和格式字符串都必须有消息词库；运行时生成的任务说明/模板双语存在；code 参数协议、权限拒绝、旧数据不覆盖、分析显示来源不改变公式 |

扫描按语法与显示位置判断，不以“有汉字即错误”。注释、原始业务 code、测试 fixture、运行日志不是 UI 字面量。日期输入格式、URL/email 示例按严格语法识别。其他例外只能在 `coverage.test.ts` 写明 **文件 + rule + 精确文本 + 原因**，每条只允许一次命中，过期或重复出现都失败；禁止文件/目录豁免。后端动态构造的非字面表达式仍需人工追踪，不能拿漏扫当许可。

保留的负例测试会在内存临时制造缺英文、参数不一致、缺复数分支、空资源、失效 key、英文/中文硬编码、ARIA/弹窗遗漏等，确认被拦截；修正样例通过。错误样例不进入运行时资源。

自动检查不能证明：所有 API 动态内容已翻译、词义/专业质量正确、所有权限路径可达、长文案无溢出、真实页面的每个表单都保留草稿。React 回归验证的是全局订阅边界，具体表单仍须浏览器操作，不把它当全站验收。

### 日常验收范围与费用边界

普通业务修改只验收受影响的页面及交互：中英文、正常/空/加载/错误/只读、长英文与约 390px、切换中草稿及提交的原值、权限拒绝。全局语言状态、格式化、公共组件翻译或消息协议变化时，追加登录/退出、跨页、刷新、快速切换、各角色及关键采购流程。手机硬件、桌面浏览器模拟、单测、构建、CI 是不同验证结果，分别报告。

PR 按 `.github/pull_request_template.md` 填检查与剩余缺口；无需每次普通改动重跑全部页面。固定词库与 Cloudscape 消息随应用发布。**不得未经授权引入付费翻译 API、订阅、限时免费额度或新增服务器费用。** 本轮没有接通自由内容翻译，文首 Remaining free-content scope 持续作为真实边界：不能隐藏中文原文，也不能宣称已经实现全部英文阅读。浏览器整页云翻译不是本项目的零费用本地翻译承诺。

## KAN-53 本地交付验证记录

使用独立 `/tmp/flip-kan53-isolated` SQLite / uploads 与合成账号，未访问或修改 Render 数据。地址为 `http://127.0.0.1:8053`（本地进程运行时可用）。以下是实际操作记录，不表示所有组合均已验收：

- 管理 J、采购、财务、Permit/设计、项目助理、管理员六种账号均实际登录，英文偏好在退出再登录后保留。登录页、工作台、导航、显示设置及管理员用户列表已查看。
- 项目总览、任务摘要/采购历史、资料、水电空态、文件列表/上传表单、预算空态/支出弹窗、分析版本/默认行/指标已查看。旧分析无来源名称保留原文；新分析显示 Light renovation / Version 和默认行译名，编辑原文仍明确可见。
- 合成采购订单：两件 × $123.45，实付 $246.90；收到一件，再登记一件完好退货及 $123.45 退款。订单、收货、退货和历史显示分离，项目摘要显示净额 $123.45，切换另一房屋显示无订单。
- 填写中的订单数量、单价、实付、房屋、搜索词与已选材料在 English → 中文 → English 后保留并成功提交。文件表单对手方/金额草稿及展开状态也已实测保留，切换期间业务请求计数不变。英文模板名称搜索在两种语言下保持匹配。
- 助理待办空态与助手建议、设计/Permit 角色预览及说明已查看；姓名、合成 PDF 文件名和备注原文保留。
- 桌面与 390px viewport 检查显示设置、长房名、采购列表及详情。窄屏语言控件保留两个选项；未发现页面水平溢出。截图保存在本地验收目录，PR 说明与交付消息列出入口。
- `python3 scripts/check_local.py` 已通过：后端 215 项，hooks 17 项，脚本工具 24 项；后续局部 UI 修复再跑前端 190 项、双语专项 17 项和构建。最后一个复数标签修复复跑专项和构建。CI 配置显式运行相同专项，远端运行结果以 PR checks 为准。

仍未验证：iPhone/Safari 真机、所有角色预览的每一种交互组合、所有真实历史格式、每个表单的人员选择/嵌套弹窗切换。现有验收不是“全站全部组合通过”的声明。自动扫描的覆盖边界见上文；后续改动按受影响范围复验，不开启无关改造。

2026-10-02 紧急批次术语：今日新建 = New today。按 America/Los_Angeles 的创建日期判定；无时区历史记录不猜算。公司名、人名、协作备注和历史原文不翻译。公司／选人草稿、备注、列表筛选及展开状态的中英切换按本批路径验收，详见当前实现与版本核验。

未完成：自由中文内容自动英文阅读（含员工备注、自定义名称、未知非结构化历史及无可靠来源旧模板/旧分析名称）；附件翻译不在本轮。已识别的系统采购订单动态有兼容译法，未知原文不猜译。桌面本地翻译候选仅完成官方能力文档核对，尚未接入、测速或评测专业质量；不能保证跨设备零费用且快速准确。参考：[Chrome Translator API](https://developer.chrome.com/docs/ai/translator-api)、[Transformers.js](https://huggingface.co/docs/transformers.js/en/index)。
