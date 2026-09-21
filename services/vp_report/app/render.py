#!/usr/bin/env python3
"""把快照渲染成给管理层看的手机进度页。

读者是不懂开发的 VP / PM。他从微信点开链接，应该在 10 秒内看懂三件事：
现在几项主要工作各做到哪、接下来有哪些会议和交付节点、有什么要他关注或决定。

所以这一层做三件事，且**只做展示**：
1. 把会议和里程碑合并到同一条时间轴上（数据层没有合并，这里只为展示合并）；
2. 把开发口径的标题换成业务短名，完整原文留在展开详情里可核对；
3. 排版：统一日期坐标、周分组、今天线、够大的字。

它不改任何业务含义——日期、状态、类型、完成与验收口径一律照抄快照。

安全口径（不放宽）：
- Jira 返回的一切都是不可信输入，一律 esc() 后才进 HTML。
- 链接只由已验证的 JIRA_SITE + 校验过的 issue key 拼成；描述里的 URL 不进 href。
- CSP 只放行带 nonce 的 <style>/<script>，**页面里一个行内 style 属性都不能有**。
  所有算出来的位置走 StyleSheet 生成类名。
"""

from __future__ import annotations

import html
import re
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from . import settings

SENTINEL = 'data-vp-report="1"'

# 事件三色取自 dataviz 参考 palette 的前三槽，已跑 validate_palette.js：
# all-pairs 全部通过（最差 CVD ΔE 9.2、常视觉 ΔE 24.0）。aqua 的对比度 WARN
# 由"每个节点都带文字标签"消解——不靠颜色单独承载身份。
KIND_CLASS = {"meeting": "k-meeting", "target": "k-target", "trial": "k-trial"}
KIND_SYMBOL = {"meeting": "◆", "target": "●", "trial": "▬"}
KIND_WORD = {"meeting": "会议", "target": "交付", "trial": "试用"}

ISSUE_KEY_RE = re.compile(r"^[A-Z][A-Z0-9]*-\d+$")

# ---- 业务短名 ----------------------------------------------------------
# 集中维护的少量别名：把开发口径的长标题换成 VP 读得懂的说法。
# 只是名称简化，**不代表工作已完成**，完整原文在展开详情里可核对。
DISPLAY_ALIASES = {
    "D4 · 修复真机验收问题并固化周五演示版本": "手机演示准备",
    "B5 · 打通固定版本发布、恢复与回退验收": "发布与恢复检查",
}

# 「D4 · 」「B5 · 」这类票号前缀：去掉前缀不改变其余原文
_TICKET_PREFIX_RE = re.compile(r"^[A-Z]+\d+\s*[·・:：]\s*")
_TRAILING_PAREN_RE = re.compile(r"[（(][^（）()]*[）)]\s*$")
# 括号里只有日期/时刻时可以去掉（正文别处已经显示日期），其余一律保留原文
_DATEISH_RE = re.compile(r"^[\d\s\-–—/:：年月日至到，,\.]*(PT|PST|PDT|AM|PM)?[\s\d:]*$", re.I)
_QUALIFIER_WORDS = ("暂定", "待确认", "未确认", "待定")


def short_name(title: Any) -> tuple[str, list[str]]:
    """开发标题 → (业务短名, 限定标签)。

    三步，**只做去噪，不造词**：
    1. 命中别名表就用别名；
    2. 去掉票号前缀；
    3. 结尾括号里若含「暂定」这类限定词，拆成标签保留；若只是重复日期，去掉；
       其余情况原样保留——不自动生成未经确认的业务承诺。
    """
    text = ("" if title is None else str(title)).strip()
    if not text:
        return "", []

    quals: list[str] = []
    m = _TRAILING_PAREN_RE.search(text)
    if m:
        inner = m.group(0).strip("（）()").strip()
        hit = next((w for w in _QUALIFIER_WORDS if w in inner), None)
        if hit:
            # 「日期暂定」这类限定**不能丢**，转成标签继续显示
            quals.append("日期暂定" if "日期" in inner and "暂定" in inner else hit)
            text = text[:m.start()].strip()
        elif _DATEISH_RE.match(inner):
            text = text[:m.start()].strip()

    alias = DISPLAY_ALIASES.get(text) or DISPLAY_ALIASES.get(str(title).strip())
    if alias:
        return alias, quals
    return _TICKET_PREFIX_RE.sub("", text).strip(), quals


def esc(value: Any) -> str:
    """任何进 HTML 的东西都要过这里。Jira 文本一律不可信。"""
    if value is None:
        return ""
    return html.escape(str(value), quote=True)


def jira_url(key: str | None) -> str | None:
    """只用已验证的站点地址 + 形状正确的 issue key 拼链接。"""
    if not key or not settings.JIRA_SITE:
        return None
    if not ISSUE_KEY_RE.match(key):
        return None
    if not settings.JIRA_SITE.startswith("https://"):
        return None
    return f"{settings.JIRA_SITE}/browse/{key}"


def jira_link(key: str | None, label: str | None = None) -> str:
    url = jira_url(key)
    text = esc(label or key or "")
    return f'<a href="{esc(url)}" rel="noopener noreferrer">{text}</a>' if url else text


