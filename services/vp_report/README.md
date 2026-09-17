# VP 手机进度报告服务

给管理层看的 Jira 阅读入口。开发和 PM 在 Jira 维护项目，这个服务从同一份数据
生成适合手机阅读的进度总览，产出一个可以置顶在微信群里的固定链接。

**它是独立服务**：同仓库，但独立进程、独立依赖、独立发布、独立回退。
不 import `backend/app`，不认 `DEMO_MODE`，不认 `X-Actor`，不连业务数据库。
报告发布失败不影响主业务；主业务不持有 Jira 凭证和报告口令。
`tests/test_isolation.py` 会盯着这条边界。

## 跑起来

```bash
# 依赖（建议单独建 venv）
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt

# 本地起服务（从仓库根目录）
uvicorn app.main:app --app-dir services/vp_report --port 8100

# 测试（在本目录下）
python -m unittest discover -s tests

# 本地预览：用合成数据在真浏览器里看，不需要 Jira 凭证
python tools/preview.py            # 正常数据
python tools/preview.py --hostile  # 含 <script>、引号的脏数据，验转义
```

## 手机排期验收

`render.py` 生成业务内容；`schedule.css` / `schedule.js` 在响应中携带 nonce 内联，
继续使用原有 CSP。样式和脚本文件必须随 `app/` 一起发布。无需新增前端依赖。

合成预览包含三条主线、单日任务、会议和暂定试用节点。复核步骤：

1. 在 320、375、390、430px 宽度打开报告，再检查 844×390 横屏和桌面宽度。
   页面本身不能横向溢出，按钮高度至少 44px。
2. 展开主线，横向滑到最右，再在表内上下滑动。名称列保持在左边；日期表头保持在表内顶部；
   今天线、网格和条形按同一天对齐。不能只检查 CSS 中是否写了 `sticky`。
3. 检查「今天」、前后翻日期、「下一节点」、放大/收起、Escape 和键盘焦点返回。
4. 展开主线并滑到后续日期，再刷新页面：日期位置、表内纵向位置和展开状态保留。
5. 用 `--hostile` 验证长名称、引号与脚本标签仍是文本，控制台没有 CSP 或脚本错误。

2026-09-17：报告服务 151 项测试、本地完整检查，以及 Chrome 上上述尺寸的布局与核心滚动交互已验证。
**这不是 iPhone Safari 真机验收**：触屏惯性、地址栏收放、安全区、VoiceOver 和添加到主屏幕仍需实机检查。
本次排期改版是否已发布，以对应 PR 与部署记录为准。

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `JIRA_SITE` | 是 | 例 `https://xxx.atlassian.net` |
| `JIRA_EMAIL` | Basic 模式必填 | 只读账号邮箱 |
| `JIRA_TOKEN` | 是 | 只读 token |
| `JIRA_AUTH_MODE` | 否 | `basic`（默认）或 `bearer` |
| `JIRA_CLOUD_ID` | bearer 模式必填 | scoped token 走网关时需要 |
| `JIRA_START_FIELD` | 否 | 开始日期自定义字段 id；留空则运行时发现 |
| `VP_REPORT_JQL` | 否 | 覆盖主线查询，默认 `issuetype = Epic AND labels = "mgmt-lane"` |
| `VP_REPORT_MILESTONE_JQL` / `VP_REPORT_MEETING_JQL` | 否 | 同上 |
| `REPORT_PASSCODE` | 是 | 访问口令 |
| `REPORT_SECRET` | 是 | 会话签名密钥，**必须固定** |
| `REPORT_COOKIE_SECURE` | 否 | 线上保持 `1`；本地 http 调试设 `0` |
| `REPORT_TRUSTED_PROXY_HOPS` | 否 | 默认 `1`，对应 Render 的一层反向代理 |
| `REPORT_CACHE_TTL` / `REPORT_REFRESH_COOLDOWN` / `REPORT_RETRY_COOLDOWN` | 否 | 缓存 300s / 手动刷新冷却 60s / 失败重试冷却 30s |

