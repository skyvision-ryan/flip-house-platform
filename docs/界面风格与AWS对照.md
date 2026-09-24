# 界面风格与 AWS Cloudscape 对照审计

## 当前产品口径 · KAN-75 卡片整理

Ryan 本轮明确授权全站卡片的字体、结构与辅助信息整理，并采用克制的 Amazon 橙色。**本节是当前口径；下方 KAN-49 / KAN-64 色圈、字母标注和色相统计是历史审计，不再作为新界面的验收规则。**

- 保留 Cloudscape 组件、深色顶栏与中性背景。按 Ryan 本轮反馈恢复原字体体系：Open Sans 正文、Helvetica Neue 标题，Cloudscape 默认字号 / 行高 / 字重（表格正文 14/20）；主操作用橙底深色字，链接与选中状态用蓝，红绿只表达真实状态。橙色是用户授权的产品主题，不是声称 Cloudscape 官方主按钮必须为橙色。容器 16px、主按钮圆角与线框小图标统一；官方参考：[Visual style](https://cloudscape.design/foundation/visual-foundation/visual-style/)、[Iconography](https://cloudscape.design/foundation/visual-foundation/iconography/)、[Colors](https://cloudscape.design/foundation/visual-foundation/colors/)、[Typography](https://cloudscape.design/foundation/visual-foundation/typography/)。
- 任务安排用单行选择：点行呈浅蓝底与完整蓝框，右侧同步摘要；取消 checkbox 和批量分派入口。负责人头像 / 编辑笔进入单项分派，键盘也可操作；真实员工使用中性字母头像，待分派使用虚线圆形加号。
- 五段位置条采用浅蓝已完成 / 深蓝当前 / 灰色未到达；紧凑表格用 8px 分段轨道，头卡配官方对勾与“当前”文字，不在轨道里塞圆点或字符。
- 卡片按「标题与操作 → 当前事实 → 数据 / 表单 → 次要入口」组织。主值与标签分层，宽度不足时收列；房屋头卡的小图、身份、阶段事实分开。数据来源使用中性浅底标签；无数据 / 待核实不能包装为确定事实。
- 顶栏「显示设置」提供两个独立开关：**辅助说明**与**卡片编号**，默认关，设备本地记忆。说明用统一浅底信息栏；错误、风险、状态、来源、金额参考、必填条件及实际任务要求始终保留。原 `roleColors` 偏好不再读取，角色色圈入口和渲染代码已删除；真实员工的中性字母头像保留。
- 编号是组件的稳定身份：`frontend/src/lib/cardRegistry.ts` 显式分配 1–99，不按渲染顺序、筛选结果或角色编号。重复实例共用组件号，通过项目 / 任务上下文和路由区分；点击复制反馈位置，不自动建票或发送消息。
- 维护约定：卡片使用 `components/ui/Surface` / `Table` / `ExpandableSection`；`Header.description` 放事实、`Header.help` 放说明。表单 `description` 只放可隐藏的解释，必要约束放 `constraintText` / `errorText`；动态的任务要求不得放进 `HelpText`。新卡片从注册表分配未使用编号，不回收旧编号。
- 验收按真实页面进行：清爽、只说明、只编号、双开四种组合；切页 / 刷新持久化；编号复制后可粘贴；说明关闭不隐藏任务状态、来源或风险；桌面与窄屏无页面级横向溢出。浏览器窄屏模拟与真机 iPhone 验收分开记录。

## 历史审计 · KAN-49 / KAN-64

KAN-49 的产出。业务反馈「UI 太花里胡哨，颜色多，但颜色应该用来提醒状态」，
`docs/产品方向与执行原则.md:52` 已把「颜色只用来提示状态」写成产品原则。这份文档把原则变成
**可复算的判据**，再逐条对照代码。

审计日期 2026-09-21，基线 commit `aa53e7f`。

---

## 1. 范围与依据

三处依据，都不靠印象：

| 依据 | 具体 |
|---|---|
| Cloudscape 官方规范原文 | `cloudscape.design` 的 [Colors](https://cloudscape.design/foundation/visual-foundation/colors/)、[Typography](https://cloudscape.design/foundation/visual-foundation/typography/)、[Status indicator](https://cloudscape.design/components/status-indicator/)，2026-09-21 抓取 |
| 令牌真值 | 本机 `frontend/node_modules/@cloudscape-design/design-tokens@3.0.112` 的 `index-visual-refresh.json`，386 条带 light 值的颜色令牌 |
| 我们自己的界面 | 本机 dev server 实测，改前截图与扫描结果在 `docs/reference/ui-audit-2026-09-21/before/` |

版本钉死：`@cloudscape-design/design-tokens` 3.0.112、`components` 3.0.1365、`board-components` 3.0.226。

**范围**：`frontend/src`。后端 `backend/app/dictionaries.py` 的 tier 配色属于 API 契约，本票不动（见 A23）。

---

## 2. 方法：为什么这套判据可复算

### 2.1 采集面只有两处

`frontend/src` **零 CSS 文件、零 `@media`、零 CSS-in-JS**（实测：`find frontend/src -name '*.css'` 无结果，
`grep -rn '@media' frontend/src` 无结果）。所以「我们自己选的颜色」只有两条出口：

1. 内联 `style` 属性
2. 手写 SVG 的 `fill` / `stroke`

经 Cloudscape props 渲染的颜色（`Badge color`、`StatusIndicator type`）带 `awsui_*` 类，由组件体系负责，
**按定义合规**，不在采集面内。采集面因此可以收得极窄且无遗漏。

采集脚本 `scripts/ui_color_scan.js`，只采不判。三条降噪规则：

- 不可见元素（`getClientRects().length === 0`）跳过
- 边框色只在真有边框宽度和样式时才算
- 文字色只在元素**自己有文字节点**时才算——否则 `color` 只是继承值，屏幕上并不出现
  （不加这条，工作台一屏会多报 840 个 `rgb(0,0,0)`）

### 2.2 判定不看 DOM，只看值命中哪个令牌

判定在 `frontend/src/lib/colorPolicy.ts`，纯函数、有单测（`colorPolicy.test.ts`，9 条）。

一开始想靠祖先类名区分「在 StatusIndicator 里」和「我们自己上的色」，**实测走不通**：页面上压根没有
`status-indicator` 类名，手写图表所在的 `div` 也没有任何类名或 `data` 属性。

但实测同时给了更好的办法——**StatusIndicator 的颜色本就精确等于 `color-text-status-*` 的值**
（实测 `rgb(0,128,47)` = `#00802f` = `color-text-status-success`），图表色等于 `color-charts-*` 的值。
按值反查令牌既不依赖 DOM，也就没有「这块算不准、留给人工核」的缺口。

五分类，优先级从上到下：

| 分类 | 判据 | 计入指标 |
|---|---|---|
| `neutral` | 见 2.3 | 否 |
| `status-token` | 命中 `color-{text,background,border}-status-*` 或 `color-charts-status-*` | 否 |
| `charts-token` | 命中其余 `color-charts-*`（data-vis 体系） | 否，但单列 |
| `interaction` | 命中 `color-text-link-*`、`color-background-button-primary-*` | **是** |
| `offending` | 其余非中性色 | **是** |

### 2.3 中性阈值：按实测定，不拍脑袋

阈值是这套指标唯一带主观性的旋钮。2026-09-21 把两边都量了一遍：

| | 饱和度 | 亮度 | 色值 |
|---|---|---|---|
| 中性侧最高 | 27.3% | 95.7% | `#F7F5F1` 我们的暖白页底 |
| | 26.8% | 8.0% | `#0f141a` Cloudscape 的 `color-text-body-default` |
| | 15.8% | 92.5% | `#e9ecef` 占位底 |
| | 13.4% | 60.6% | `#8d99a8` 次要文字灰蓝 |
| 违规侧最低 | **73.6%** | 65.9% | `#688AE8` 图表系列蓝 |
| | 78.7% | 57.6% | `#7A3EE8` tier 紫 |
| | 97.6% | 51.4% | `#FCCC0A` 评审黄 |

中间隔着 **46 个百分点**的空档。取值：

- 饱和度 < **35%** → 中性（落在空档中央，两侧都有大余量）
- 亮度 > **93%** 或 < **12%** → 中性（`#0f141a` 和 `#F7F5F1` 饱和度偏高但人眼读不出色相）

改这三个数就是改验收口径，要同步改这一节。

### 2.4 指标定义

> **一屏非状态色色相数 = `interaction` ∪ `offending` 两类样本，去重后落进多少个色相桶。**
> 色相桶 12 个，每桶 30°。

这正好解释票面的「0–2」：

- 关掉评审标注 = **1 桶**（Cloudscape 交互蓝）
- 打开 = **2 桶**（再加评审黄）
- 出现第三个色相就是失败

已知性质：0° 与 359° 分属不同桶（桶 0 与桶 11），红色跨桶边界。这是分桶必然，不是缺陷——
红色系即便跨两桶也说明确实有两种偏色的红，正是要报出来的。

### 2.5 复现命令

```bash
# 1. 起 dev server（后端 8000、前端 5180）
# 2. 浏览器里注入 scripts/ui_color_scan.js，结果存成 scan-<路由>-<宽度>.json
# 3. 汇总
node --experimental-strip-types scripts/ui_color_report.ts docs/reference/ui-audit-2026-09-21/before
```

**基线必须固定四项**，否则改前改后不可对照（`Dashboard.tsx:78,88` 与 `App.tsx:56` 都按 actor 存 localStorage）：
`actor=负责人`、`reviewTags=on`、Dashboard 布局 key 清空走默认、同一份演示数据。本次基线已固定，记录在每个
scan JSON 里。

---

## 3. 汇总：改前 → 改后

| 路由 | 宽度 | 样本 | 中性 | 状态色 | 图表色 | 交互 | 违规 | **非状态色相数** | 页面级横向滚动 |
|---|---|---|---|---|---|---|---|---|---|
| `/` 工作台 | 1440 | 1756 | 1438 | 127 | 31 | 0 | 160 | **5** | 无 |
| `/` 工作台 | 375 | 440 | 414 | 4 | 0 | 0 | 22 | **2** | 无 |
| `/projects/1` 项目总览 | 375 | 315 | 253 | 23 | 3 | 0 | 36 | **3** | 无 |

改前的七个违规色（桌面工作台一屏）：

| 色值 | 出现次数 | 色相桶 | 是什么 |
|---|---|---|---|
| `#0972d3` | 60 | 6 | 手写的旧 info 蓝 |
| `#8d6605` | 36 | 1 | 手写的旧 warning |
| `#fccc0a` | 21 | 1 | 评审黄圆标 |
| `#7a3ee8` | 15 | 8 | tier 紫（决策） |
| `#037f0c` | 14 | 4 | 手写的旧 success |
| `#d91515` | 7 | 0 | 手写的旧 error |
| `#0e8a8a` | 7 | 6 | tier 青（执行） |

图表 data-vis 色（官方体系，不计入指标）：`#014a87` `#015292` `#015b9d` `#0166ab` `#0273bb` `#2ea597` `#688ae8` `#c33d69`

**页面级横向滚动改前就已经是 0**：6 条路由 × 375/390/430 共 15 组测量全部 `scrollWidth == clientWidth`，
记录在 `before/overflow.json`。这一项本票只需保证不回归。

### 改后

| 路由 | 宽度 | 评审标注 | 样本 | 中性 | 状态色 | 图表色 | 违规 | **非状态色相数** | 页面级横向滚动 |
|---|---|---|---|---|---|---|---|---|---|
| `/` 工作台 | 1440 | 默认（关） | 1880 | 1683 | 166 | 31 | **0** | **0** | 无 |
| `/` 工作台 | 375 | 默认（关） | 1182 | 1035 | 114 | 23 | **0** | **0** | 无 |
| `/projects/1` 项目总览 | 375 | 默认（关） | 406 | 380 | 23 | 3 | **0** | **0** | 无 |
| `/` 工作台 | 1440 | `on`（开会态） | 1943 | 1683 | 166 | 31 | 21 | **1** | 无 |

**改前 5 / 2 / 3 → 改后默认态全部 0，开会态 1。** 票面要求 0–2，达标。

#### 讲解开关（KAN-64 之后按四档看）

界面有两个**默认关**的讲解开关，各自带进自己的色相。要紧的是默认态不变。
下表左栏是**上限**（验收看「有没有超」），右栏是 KAN-64 的实测：

| 状态 | 上限 | 实测 | 来源 |
|---|---|---|---|
| 两个都关（默认） | ≤ 1 | **0** | Cloudscape 交互蓝（该屏没出现） |
| 只开评审标注 | ≤ 2 | **1** | + 评审黄 `#FCCC0A` |
| 只开角色色圈 | ≤ 4 | **1**（预算页 **2**） | + tier 青 `#0E8A8A`、蓝 `#0972D3`（同属 6 号桶）、紫 `#7A3EE8`（8 号桶） |
| 两个都开 | ≤ 5 | **2** | 以上全部 |

实测条件：`/projects/1` 的总览页与预算页 @2240px、身份「负责人」，六组扫描结果在
`docs/reference/ui-audit-2026-09-21/kan64/`，用 `scripts/ui_color_report.ts` 算的。
**默认态两页都是 0**，KAN-49 的成果没有被推翻。

实测低于上限不是偶然，三个原因都可复现：该屏没有链接/主按钮，交互蓝不出现；
**tier 蓝与 tier 青落在同一个 30° 色相桶里**，四种 tier 色不等于四个色相；
tier 灰饱和度低于中性阈值，算中性、不进桶。总览页测不到 tier 紫（没有决策级负责人），
所以预算页单独测了一组——那屏 `budget.approve` 归 J（紫），实测 2 桶，仍在上限内。

#A07 与 #A09 判「违反」，针对的是那些颜色**默认常亮、且是唯一通道**的用法。
放在显式的、默认关的开关后面不在此列——日常使用一个都不出现，讲解时才点开。

改前那七个违规色全部消失：四个旧状态色换成令牌后被认出来是状态色（`#db0000`/`#00802f`/`#855900`/`#006ce0`），
tier 紫与青不再上色，评审黄改默认关。开会态那 1 个色相就是评审黄本身——这正是指标「0–2」的由来。

改后重测页面级横向滚动：又跑了 12 组（6 条路由 × 390/430 与 375 的补测），**全部 0**，无回归。

**字体核对**（不靠目测）：`body`、`html`、任一 Cloudscape 组件、任一标题的
`getComputedStyle().fontFamily` 现在**全部是** `"Helvetica Neue", Helvetica, "PingFang SC", Arial, sans-serif`。
改前 `body` 是 `"PingFang SC"`（浏览器默认）而组件是 Open Sans 栈，两种字体。

---

## 4. 一条贯穿全局的事实：令牌真值已经漂移

`@cloudscape-design/design-tokens` 的 JS 导出是 `"var(--token-hash, fallback)"` 字符串，
**`fallback` 永不生效**。我们代码里手抄的那批值全是旧版：

| 语义 | 令牌当前真值 | 代码里写的 | |
|---|---|---|---|
| error | `#db0000` | `#d91515` | 过期 |
| success | `#00802f` | `#037f0c` | 过期 |
| warning | `#855900` | `#8d6605` | 过期 |
| info | `#006ce0` | `#0972d3` | 过期 |
| background-status-error | `#fff5f5` | `#fff5f5` | 一致 |

**后果有两层**：

1. 同一屏上**两个不同的蓝并存**——我们手写的 `#0972d3`（60 次）和 Cloudscape 组件自己渲染的
   `#006ce0`（18 次）。红、绿、黄同理。
2. 更要紧的是：**手抄的值命不中令牌，就判不出状态色**，只能归进违规候选。这正是指标从 5 降到 0–1
   的主要来源——不是「把颜色藏起来」，是「让表状态的颜色真的被认出来是状态色」。

换令牌后这几处颜色会**肉眼可见地变一点**。这是预期内的正确变化，不是回归。

---

## 5. 逐条审计表

判定三档：**违反**（与官方规定冲突）、**偏离但保留**（有意为之，记录理由与回退）、**合规**。
编号固定不重排，提交信息按 `审计 #A07` 引用。

| 编号 | 位置 | 我们的做法 | Cloudscape 的规定 | 令牌真值 | 差在哪 | 判定 | 处置 | 归属 |
|---|---|---|---|---|---|---|---|---|
| A01 | `pages/Dashboard.tsx:209-210` | insight 条硬编码 6 个 hex：`#d91515`/`#8d6605`/`#0972d3` 边框文字 + `#fff5f5`/`#fffbf0`/`#f3f8ff` 底 | 「use design tokens rather than the constants below」（Visual mode compliance） | error `#db0000`、warning `#855900`、info `#006ce0` 三个都已漂移 | 抄了旧常量，判不出是状态色 | 违反 | 改白底 + `StatusIndicator` | KAN-49 |
| A02 | `pages/Dashboard.tsx:305` | gate 菱形 `border: 2px solid #0972d3` | 同上 | `#006ce0` | 硬编码且已过期 | 违反 | 改中性边框令牌 | KAN-49 |
| A03 | `pages/Dashboard.tsx:386` | 当前阶段行 `#f3f8ff`/`#f8f8f8` 底 + `#0972d3`/`#8d99a8` 左边条 | 同上 | 同 A01 | 用整块彩色底表「当前」 | 违反 | 改白底 + `StatusIndicator` | KAN-49 |
| A04 | `pages/Dashboard.tsx:435` | 水电瓦斯状态点：10px 圆点，`#037f0c`/`#8d6605`/`#5f6b7a`/`#d1d5db` 四色，唯一补充是 `title` 属性 | 「**color should never be the only visual means of conveying information**」（Using color） | success `#00802f`、warning `#855900` 已漂移 | **颜色是唯一通道**。`title` 只在 hover 时出现，iPhone 上没有 hover，等于没有 | 违反（两条：唯一通道 + 旧常量） | 改 `StatusIndicator`，图形与文字承担含义 | KAN-49 |
| A05 | `pages/Dashboard.tsx:470` | `✓`/`○` 用 `#037f0c`/`#8d99a8` | 同 A01 | `#00802f` | 符号已是第二通道，但色值硬编码且过期 | 违反（仅色值） | 换令牌，符号不动 | KAN-49 |
| A06 | `pages/Dashboard.tsx:422` | 照片占位底 `#e9ecef` | 同 A01 | 中性，无对应状态令牌 | 硬编码，但是纯装饰中性色，不贡献色相 | 违反（仅来源） | 转令牌 | **KAN-45** |
| A07 | `components/ReviewTag.tsx:17` | 评审黄圆标 `#FCCC0A`，46 处渲染、11 个文件，**默认开** | 「Red and green status colors should be used mainly to indicate the status of resources」（Using color） | 无对应令牌 | 不表任何状态，却是全页饱和度最高（97.6%）的颜色；工作台一屏 21 次 | 违反 | **默认关**，顶栏开关保留；组件与字母 ID 一个不动 | KAN-49 |
| A08 | `components/ReviewTag.tsx:18` | 硬写 `fontFamily: '"Helvetica Neue", Helvetica, Arial'` | 排版应走 `fontFamilyBase` 令牌 | — | 绕开字体体系，改主题它不跟随 | 违反 | 删掉这行，跟随全局 | KAN-49 |
| A09 | `lib/role.ts:6` + `components/OwnerTag.tsx:12,21` | 角色 tier 四色 `#7A3EE8`/`#0972D3`/`#0E8A8A`/`#7D8998`，圆标底色 | 同 A07 | 无对应令牌 | 颜色编码的是**角色层级**，属分类信息不是状态 | 违反 | KAN-49 改中性底、级别用文字；**KAN-64 按 #A07 的先例补了一个默认关的独立开关**，打开才按 tier 上色，只作用于节标题 | KAN-49 / KAN-64 |
| A10 | `App.tsx:114` | 顶栏底边 `3px solid ${tierInfo.color}` | 同 A07 | 无对应令牌 | tier 四色的**第二个运行时出口**，不走 `colorOf`；位置最显眼，换身份整条边变色 | 违反 | 改中性 | KAN-49 |
| A11 | `App.tsx:71` | 身份菜单文案写死「（紫）（蓝）（青）（灰）」 | — | — | 去色后文字指向不存在的东西 | 违反（配套） | 去掉颜色名 | KAN-49 |
| A12 | `pages/project/ProjectPage.tsx:34` | `STAGE_COLOR = { lead:'severity-low', active:'severity-medium', portfolio:'green' }` | 同 A07 | — | 用**严重度**令牌表**阶段**：线索项目顶着「低告警」色，在建顶着「中告警」色 | 违反 | 三个值全改中性，区分靠已有 label | KAN-49 |
| A13 | `components/SourceBadge.tsx:7-9` | 来源徽章 `manual:'green'`、`public_record:'blue'`、`model:'severity-low'`、`ai:'severity-medium'` | 同 A07 | — | 用状态色与严重度令牌表**数据来源** | 违反 | 统一中性，来源靠文字与 `Popover` | KAN-49 |
| A14 | `pages/project/FilesTab.tsx:85` | 第二套来源徽章 `Badge color={lark ? 'grey' : 'blue'}` | 同 A07 | — | 不走 `SourceBadge`，只改那个会漏 | 违反 | 同 A13 | KAN-49 |
| A15 | `components/FieldWithSource.tsx:47` | 绿色标「主值」 | 同 A07 | — | 「哪个是主值」是**指定**，不是状态 | 违反 | 去色 | KAN-49 |
| A16 | `components/FieldWithSource.tsx:52` | 红色标「有冲突」 | 「用于提示资源状态，便于用户采取行动」 | — | 冲突是真状态，红色用对了 | **合规** | 不改 | — |
| A17 | `pages/Login.tsx:26` | 页面底色 `#f2f3f3` | 同 A01 | `theme.ts:8` 设的是 `#F7F5F1` | 登录页冷灰、进入后暖白，同一产品两个底色 | 违反 | 统一到 `colorBackgroundLayoutMain` | KAN-49 |
| A18 | `index.html` / `theme.ts` | **`body` 根本没声明字体**。实测 `html`/`body`/`#top-nav` 计算值是 `"PingFang SC"`（Chrome 对 `lang="zh-CN"` 的默认），而 Cloudscape 组件是 `"Open Sans", "Helvetica Neue", Roboto, Arial, sans-serif` | 「Open Sans is the primary and default font of Cloudscape.」（Typography） | `fontFamilyBase` = `'Open Sans', 'Helvetica Neue', Roboto, Arial, sans-serif` | **同一页面两种字体**：我们自己的 div 用浏览器默认，Cloudscape 组件用 Open Sans。中文两边都落到 PingFang 看不出来，但拉丁字符（数字、日期、代号）是两种字形 | 违反 | `body` 与主题令牌用同一个栈 | KAN-49（票面未列，本次新增） |
| A19 | `theme.ts` | 未覆盖任何 `fontFamily*` 令牌 | 官方字体栈是 `"Open Sans", Helvetica, Arial, sans-serif`；文档**未声明禁止更换字体** | 三个字体令牌各自一份字面量，`fontFamilyHeading`/`Display` 不引用 base | 按业务口味换成 Helvetica 栈 | **偏离但保留**（见第 6 节） | 三个令牌一起覆盖 | KAN-49 |
| A20 | `components/charts/palette.ts:20-46` | `tok('令牌名','兜底值')` 里 26 个 hex，其中 `#D91515`/`#037F0C`/`#8D6605` 已过期 | 同 A01 | 见第 4 节 | 兜底值永不生效（JS 导出是 `var(...)` 字符串），只在令牌名拼错时才会暴露 | **合规，记一笔** | 可顺手更新，非必须 | KAN-45 |
| A21 | `components/charts/*` 的分类系列色 | `#688AE8` `#C33D69` `#2EA597` 等，取自 `colorChartsPaletteCategorical*` | data-vis 有独立配色体系 | 全部命中 `color-charts-*` | 是官方体系内的用法，且图表另有长度/位置通道 | **合规** | 不改 | — |
| A22 | `components/charts/DeltaBadge.tsx` 的 ▲▼■ | 颜色 + 图形双编码 | 「color should never be the only visual means」 | — | 符合「不以颜色为唯一手段」 | **合规** | 不改 | — |
| A23 | `backend/app/dictionaries.py:122-127` | `/api/meta` 下发 tier 四色，运行时优先于前端常量 | — | — | 前端停止消费后，字段仍在契约里 | **保留** | 不动；要删由另一张票 | 后端契约保留 |
| A24 | `components/CoverImage.tsx:5,24` | 内联 SVG 占位图 6 个 hex | 同 A01 | 实测 `#E9ECEF` `#B6BEC9` `#CBD2DA` `#8F9BAA` `#FFFFFF` **全部是中性灰** | 硬编码，但一个色相都不贡献 | 违反（仅来源） | 转令牌 | **KAN-45** |

**违反 18 条，其中 KAN-49 处置 15 条、KAN-45 处置 3 条（A06、A20、A24）；偏离但保留 1 条；合规 5 条。**

---

## 6. 有意偏离：字体

**做什么**：把 `fontFamilyBase` / `fontFamilyHeading` / `fontFamilyDisplay` 三个令牌，以及 `body`，
统一成 `"Helvetica Neue", Helvetica, "PingFang SC", Arial, sans-serif`。

**为什么算偏离而不是违反**：官方字体栈是 `"Open Sans", Helvetica, Arial, sans-serif`——
**Helvetica 本来就是第二顺位**，我们只是把它提到首位。Typography 文档全文没有任何一句禁止更换字体。
其余间距、组件、颜色保持纯 Cloudscape，这是一处按业务口味的小幅调整，不是另起一套设计体系。

**三个令牌必须一起改**：`fontFamilyHeading` 与 `fontFamilyDisplay` 是独立令牌、各自一份字面量，
不引用 base。只改 base，在装了 Open Sans 的机器上标题与正文会分家。

**`PingFang SC` 兜底必须保留**，否则中文掉字。注意这三个令牌的类型是纯字符串（`GlobalValue`），
不是 `colorBackgroundLayoutMain` 那种 `{light,dark}` 结构，写成对象直接 tsc 报错。

**回退**：删掉 `theme.ts` 里这三行即可，单文件单提交，30 秒。

**验证方法**（已按下面的「观感修订」更新）：`getComputedStyle(document.body).fontFamily`
以 `"Open Sans"` 开头，页面 `h1` 以 `"Helvetica Neue"` 开头，**两者都含 `PingFang SC`**；
再看中文块无豆腐块。**不靠目测。**

### 6.1 观感修订（KAN-63）

KAN-49 把非状态色相压到 0 之后，界面仍偏「暖」且字体单一。这一轮按 AWS 控制台的安静感再收一遍，
只改观感，不动任何业务规则。与第 6 节上文的差别有三处：

| | KAN-49 | KAN-63 |
|---|---|---|
| 页底 | `#F7F5F1` 暖白 | **`#f2f3f3`** —— Cloudscape `colorBackgroundLayoutMain` 的亮色默认值，冷灰 |
| `fontFamilyBase` | Helvetica 栈 | **Open Sans 栈**，和官方一致，长段中英文混排更安静 |
| `fontFamilyHeading` / `Display` | Helvetica 栈 | Helvetica 栈（不变） |

也就是说：**只有标题、展示字和 `StatTile` 的大数字用地铁字体，正文回控制台字体。**
上文「三个令牌一起覆盖成 Helvetica」的说法到此为止；三个令牌仍必须**分别赋值**，
因为它们互不引用——这一条没变。两个栈都保留 `PingFang SC` 兜底，否则中文掉字。

大数字同时把 `fontWeight` 从 700 降到 400：字号已经撑起层次，再加粗就过了。

**回退**：把 `theme.ts` 里 `DISPLAY_STACK` 的三处使用改回 `BASE_STACK`，页底改回 `#F7F5F1`。

第二刀补四条（同属 KAN-63）：

* Open Sans 由 `@fontsource/open-sans` **实际加载**（400/600/700，自托管不走外链）。此前只在字体栈里写了名字，macOS 不自带这个字体，`BASE_STACK` 实际落到第二顺位 Helvetica Neue——**从代码上完全看不出来**，只有在浏览器里量 `document.fonts.check()` 才会发现。不装它，「正文控制台字体、标题地铁字体」这个目标只能生效一半。
  这是本票唯一一个新依赖。KAN-63 票面原有「不加新依赖」的反例，**已于 2026-09-21 经 Ryan 授权修订**，放开且仅放开这一个包（只引三个权重、自托管、不引中文网页字体）。修订记录留在票上，不是绕过验收标准。
* 首页的项目表不在看板里：它固定渲染、没有拖动手柄和关闭按钮，看板只放额外加回来的小组件。
* 评审标注从顶栏移进身份菜单，功能不变，只是不再占产品壳的位置。
* 六段阶段条只有**当前**那一段用状态色，已过和未到都是次要文字——否则已过的段和已过的门叠两层绿。

---

## 7. 未验证项（真机）

以下三条**桌面测不出来**，不在 KAN-49 范围，PR 与 Jira 评论同步列出：

1. **iOS Safari 实际字体解析**：Helvetica Neue 在 iPhone 上是否按预期命中，`PingFang SC` 兜底是否真被触发。
2. **hover-only `title` 在 iPhone 上确实不可用**——这是 A04 判定「颜色是唯一通道」的依据，
   依据的是官方规则和 iOS 无 hover 这一事实，**不是实测**。
3. **三个手机宽度的真机表现**。本次 375/390/430 的测量是在同源 iframe 里精确控宽后量
   `documentElement` 的 `scrollWidth` 与 `clientWidth`，属**桌面 Chrome 模拟**。
   按 `AGENTS.md:57`，桌面模拟不得冒充真机。

另记一处工具限制：`resize_window` 报成功但视口没变（`innerWidth` 仍是 2240），所以改用 iframe 控宽。
任何后续的宽度测量都必须**读回 `innerWidth` 校准**，不能信 resize 的返回值。

---

## 8. 移交 KAN-45 的清单

KAN-45（把剩余页面的内联样式统一到设计令牌，已从十二月提前到 09-23/09-24）接手三条：

| 编号 | 位置 | 内容 |
|---|---|---|
| A06 | `pages/Dashboard.tsx:422` | 照片占位底 `#e9ecef` → 令牌 |
| A20 | `components/charts/palette.ts` | 26 个已过期的 `tok()` 兜底值（可选） |
| A24 | `components/CoverImage.tsx:5,24` | 内联 SVG 的 6 个中性灰 → 令牌 |

外加 `pages/project/FilesTab.tsx:73` 的缩略图占位底，以及全仓剩余内联样式。

**清单不用重新盘**：`frontend/src/lib/hexGuard.test.ts` 遍历 `frontend/src` 断言 hex 字面只出现在
允许名单里，**那份名单就是 KAN-45 的待办列表**。KAN-45 做完把它缩到三个文件。

口径提醒：`charts/palette.ts` 的 26 个 hex **不是**待清理项（见 A20），按「全仓 hex 计数」核验会误判。