CSS = """
:root{
  --surface:#ffffff; --plane:#eef1f6;
  --ink:#0f1c2e; --ink-2:#46566b; --ink-3:#6b7a8f;
  --grid:#dfe5ec; --hair:#e8edf3;
  --k-meeting:#eb6834; --k-target:#2a78d6; --k-trial:#1baf7a;
  --plan:#a9ccf5; --plan-edge:#2a78d6;
  --s-todo:#97a3b4; --s-doing:#2a78d6; --s-review:#fab219; --s-done:#0ca30c;
  --warn:#d03b3b; --warn-bg:#fdeceC; --caution:#fab219; --caution-bg:#fdf4e0;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--plane);color:var(--ink);
 font:16px/1.6 -apple-system,"PingFang SC","Heiti SC",system-ui,sans-serif;
 -webkit-font-smoothing:antialiased}
.page{max-width:430px;margin:0 auto;padding:18px 16px 40px}
@media (min-width:760px){ .page{max-width:720px;padding:28px 24px 56px} }

h1{font-size:26px;font-weight:700;letter-spacing:.01em;margin-bottom:10px}
.card{background:var(--surface);border-radius:14px;padding:14px;margin-bottom:12px;
 box-shadow:0 1px 2px rgba(15,28,46,.06)}

/* ---- 顶部 ---- */
.now{font-size:17px;line-height:1.55;font-weight:500}
.next{margin-top:9px;padding-top:9px;border-top:1px solid var(--hair);
 display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;font-size:16px}
.next .lbl{font-size:13px;color:var(--ink-3);flex:0 0 auto}
.next b{font-weight:600}
.updated{font-size:13px;color:var(--ink-3);margin-top:7px}
.banner{border-radius:12px;padding:12px 14px;margin-bottom:14px;font-size:15px;line-height:1.55}
.banner.stale{background:var(--caution-bg);border:1px solid #f0cf86;color:#7a4b06}
.banner.bad{background:var(--warn-bg);border:1px solid #f0b4b4;color:#8d2020}

/* Shared progress badges and event colours. Schedule layout lives in schedule.css. */
.sec h2{font-size:14px;font-weight:600;color:var(--ink-3);margin-bottom:12px}
.k-meeting{color:var(--k-meeting)} .k-target{color:var(--k-target)} .k-trial{color:var(--k-trial)}
.chip{display:inline-flex;align-items:center;gap:5px;font-size:13px;font-weight:600;
 padding:2px 9px;border-radius:999px;background:#f1f4f8;color:var(--ink);flex:0 0 auto}
.chip .d{width:8px;height:8px;border-radius:50%;flex:0 0 auto}
.d-todo{background:var(--s-todo)} .d-doing{background:var(--s-doing)}
.d-review{background:var(--s-review)} .d-done{background:var(--s-done)}
.chip.risk{background:var(--warn-bg);color:#8d2020}
.chip.caution{background:var(--caution-bg);color:#7a4b06}
.chip.ok{background:#e6f4e6;color:#0a8a0a}
.chip.hold{background:#eef1f5;color:var(--ink-2)}
.st-meta{font-size:13.5px;color:var(--ink-3);margin-top:6px}
.st-sec{margin-top:10px;padding-top:10px;border-top:1px solid var(--hair);font-size:15px;line-height:1.6}
.st-sec b{display:block;font-size:13px;color:var(--ink-3);font-weight:600;margin-bottom:2px}
.st-sec p{margin:0;white-space:pre-line}
.dec{display:flex;gap:10px;padding:8px 0;border-top:1px solid var(--hair);font-size:14.5px;line-height:1.5}
.dec:first-of-type{border-top:0}
.dec .who{flex:0 0 auto;color:var(--ink-2);font-size:13.5px;text-align:right;min-width:88px}
.hist{margin-top:10px}
.hist .row{align-items:flex-start}
.track{position:relative;height:18px}
.plan{position:absolute;top:6px;height:14px;border-radius:4px;background:var(--plan);
 border-left:3px solid var(--plan-edge)}
.plan.st-todo{background:#dfe5ee;border-left-color:#8a99ad}
.plan.st-doing{background:#a9ccf5;border-left-color:#2a78d6}
.plan.st-review{background:#fbe3ab;border-left-color:#d79412}
.plan.st-done{background:#b6e5b6;border-left-color:#0a8a0a}
.plan.trial{background:#a9e3cd;border-left-color:var(--k-trial)}
.lmeta{font-size:13.5px;color:var(--ink-3);margin-top:7px;
 font-variant-numeric:tabular-nums}
.nodate{font-size:14px;color:#8d2020;margin:6px 0}
.swipe{font-size:13.5px;color:var(--ink-2);background:#f2f6fb;border-radius:8px;
 padding:7px 10px;margin-bottom:10px}
.legend{display:flex;flex-wrap:wrap;gap:5px 16px;margin-top:10px;padding-top:10px;
 border-top:1px solid var(--hair);font-size:13px;color:var(--ink-3)}
.legend i{font-style:normal}
.legend .d{display:inline-block;width:8px;height:8px;border-radius:50%}

/* ---- 第一块：各项工作进展（按任务数量）---- */
.pgrid{display:flex;flex-direction:column;gap:10px}
.pitem .pname{font-size:17px;font-weight:700;margin-bottom:6px;display:flex;
 align-items:center;gap:8px;flex-wrap:wrap}
.pbar{display:flex;height:26px;border-radius:6px;overflow:hidden;background:#eef1f5;
 gap:2px}
.seg{display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;
 color:#fff;min-width:0}
.seg-done{background:#0a8a0a} .seg-doing{background:var(--s-doing)}
.seg-todo{background:#c2cbd6;color:var(--ink)}
.pcount{font-size:14px;color:var(--ink-2);margin-top:6px;font-variant-numeric:tabular-nums}
.pcount i{font-style:normal;display:inline-block;width:10px;height:10px;border-radius:2px;
 margin-right:5px;vertical-align:baseline}
.basis{font-size:13px;color:var(--ink-3);margin-top:6px}

/* ---- 图下 ---- */
.sec{padding:16px}
.row{display:flex;gap:12px;padding:11px 0;border-top:1px solid var(--hair);align-items:baseline}
.row:first-of-type{border-top:0}
.row .dt{flex:0 0 auto;font-weight:700;font-size:15px;white-space:nowrap;
 font-variant-numeric:tabular-nums}
.row .bd{flex:1 1 auto;min-width:0}
.row .nm{font-size:16px;font-weight:600}
.row .sub{font-size:13.5px;color:var(--ink-3);margin-top:2px}
.att{display:flex;gap:10px;padding:11px 0;border-top:1px solid var(--hair);font-size:15px;
 line-height:1.55}
.att:first-of-type{border-top:0}
.att .ic{flex:0 0 auto;font-size:14px}
.att .ic.r{color:var(--warn)} .att .ic.c{color:#b4830a}
.att b{font-weight:600}
.muted{color:var(--ink-3);font-size:14px}

details{margin-top:4px}
summary{font-size:14.5px;color:var(--plan-edge);cursor:pointer;list-style:none;
 padding:6px 0;min-height:44px;display:flex;align-items:center}
summary::-webkit-details-marker{display:none}
summary::before{content:"▸ ";margin-right:2px}
details[open] summary::before{content:"▾ "}
.kv{font-size:14.5px;line-height:1.65;padding:4px 0;color:var(--ink-2)}
.kv b{color:var(--ink);font-weight:600}
.kv small,.sub small{font-size:13px}
table{width:100%;border-collapse:collapse;font-size:13.5px;margin-top:8px}
th,td{text-align:left;padding:7px 4px;border-bottom:1px solid var(--hair);vertical-align:top}
th{color:var(--ink-3);font-weight:600;font-size:13px}
.k{white-space:nowrap} .k a{color:var(--plan-edge);text-decoration:none}
.warn{color:#8d2020}

.actions{display:flex;gap:12px;align-items:center;margin:4px 0 14px}
button{font:inherit;font-size:15px;padding:10px 18px;border-radius:10px;
 border:1px solid #cbd5e1;background:var(--surface);color:var(--ink);cursor:pointer;min-height:44px}
.foot{font-size:13px;color:var(--ink-3);line-height:1.7;padding:0 2px}

/* ---- 口令页 / 状态页 ---- */
.gate{max-width:420px;margin:0 auto;padding:56px 24px}
.gate h1{font-size:24px;margin-bottom:8px}
.gate p{font-size:15px;color:var(--ink-3);margin-bottom:22px;line-height:1.65}
.gate input{width:100%;font:inherit;font-size:16px;padding:14px;border:1px solid #cbd5e1;
 border-radius:11px;margin-bottom:12px;background:var(--surface)}
.gate button{width:100%;background:var(--plan-edge);color:#fff;border-color:var(--plan-edge);
 padding:14px;font-size:16px}
.gate .err{color:#8d2020;font-size:14.5px;margin-bottom:12px}
.center{text-align:center;padding:64px 24px;color:var(--ink-2);font-size:16px;line-height:1.75}
.center small{font-size:14px;color:var(--ink-3)}
"""