**缺任何一个必填项，服务一律返回 503**（`/healthz` 也是 503），
且**不会告诉客户端缺的是哪一个**——具体变量名只写服务端日志。

## Jira 凭证

用**专门的只读账号**，权限仅够读 KAN 项目所需字段；不要放站点管理员 token。
token / email / JQL 不进页面、不进错误响应、不进日志（`jira_client._redact`）。

认证方式取决于 token 类型，两种都支持，**必须用真实 token 实测一次**：

- classic API token → `JIRA_AUTH_MODE=basic`，Basic(email:token)，直连 `JIRA_SITE`
- scoped token → `JIRA_AUTH_MODE=bearer` + `JIRA_CLOUD_ID`，走 `api.atlassian.com`

本地有 checkout 时：

```bash
python -c "
import sys; sys.path.insert(0,'.')
from app.jira_client import JiraClient
print('登录身份：', JiraClient().verify_auth())
"
```

**部署到 Render 之后没有 shell**，用深度健康检查确认 token 类型配对了
（需要先输口令登录；只回 true/false，不回账号名）：

```
GET /healthz?deep=1   →  {"ok": true, "jira": true}
```

不做这一步的话，token 类型配错的第一个信号会是 VP 打开页面看到「暂不可用」。

## 刷新是怎么工作的

- 服务端缓存 5 分钟；并发请求**合并成一次**上游取数，多人同时打开不会重复打 Jira。
- 取数永远在后台线程里跑，请求线程不等它。**没有缓存时先出加载页**，页面轮询状态，
  好了自动显示——不做长时间同步阻塞，冷启动也不会白屏或长挂起。
- 页面可见时每 60 秒检查一次；从微信后台切回立刻检查一次；手动刷新受 60 秒冷却。
- **只有完整（`fetch_status == ok`）且结构校验通过的新快照才替换上次成功快照。**
  取数失败保留旧数据并显示「更新暂时失败，以下为 HH:MM 的数据」；
  从未成功过则显示「暂不可用」，并说明这不代表进度为零。
- **排期冲突不是取数失败。** 日期倒置、依赖矛盾、子项超出承诺日都是真实业务风险，
  快照照常有效，冲突显示在「需要关注」里。

不要对外说"实时同步"。准确说法是：
**页面自动检查 Jira 更新，正常情况下最多受 5 分钟缓存和 Jira 索引延迟影响；
实际延迟以部署后实测为准。**

## 已知限制

- **首版依赖单实例 / 单 worker。** 内存缓存、单飞合并、口令限流都只保证单进程内的
  行为。要跑多实例必须换成共享存储，否则缓存各算各的、限流形同虚设。
- 口令错误限流按真实客户端 IP（从 `X-Forwarded-For` 右端取第
  `REPORT_TRUSTED_PROXY_HOPS` 跳）。代理层数配错会把所有人算成一个 IP 一起锁死。
- Jira 搜索有索引延迟，不承诺秒级。
- 分页取完只代表**当前只读账号可见的**记录取完了，不等于项目里的全部。

## 目录

```
app/
  main.py         ASGI 入口、路由、安全响应头、/healthz
  settings.py     只读自己的环境变量
  auth.py         口令页 + 签名 cookie + 限流（标准库 hmac）
  jira_client.py  /rest/api/3/search/jql、分页、超时、脱敏
  adf.py          解析描述里的「管理摘要 v1」「会议纪要 v1」区
  contract.py     数据契约；validate_integrity（结构）vs check_dates（业务事实）
  snapshot.py     Jira 原始响应 → 快照（assemble 是纯函数，测试直接喂 fixture）
  store.py        上次成功快照 + 单飞刷新 + 冷却
  render.py       出 HTML（全字段转义、无行内 style）
tools/preview.py  本地预览，不被 app 导入
tests/            独立测试入口
```

字段怎么维护、谁在什么时候填，见
[docs/VP进度报告_设计与数据维护说明.md](../../docs/VP进度报告_设计与数据维护说明.md)。