class StyleSheet:
    """把计算出来的样式声明收集成类规则，写进带 nonce 的 <style>。

    存在的理由只有一个：CSP 下 style="" 属性会被整体拦掉。相同声明复用同一个类名。
    """

    def __init__(self) -> None:
        self._seen: dict[str, str] = {}
        self._rules: list[tuple[str, str]] = []

    def cls(self, declarations: str) -> str:
        name = self._seen.get(declarations)
        if name is None:
            name = f"g{len(self._rules)}"
            self._seen[declarations] = name
            self._rules.append((name, declarations))
        return name

    def left(self, percent: float) -> str:
        return self.cls(f"left:{percent:.3f}%")

    def label_left(self, percent: float, margin: float = 5.0) -> str:
        """文字标签专用：把居中标签从两端收回来，免得半个字探到画布外。"""
        return self.left(min(max(percent, margin), 100.0 - margin))

    def css(self) -> str:
        return "".join(f".{name}{{{decls}}}" for name, decls in self._rules)


# ---- 时间轴 -----------------------------------------------------------

class Axis:
    """随数据范围自适应的时间轴。三条主线和所有节点共用它。"""

    MIN_SPAN_DAYS = 7

    def __init__(self, start: date, end: date) -> None:
        self.start, self.end = start, end

    @classmethod
    def from_snapshot(cls, snap: dict, today: date) -> "Axis":
        dates: list[date] = [today]
        for ln in snap.get("lines") or []:
            for key in ("start", "due", "rollup_due"):
                d = _parse(ln.get(key))
                if d:
                    dates.append(d)
        for ms in snap.get("milestones") or []:
            for key in ("date", "end_date"):
                d = _parse(ms.get(key))
                if d:
                    dates.append(d)
        # 会议也要参与范围计算：它和交付节点在同一条轴上，漏了就会被挤出画布
        for mt in snap.get("meetings") or []:
            d = _parse(mt.get("date"))
            if d:
                dates.append(d)
        for it in snap.get("issues") or []:
            for key in ("start", "due"):
                d = _parse(it.get(key))
                if d:
                    dates.append(d)
        start, end = min(dates), max(dates)
        start -= timedelta(days=1)
        end += timedelta(days=1)
        if (end - start).days < cls.MIN_SPAN_DAYS:
            end += timedelta(days=cls.MIN_SPAN_DAYS - (end - start).days)
        return cls(start, end)

    @property
    def span(self) -> int:
        return max(1, (self.end - self.start).days)

    def pos(self, d: date) -> float:
        return max(0.0, min(100.0, (d - self.start).days / self.span * 100))

    def ticks(self) -> list[date]:
        step = max(1, round(self.span / 4))
        out, cur = [], self.start
        while cur <= self.end:
            out.append(cur)
            cur += timedelta(days=step)
        if out[-1] != self.end:
            out.append(self.end)
        return out

    def weeks(self, today: date) -> list[tuple[float, float, str]]:
        """按自然周分组，返回 (左%, 右%, 标签)。

        标签优先用「上周/本周/下周」——对不看日历的人最好懂；再远就写日期范围。
        """
        out: list[tuple[float, float, str]] = []
        this_monday = today - timedelta(days=today.weekday())
        cur = self.start - timedelta(days=self.start.weekday())
        while cur <= self.end:
            wk_end = cur + timedelta(days=6)
            lo, hi = max(cur, self.start), min(wk_end, self.end)
            delta = (cur - this_monday).days // 7
            label = {-1: "上周", 0: "本周", 1: "下周"}.get(
                delta, f"{lo.month}/{lo.day}–{hi.month}/{hi.day}")
            out.append((self.pos(lo), self.pos(hi), label))
            cur = wk_end + timedelta(days=1)
        return out


def _parse(value: Any) -> date | None:
    if not value or not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _md(d: date) -> str:
    return f"{d.month}/{d.day}"


def _relative(d: date, today: date) -> str:
    delta = (d - today).days
    if delta == 0:
        return "今天"
    if delta == 1:
        return "明天"
    if delta == 2:
        return "后天"
    return ""


# ---- 统一节点集合（展示层合并，不动数据）-------------------------------

def _meeting_clock(m: dict) -> str:
    """会议时刻。没填就明说，不留空让人以为是全天。"""
    start_t, end_t = m.get("start_time"), m.get("end_time")
    if start_t and end_t:
        clock = f"{start_t}–{end_t}"
    elif start_t:
        clock = f"{start_t}（结束时间待确认）"
    else:
        clock = "时刻待确认"
    return clock + ("（时区暂定）" if m.get("time_provisional") else "")


def build_events(snap: dict) -> list[dict]:
    """会议 + 里程碑 → 同一条时间轴上的节点集合。

    数据层没有合并这两者（会议单独一个查询），结果是：快照里明明有 9/17 的会议，
    图上却一个会议标记都没有。这里按 Jira key 去重合并，只为展示，不改数据。
    会议只凭 mgmt-meeting 标签就出现，不要求再补第二个标签。
    """
    events: list[dict] = []
    seen: set[str] = set()

    for m in snap.get("meetings") or []:
        key = m.get("jira_key")
        if key:
            seen.add(key)
        name, quals = short_name(m.get("title"))
        events.append({
            "kind": "meeting", "name": name, "quals": quals,
            "date": m.get("date"), "end_date": None,
            "clock": _meeting_clock(m), "jira_key": key,
            "full": m.get("title") or "", "purpose": m.get("purpose") or "",
            "outcome": m.get("outcome") or "", "done": False,
        })

    for ms in snap.get("milestones") or []:
        key = ms.get("jira_key")
        if key and key in seen:
            continue                       # 已经以会议身份进来了，不重复
        name, quals = short_name(ms.get("title"))
        events.append({
            "kind": ms.get("kind") or "target", "name": name, "quals": quals,
            "date": ms.get("date"), "end_date": ms.get("end_date"),
            "clock": "", "jira_key": key, "full": ms.get("title") or "",
            "purpose": "", "outcome": "",
            "done": ms.get("status_category") == "done",
        })

    events.sort(key=lambda e: (e["date"] or "9999-12-31", e.get("clock") or ""))
    return events


def next_event(events: list[dict], today: date) -> dict | None:
    """下一个待办节点：日期未过、且没完成的第一个。过去的和已完成的都不算。"""
    for ev in events:
        d = _parse(ev.get("date"))
        if d is None or ev.get("done"):
            continue
        if d >= today:
            return ev
    return None

# ---- 页面片段 ---------------------------------------------------------

# key 是快照里的 stage 哨兵值，不能改；value 才是给人看的文案。
_STAGE = {
    "已验收": ("d-done", "已通过验收"),
    "待验收": ("d-review", "全部做完，待验收"),
    "进行中": ("d-doing", "进行中"),
    "未开始": ("d-todo", "尚未开始"),
}

# 计划条的颜色跟着状态走（左栏同一行还有状态圆点+文字，颜色不是唯一通道）
_STAGE_BAR = {"已验收": "st-done", "待验收": "st-review",
              "进行中": "st-doing", "未开始": "st-todo"}


def _lanes_sorted(snap: dict) -> list[dict]:
    """按开始日排序，读起来才有先后。排序只影响展示顺序。"""
    return sorted(snap.get("lines") or [],
                  key=lambda ln: (ln.get("start") or "9999-12-31",
                                  ln.get("due") or "9999-12-31"))


def _lane_counts(snap: dict, ln: dict) -> tuple[int, int, int, int]:
    """按**任务数量**统计这条主线下执行单的状态分布。

    只数直接子项（子任务不在 children 里），用的是 Jira 自己的状态类别，
    不估算工时，也不折算业务验收比例。
    """
    by_key = {i["key"]: i for i in snap.get("issues") or []}
    done = doing = todo = 0
    for key in ln.get("children") or []:
        cat = (by_key.get(key) or {}).get("status_category")
        if cat == "done":
            done += 1
        elif cat == "indeterminate":
            doing += 1
        else:
            todo += 1
    return done, doing, todo, done + doing + todo


def _progress(snap: dict, sheet: StyleSheet) -> str:
    """第一块：各项工作进展。等宽分段条，回答「完成多少」。"""
    items = ""
    for ln in _lanes_sorted(snap):
        done, doing, todo, total = _lane_counts(snap, ln)
        stage = ln.get("stage") or "未开始"
        dot_cls, stage_text = _STAGE.get(stage, _STAGE["未开始"])
        head = (f'<div class="pname">{esc(ln.get("title"))}'
                f'<span class="chip"><i class="d {dot_cls}"></i>{esc(stage_text)}</span></div>')

        if not total:
            items += (f'<div class="pitem">{head}'
                      f'<div class="basis">这项工作下面还没有登记任务，暂时无法按数量统计。</div>'
                      f'</div>')
            continue

        segs = ""
        for cls, n in (("seg-done", done), ("seg-doing", doing), ("seg-todo", todo)):
            if not n:
                continue
            pct = n / total * 100
            # 数字只在放得下时写进色块里，放不下就留给下面那行文字，不裁字
            inner = str(n) if pct >= 10 else ""
            segs += f'<div class="seg {cls} {sheet.cls(f"width:{pct:.2f}%")}">{inner}</div>'
        counts = (f'<div class="pcount">'
                  f'<i class="seg-done"></i>已完成 {done}　'
                  f'<i class="seg-doing"></i>进行中 {doing}　'
                  f'<i class="seg-todo"></i>未开始 {todo}　共 {total} 项</div>')
        items += (f'<div class="pitem">{head}<div class="pbar">{segs}</div>{counts}'
                  f'{_lane_details(snap, ln)}</div>')

    return (f'<div class="card sec"><h2>各项工作进展</h2>'
            f'<div class="pgrid">{items}</div>'
            f'<div class="basis">按任务数量统计，不代表工时进度，也不代表业务验收比例。</div>'
            f'</div>')


def _schedule_dates(start: date | None, due: date | None) -> tuple[str, bool]:
    """Keep incomplete/reversed dates visible; never draw a made-up interval."""
    if start and due:
        text = _md(start) if start == due else f"{_md(start)}–{_md(due)}"
        return (text + " · 日期倒置，待核对", False) if due < start else (text, True)
    if due:
        return f"截止 {_md(due)} · 开始待确认", False
    if start:
        return f"{_md(start)} 开始 · 截止待确认", False
    return "计划日期待确认", False


def _gantt(snap: dict, axis: Axis, today: date, sheet: StyleSheet) -> str:
    """Phone-first schedule: one native scroller, frozen names and date header.

    Each date has a full column, including one-day tasks. All coordinates use
    whole days; reversing or missing a date never creates a misleading bar.
    """
    days = axis.span + 1
    today_index = (today - axis.start).days
    canvas = sheet.cls(f"--tl:calc({days} * var(--day));--days:{days};--today:{today_index}")
    today_line = '<i class="todayline" aria-hidden="true"></i>'

    def interval(a: date, b: date, extra: str = "") -> str:
        if b < a:
            return ""
        position = sheet.cls(f"--start:{(a - axis.start).days};--length:{(b - a).days + 1}")
        return f'<span class="plan {extra} {position}" aria-hidden="true"></span>'

    def row(name: str, subtitle: str, track: str, cls: str = "", row_id: str = "") -> str:
        ident = f' id="{esc(row_id)}"' if row_id else ""
        return (f'<div class="schedule-row {cls}"{ident}>'
                f'<div class="schedule-name">{name}{subtitle}</div>'
                f'<div class="schedule-track" aria-hidden="true">{today_line}{track}</div></div>')

    def group(title: str) -> str:
        return (f'<div class="schedule-group"><div class="schedule-name">{esc(title)}</div>'
                f'<div class="schedule-track" aria-hidden="true"></div></div>')

    def date_sub(a: date | None, b: date | None) -> tuple[str, bool]:
        label, valid = _schedule_dates(a, b)
        return f'<span class="sub{("" if valid else " warn")}">{esc(label)}</span>', valid

    def status(dot: str, label: str) -> str:
        return f'<span class="schedule-status"><i class="{dot}" aria-hidden="true"></i>{esc(label)}</span>'

    ticks = ""
    weekdays = "一二三四五六日"
    for i in range(days):
        d = axis.start + timedelta(days=i)
        cls = " is-today" if d == today else (" weekend" if d.weekday() >= 5 else "")
        word = "今天" if d == today else f"周{weekdays[d.weekday()]}"
        ticks += (f'<div class="schedule-day{cls}"><small>{word}</small>'
                  f'<span>{d.day}</span><small>{d.month}月</small></div>')

    by_key = {i["key"]: i for i in snap.get("issues") or []}
    work = group("工作排期")
    for index, ln in enumerate(_lanes_sorted(snap)):
        stage = ln.get("stage") or "未开始"
        dot_cls, stage_text = _STAGE.get(stage, _STAGE["未开始"])
        start, due = _parse(ln.get("start")), _parse(ln.get("due"))
        sub, valid = date_sub(start, due)
        track = interval(start, due, _STAGE_BAR.get(stage, "st-todo")) if valid else ""
        name = f'<span class="schedule-title">{esc(ln.get("title"))}</span>'
        sub += status(dot_cls, stage_text)
        subs = ""
        children = [by_key[k] for k in ln.get("children") or [] if k in by_key]
        children.sort(key=lambda k: (k.get("start") or "9999-12-31", k.get("due") or "9999-12-31"))
        for k in children:
            ks, kd = _parse(k.get("start")), _parse(k.get("due"))
            ksub, kvalid = date_sub(ks, kd)
            cat = k.get("status_category")
            dot, word, bar = {"done": ("d-done", "已完成", "st-done"),
                              "indeterminate": ("d-doing", "进行中", "st-doing")}.get(
                                  cat, ("d-todo", "未开始", "st-todo"))
            ksub += status(dot, word)
            kbar = interval(ks, kd, "sub " + bar) if kvalid else ""
            child_name, qualifiers = short_name(k.get("summary"))
            ksub += "".join(f'<span class="sub q">{esc(q)}</span>' for q in qualifiers)
            subs += row(esc(child_name), ksub, kbar, "schedule-child")
        if subs:
            # A single summary row is both the lane and its disclosure control.
            # Its explicit full width is essential for sticky names in Safari.
            work += (f'<details id="schedule-lane-{esc(ln.get("jira_key") or index)}">'
                     f'<summary class="schedule-row">'
                     f'<span class="schedule-name">{name}{sub}<small>{len(children)} 项工作 · <span class="when-closed">展开</span><span class="when-open">收起</span></small></span>'
                     f'<span class="schedule-track" aria-hidden="true">{today_line}{track}</span>'
                     f'</summary>{subs}</details>')
        else:
            work += row(name, sub, track)

    nodes = group("关键节点")
    events = build_events(snap)
    upcoming = next_event(events, today)
    jump = ""
    for index, ev in enumerate(events):
        d, end_d = _parse(ev.get("date")), _parse(ev.get("end_date"))
        kind = ev["kind"]
        colour = KIND_CLASS.get(kind, "k-target")
        sub, valid = date_sub(d, end_d or d)
        if ev.get("clock"):
            sub += f'<div class="sub">{esc(ev["clock"])}</div>'
        sub += "".join(f'<span class="sub q">{esc(q)}</span>' for q in ev.get("quals") or [])
        word = KIND_WORD.get(kind, "交付")
        if kind != "meeting":
            word += " · 已完成" if ev.get("done") else " · 未完成"
        sub += status("d-done" if ev.get("done") else "d-todo", word)
        if not valid:
            track = ""
        elif end_d and end_d > d:
            track = interval(d, end_d, "st-done" if ev.get("done") else ("trial" if kind == "trial" else ""))
        else:
            position = sheet.cls(f"--start:{(d - axis.start).days}")
            symbol = "✓" if ev.get("done") else KIND_SYMBOL.get(kind, "●")
            track = f'<i class="schedule-node {colour} {position}">{symbol}</i>'
        row_id = f"schedule-event-{index}"
        nodes += row(esc(ev["name"]), sub, track, "schedule-event", row_id)
        if ev is upcoming:
            jump = (f'<button class="schedule-jump" data-enhanced hidden data-jump="{(d - axis.start).days}" data-row="{row_id}">'
                    f'<span>下一节点 ↗</span><b>{_md(d)} {esc(ev["name"])}</b></button>')
    if not events:
        nodes += row("还没有排定的会议或交付节点", "", "")

    return f"""<section class="card schedule {canvas}" id="schedule" aria-labelledby="schedule-heading"
 data-start="{axis.start.isoformat()}" data-today="{today_index}" data-days="{days}">
<div class="schedule-heading"><h2 id="schedule-heading">排期与关键节点</h2>
<button type="button" data-enhanced hidden data-expand aria-expanded="false" aria-controls="schedule-scroll">放大</button></div>
<p class="schedule-context">{axis.start.year}/{_md(axis.start)}–{str(axis.end.year) + "/" if axis.end.year != axis.start.year else ""}{_md(axis.end)} · {esc("洛杉矶时间" if settings.TIMEZONE == "America/Los_Angeles" else settings.TIMEZONE)}</p>
<div class="schedule-tools" data-enhanced hidden>
<button type="button" data-move="-1" aria-label="查看更早日期">‹</button>
<output aria-label="当前可见日期" aria-live="off">{_md(axis.start)}–{_md(axis.end)}</output>
<button type="button" data-move="1" aria-label="查看后续日期">›</button>
<button type="button" data-today>今天</button></div>
{jump}
<p class="schedule-help" id="schedule-help">左右滑动看日期，上下滑动看事项；点主线展开工作。</p>
<div class="schedule-scroll" id="schedule-scroll" tabindex="0" role="region" aria-label="项目排期时间表" aria-describedby="schedule-help">
<div class="schedule-canvas">
<div class="schedule-head"><div class="schedule-name">事项 / 状态<small>左右滑动日期</small></div>
<div class="schedule-days">{ticks}</div></div>
{work}{nodes}
</div></div>
<div class="legend"><span class="k-meeting">◆ 会议</span><span class="k-target">● 交付</span>
<span class="k-trial">▬ 试用</span><span>✓ 节点已完成</span>
<span class="basis">横条长度 = 计划时间，不表示完成进度</span></div>
</section>"""


def _lane_details(snap: dict, ln: dict) -> str:
    """技术原文、票号、依赖、Jira 链接——首页不显示，这里保持可追溯。"""
    by_key = {i["key"]: i for i in snap.get("issues") or []}
    rows = ""
    for key in ln.get("children") or []:
        k = by_key.get(key)
        if not k:
            continue
        blocked = "、".join(esc(b) for b in (k.get("blocked_by") or []))
        rows += (f'<tr><td class="k">{jira_link(k.get("key"))}</td>'
                 f'<td>{esc(k.get("summary"))}'
                 + (f'<br><small class="warn">前置：{blocked}</small>' if blocked else "")
                 + f'</td><td>{esc(k.get("status"))}</td>'
                 f'<td class="k">{esc((k.get("start") or "—")[5:])}→'
                 f'{esc((k.get("due") or "—")[5:])}</td></tr>')

    kv = ""
    for label, key in (("已经具备", "has_now"), ("还需完成", "needs"),
                       ("整体验收", "acceptance"), ("验收证据", "evidence"),
                       ("需要决定", "decision_needed")):
        value = ln.get(key)
        # 占位值不重复列一遍——下面那行「待确认：…」已经把缺什么说清楚了
        if value and value not in ("待核对", "待确认"):
            kv += f'<div class="kv"><b>{label}：</b>{esc(value)}</div>'
    for miss in ln.get("missing") or []:
        kv += f'<div class="kv warn">待确认：{esc(miss)}</div>'
    if ln.get("reviewed_by") or ln.get("reviewed_at"):
        kv += (f'<div class="kv"><b>业务核对：</b>{esc(ln.get("reviewed_by") or "—")}'
               f'　{esc(ln.get("reviewed_at") or "")}</div>')

    table = (f'<table><tr><th>单号</th><th>内容</th><th>状态</th><th>起止</th></tr>{rows}</table>'
             if rows else '<div class="kv">这项工作下面还没有具体工作项。</div>')
    link = jira_link(ln.get("jira_key"), "在 Jira 查看完整记录")
    return (f'<details><summary>查看工作明细</summary>{kv}{table}'
            f'<div class="kv">{link}</div></details>')


def _upcoming(snap: dict, today: date) -> str:
    events = [e for e in build_events(snap) if not e.get("done")]
    rows = ""
    undated = ""
    for ev in events:
        d = _parse(ev.get("date"))
        name = esc(ev["name"])
        quals = "".join(f'<span class="q">{esc(q)}</span>' for q in ev.get("quals") or [])
        kind_word = KIND_WORD.get(ev["kind"], "节点")
        if d is None:
            undated += (f'<div class="row"><div class="dt warn">日期待定</div>'
                        f'<div class="bd"><div class="nm">{name}{quals}</div>'
                        f'<div class="sub">{esc(kind_word)}·日期还没确定</div></div></div>')
            continue
        if d < today:
            continue
        end_d = _parse(ev.get("end_date"))
        rel = _relative(d, today)
        when = _md(d) + (f'–{_md(end_d)}' if end_d and end_d > d else "")
        sub_bits = [kind_word]
        if ev.get("clock"):
            sub_bits.append(ev["clock"])
        if ev.get("purpose") and ev["purpose"] != "待核对":
            sub_bits.append(ev["purpose"])
        rows += (f'<div class="row"><div class="dt">{esc(when)}'
                 + (f'<br><small class="muted">{esc(rel)}</small>' if rel else "")
                 + f'</div><div class="bd"><div class="nm">{name}{quals}</div>'
                 f'<div class="sub">{esc("　".join(sub_bits))}</div></div></div>')
    if not rows and not undated:
        rows = '<div class="row"><div class="bd muted">后面还没有排定的会议或交付节点。</div></div>'
    return f'<div class="card sec"><h2>接下来</h2>{rows}{undated}</div>'


def _attention(snap: dict, today: date) -> str:
    """需要关注：先说具体的风险和要决定的事，同类技术告警归成一条可展开。"""
    items: list[str] = []

    for ln in _lanes_sorted(snap):
        title = esc(ln.get("title"))
        if ln.get("risk") == "已延期":
            left = (ln.get("total_count") or 0) - (ln.get("done_count") or 0)
            items.append(f'<span class="ic r">▲</span><span><b>{title}</b>：'
                         f'目标日 {esc(ln.get("due"))} 已过，还有 {left} 项没完成</span>')
        elif ln.get("risk") == "有风险":
            items.append(f'<span class="ic c">▲</span><span><b>{title}</b>：已标记为有风险</span>')
        if ln.get("risk_note"):
            items.append(f'<span class="ic c">▲</span><span><b>{title}</b>：'
                         f'{esc(ln["risk_note"])}</span>')
        decision = ln.get("decision_needed")
        if decision and decision not in ("待核对", "无"):
            items.append(f'<span class="ic c">◆</span><span><b>需要决定 — {title}</b>：'
                         f'{esc(decision)}</span>')

    for ev in build_events(snap):
        d = _parse(ev.get("date"))
        if ev["kind"] != "meeting" or d is None or d >= today:
            continue
        if not ev.get("outcome") or ev["outcome"] == "待核对":
            items.append(f'<span class="ic c">◆</span><span>'
                         f'<b>{esc(ev["name"])}</b>（{_md(d)}）的结论还没记录</span>')

    blocks = "".join(f'<div class="att">{i}</div>' for i in items)

    # 同类技术告警归组：首页只说"有几项要核对"，原文放展开里
    anomalies = (snap.get("date_check") or {}).get("anomalies") or []
    if anomalies:
        raw = "".join(f'<div class="kv">{esc(a)}</div>' for a in anomalies)
        blocks += (f'<div class="att"><span class="ic c">▲</span><span>'
                   f'<b>{len(anomalies)} 项工作的排期需要核对</b>'
                   f'<details><summary>查看具体问题</summary>{raw}</details></span></div>')

    gaps = [m for ln in snap.get("lines") or [] for m in (ln.get("missing") or [])]
    gaps += list(snap.get("notes") or [])
    if gaps:
        raw = "".join(f'<div class="kv">{esc(g)}</div>' for g in gaps)
        blocks += (f'<div class="att"><span class="ic c">○</span><span>'
                   f'<b>{len(gaps)} 项业务信息还没填写</b>'
                   f'<details><summary>查看缺什么</summary>{raw}</details></span></div>')

    if not blocks:
        # 没有记录 ≠ 没有风险，这句话不能写成"一切正常"
        blocks = ('<div class="att"><span class="ic c">○</span><span>'
                  '目前还没有人填写风险判断。<b>这不等于没有风险</b>，'
                  '只说明还没有人给出判断。</span></div>')
    return f'<div class="card sec"><h2>需要关注</h2>{blocks}</div>'


# 整体判断 → 芯片样式。key 是快照里的哨兵值，不能改。
_HEALTH = {
    "按计划": ("ok", "按计划"),
    "有风险": ("caution", "有风险"),
    "已延期": ("risk", "已延期"),
    "暂停": ("hold", "暂停"),
    "已完成": ("ok", "已完成"),
    "待确认": ("caution", "判断待确认"),
}


def _health_chip(health: str) -> str:
    cls, text = _HEALTH.get(health or "", _HEALTH["待确认"])
    return f'<span class="chip {cls}">{esc(text)}</span>'


def _days_ago(d: date, today: date) -> str:
    delta = (today - d).days
    if delta <= 0:
        return "今天" if delta == 0 else f"{-delta} 天后"
    return "昨天" if delta == 1 else f"{delta} 天前"


def _status_card(snap: dict, today: date) -> str:
    """本期状态：最新一期「状态更新 v1」原文，往期折叠可查。

    这是**人写的判断**，不是从任务数量算出来的；页面只照抄、排版和转义。
    没有更新时如实说「还没有人写」，不写成「一切正常」。
    """
    updates = snap.get("status_updates") or []
    if not updates:
        return ('<div class="card sec"><h2>本期状态</h2>'
                '<div class="att"><span class="ic c">○</span><span>'
                '还没有人写状态更新。<b>这不等于按计划</b>，只说明还没有人给出整体判断。'
                '</span></div></div>')

    latest = updates[0]
    d = _parse(latest.get("date"))
    when = f'{esc(latest.get("date"))}（{esc(_days_ago(d, today))}）' if d else "日期待确认"
    author = esc(latest.get("author") or "更新人待确认")
    meta = (f'<div class="st-meta">{when}　{author}　'
            f'{jira_link(latest.get("jira_key"), "原文")}</div>')

    secs = ""
    for label, key in (("判断依据", "basis"), ("另一面", "counter"),
                       ("本期完成", "done_since"), ("下一步", "next_steps")):
        value = latest.get(key)
        if value and value not in ("待核对", "待确认"):
            secs += f'<div class="st-sec"><b>{esc(label)}</b><p>{esc(value)}</p></div>'

    decisions = latest.get("decisions") or []
    if decisions:
        rows = ""
        for dec in decisions:
            who = esc(dec.get("owner") or "待确认")
            by = esc(dec.get("deadline") or "待确认")
            rows += (f'<div class="dec"><span>{esc(dec.get("item"))}</span>'
                     f'<span class="who">{who}<br><small>最晚 {by}</small></span></div>')
        secs += f'<div class="st-sec"><b>需要决定</b>{rows}</div>'

    for miss in latest.get("missing") or []:
        secs += f'<div class="kv warn">待确认：{esc(miss)}</div>'

    hist = ""
    if len(updates) > 1:
        rows = ""
        for su in updates[1:]:
            basis = su.get("basis")
            basis_html = (f'<div class="sub">{esc(basis)}</div>'
                          if basis and basis not in ("待核对", "待确认") else "")
            rows += (f'<div class="row"><div class="dt">{esc((su.get("date") or "")[5:])}</div>'
                     f'<div class="bd"><div class="nm">{_health_chip(su.get("health"))}　'
                     f'{esc(su.get("author") or "更新人待确认")}　'
                     f'{jira_link(su.get("jira_key"), "原文")}</div>{basis_html}</div></div>')
        hist = (f'<details class="hist"><summary>往期更新（{len(updates) - 1} 期）</summary>'
                f'{rows}</details>')

    return (f'<div class="card sec"><h2>本期状态</h2>'
            f'<div class="pname">{_health_chip(latest.get("health"))}</div>{meta}{secs}{hist}'
            f'</div>')


def _head(snap: dict, today: date, state: dict) -> str:
    lines = _lanes_sorted(snap)
    counts: dict[str, int] = {}
    for ln in lines:
        stage = ln.get("stage") or "未开始"
        counts[stage] = counts.get(stage, 0) + 1
    order = ["进行中", "待验收", "已验收", "未开始"]
    parts = [f'{counts[s]} 项{_STAGE[s][1]}' for s in order if counts.get(s)]
    now = f'{len(lines)} 项主要工作：' + "、".join(parts) + "。"
    if not counts.get("已验收") and lines:
        now += "还没有一项通过业务验收。"

    nxt = next_event(build_events(snap), today)
    if nxt is not None:
        d = _parse(nxt["date"])
        rel = _relative(d, today)
        bits = [b for b in (nxt.get("clock"), KIND_WORD.get(nxt["kind"], "")) if b]
        quals = "".join(f'<span class="q">{esc(q)}</span>' for q in nxt.get("quals") or [])
        next_html = (f'<div class="next"><span class="lbl">最近安排</span>'
                     f'<span><b>{esc((rel + " ") if rel else "")}{_md(d)}'
                     f'　{esc(nxt["name"])}</b>{quals}'
                     f'<br><span class="lbl">{esc("　".join(bits))}</span></span></div>')
    else:
        next_html = ('<div class="next"><span class="lbl">最近安排</span>'
                     '<span>后面还没有排定的节点</span></div>')

    fetched = (snap.get("fetched_at") or "")[:16].replace("T", " ")
    return (f'<div class="card"><div class="now">{esc(now)}</div>{next_html}'
            f'<div class="updated">更新于 {esc(fetched)}（最后一次成功读取 Jira）</div></div>')


def _banner(state: dict) -> str:
    if state.get("status") == "stale":
        fetched = (state.get("fetched_at") or "")[:16].replace("T", " ")
        return (f'<div class="banner stale">更新暂时失败，下面是 {esc(fetched)} 的数据。'
                f'页面会继续尝试。</div>')
    return ""


# Keep static assets separate for review, then inline them with the response nonce.
SCHEDULE_CSS = Path(__file__).with_name("schedule.css").read_text(encoding="utf-8")
SCHEDULE_SCRIPT = Path(__file__).with_name("schedule.js").read_text(encoding="utf-8")

# ---- 整页 -------------------------------------------------------------

# 只在状态或成功同步时间真的变了才重载。unavailable 页用同一个脚本也不会自刷循环。
POLL_SCRIPT = """
(function(){
  var b = document.body;
  var seenStatus = b.getAttribute('data-status') || '';
  var seenAt = b.getAttribute('data-fetched-at') || '';
  var timer = null;
  function interval(){
    if(seenStatus === 'loading') return 3000;
    if(seenStatus === 'unavailable') return 20000;
    return 60000;
  }
  function check(){
    fetch('/api/report/status', {credentials:'same-origin'})
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){
        if(!j) return;
        var changed = (j.status || '') !== seenStatus
                   || (j.fetched_at || '') !== seenAt;
        if(changed){ document.dispatchEvent(new Event('report:before-reload')); location.reload(); return; }
        schedule();
      })
      .catch(function(){ schedule(); });
  }
  function schedule(){ clearTimeout(timer); timer = setTimeout(tick, interval()); }
  function tick(){ if(document.visibilityState === 'visible'){ check(); } else { schedule(); } }
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState === 'visible'){ check(); }
  });
  var btn = document.getElementById('refresh');
  if(btn){ btn.addEventListener('click', function(){
    btn.disabled = true; btn.textContent = '正在更新…';
    fetch('/api/report/refresh', {method:'POST', credentials:'same-origin'})
      .then(function(){ setTimeout(function(){
        btn.disabled = false; btn.textContent = '刷新'; check(); }, 2500); })
      .catch(function(){ btn.disabled = false; btn.textContent = '刷新'; });
  }); }
  schedule();
})();
"""


def _shell(title: str, body: str, nonce: str, *, extra_css: str = "",
           script: str = "", status: str = "", fetched_at: str = "") -> str:
    script_tag = f'<script nonce="{esc(nonce)}">{script}</script>' if script else ""
    attrs = (f'{SENTINEL} data-status="{esc(status)}" '
             f'data-fetched-at="{esc(fetched_at)}"')
    return (f'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
            f'<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
            f'<title>{esc(title)}</title>'
            f'<style nonce="{esc(nonce)}">{CSS}{extra_css}</style></head>'
            f'<body {attrs}>{body}{script_tag}</body></html>')


def report_page(state: dict, nonce: str) -> str:
    snap = state.get("snapshot") or {}
    today = _parse(snap.get("today")) or date.today()
    axis = Axis.from_snapshot(snap, today)
    sheet = StyleSheet()

    # 先生成所有片段，最后才取 sheet.css()——片段生成过程中还在往 sheet 里加规则
    head = _head(snap, today, state)
    status_card = _status_card(snap, today)    # 人的整体判断
    progress = _progress(snap, sheet)          # 完成多少
    gantt = _gantt(snap, axis, today, sheet)   # 什么时候
    upcoming = _upcoming(snap, today)
    attention = _attention(snap, today)

    reviewed = [ln.get("reviewed_at") for ln in (snap.get("lines") or []) if ln.get("reviewed_at")]
    reviewed_txt = max(reviewed) if reviewed else "还没有人做业务核对"

    body = f"""<div class="page">
<h1>项目进度</h1>
{_banner(state)}
{head}
{status_card}
{progress}
{gantt}
{upcoming}
{attention}
<div class="actions"><button id="refresh" type="button">刷新</button>
<span class="foot">页面会自动检查更新</span></div>
<div class="foot">横条表示计划时间，不表示完成进度；日期走过不代表完成。工作做完不等于通过业务验收。<br>
本次纳入 {esc(snap.get("issue_count", 0))} 项工作（受当前读取账号可见范围限制）。<br>
业务核对：{esc(reviewed_txt)}　时区 {esc(settings.TIMEZONE)}</div>
</div>"""

    return _shell("项目进度", body, nonce, extra_css=sheet.css() + SCHEDULE_CSS, script=SCHEDULE_SCRIPT + POLL_SCRIPT,
                  status=state.get("status", ""), fetched_at=snap.get("fetched_at") or "")


def loading_page(nonce: str) -> str:
    body = ('<div class="center">正在读取最新进度……<br>'
            '<small>第一次打开或服务刚唤醒时需要几秒钟。</small></div>')
    return _shell("正在读取", body, nonce, script=POLL_SCRIPT, status="loading")


def unavailable_page(state: dict, nonce: str) -> str:
    body = ('<div class="page"><h1>项目进度</h1>'
            '<div class="banner bad">暂时读不到进度数据。<br>'
            '这不代表进度为零，只代表这一次没有读到。</div>'
            '<div class="center">页面会每隔约 20 秒自动重试。<br>'
            '<small>如果一直这样，请联系 Ryan 检查报告服务的配置。</small></div></div>')
    return _shell("暂不可用", body, nonce, script=POLL_SCRIPT, status="unavailable")


def passcode_page(nonce: str, error: str = "") -> str:
    err = f'<div class="err">{esc(error)}</div>' if error else ""
    body = (f'<div class="gate"><h1>项目进度</h1>'
            f'<p>这是内部进度报告，请输入访问口令。<br>输入一次后本设备会保持登录。</p>'
            f'{err}'
            f'<form method="post" action="/login">'
            f'<input type="password" name="passcode" placeholder="访问口令" '
            f'autocomplete="current-password" autofocus>'
            f'<button type="submit">进入</button></form></div>')
    return _shell("项目进度", body, nonce)
