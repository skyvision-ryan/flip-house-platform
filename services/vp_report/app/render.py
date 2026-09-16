#!/usr/bin/env python3
"""把快照渲染成 PM/VP 的手机进度页。

首页是一张图，不是文字报告：统一时间轴、按业务分组的横条、今天竖线、
里程碑节点、一眼可辨的状态。进展用「节点打勾」表达，不画虚假完成百分比。
横条长度是计划工期，**不是完成百分比**；日期走过不代表完成。

安全口径（KAN-40 纠偏）：Jira 返回的一切都是**不可信输入**。
- 所有文字一律经 esc() 转义后才进 HTML，绝不直接拼接。
- 链接只由已验证的 JIRA_SITE + 校验过的 issue key 拼成；
  描述里的任意 URL 不进 href，只能作为文字显示。
- 内联 style/script 用 nonce 放行，CSP 里没有 unsafe-inline。

**为什么一个 style="" 属性都没有**：CSP 的 `style-src 'nonce-x'` 只放行带 nonce 的
`<style>` 元素，行内 style 属性会被浏览器整体拦掉（那要 `style-src-attr`）。
时间轴的位置、今天线、颜色全靠计算值，写成 style 属性会在真机上**整张图垮掉**，
而字符串断言完全看不出来。所以计算出的每一条声明都进 StyleSheet，
生成一个类名，统一写进带 nonce 的 <style> 里。
"""

from __future__ import annotations

import html
import re
from datetime import date, timedelta
from typing import Any

from . import settings
from .contract import next_event

SENTINEL = 'data-vp-report="1"'

KIND_CLASS = {"meeting": "c-meeting", "target": "c-target", "trial": "c-trial"}
KIND_SYMBOL = {"meeting": "◆", "target": "●", "trial": "▰"}

ISSUE_KEY_RE = re.compile(r"^[A-Z][A-Z0-9]*-\d+$")

CSS = """
*{box-sizing:border-box;margin:0;padding:0}
/* 手机竖屏不允许横向滚动：时间轴两端的标签一旦溢出，会把文档撑宽，
   body 的 max-width 随之生效并整体偏移，右边文字就被裁掉。 */
html{overflow-x:hidden}
body{max-width:430px;width:100%;margin:0 auto;overflow-x:hidden;background:#eef1f6;color:#16283f;
 font:15px/1.55 -apple-system,"PingFang SC","Heiti SC",sans-serif;-webkit-font-smoothing:antialiased}
.wrap{padding:14px 14px 0}
.top{font-size:12px;color:#64748b;letter-spacing:.02em}
h1{font-size:21px;font-weight:600;margin:1px 0 10px}
.banner{border-radius:10px;padding:9px 12px;margin-bottom:11px;font-size:13px;line-height:1.5}
.banner.stale{background:#fff7ed;border:1px solid #fdba74;color:#9a3412}
.banner.bad{background:#fef2f2;border:1px solid #fca5a5;color:#991b1b}
.lede{background:#fff;border:1px solid #d9e1ec;border-radius:12px;padding:13px 14px;margin-bottom:12px}
.lede p{font-size:15.5px;line-height:1.5;font-weight:500}
.lede .nx{margin-top:9px;padding-top:9px;border-top:1px solid #eff3f8;font-size:14px;color:#155bb5;font-weight:600}
.chart{background:#fff;border:1px solid #d9e1ec;border-radius:12px;padding:13px 12px 11px;margin-bottom:12px}
.legend{display:flex;flex-wrap:wrap;gap:4px 11px;font-size:11px;color:#64748b;margin-bottom:10px}
.legend i{font-style:normal}
.grid{position:relative}
.axis{position:relative;height:15px;font-size:10.5px;color:#7c8a9c;margin-bottom:2px}
.axis span{position:absolute;transform:translateX(-50%);white-space:nowrap}
.msrail{position:relative;height:28px;margin-bottom:3px}
.ms{position:absolute;transform:translateX(-50%);font-size:15px;line-height:1;top:7px}
.msdate{position:absolute;transform:translateX(-50%);top:21px;font-size:9.5px;color:#7c8a9c;white-space:nowrap}
.lane{position:relative;padding:9px 0 10px;border-top:1px solid #f0f3f8}
.lname{font-size:14.5px;font-weight:600;line-height:1.35}
.lnote{font-size:11.5px;color:#64748b;margin-top:1px;line-height:1.4}
.warn{color:#b45309}
.track{position:relative;height:20px;margin-top:8px}
.bar{position:absolute;top:5px;height:10px;border-radius:5px;opacity:.30}
.dot{position:absolute;top:2px;width:16px;height:16px;margin-left:-8px;border-radius:50%;
 background:#fff;border:2px solid #b9c4d2;font-size:9px;line-height:12px;text-align:center;color:#fff}
.dot.d{background:#186342;border-color:#186342}
.tag{display:inline-block;font-size:10.5px;padding:1px 7px;border-radius:9px;
 border:1px solid currentColor;margin-top:7px;line-height:1.6;font-weight:500}
.today{position:absolute;top:0;bottom:0;width:2px;background:#0f172a;z-index:3}
.todaycap{position:absolute;top:-3px;transform:translateX(-50%);background:#0f172a;color:#fff;
 font-size:9.5px;padding:1px 5px;border-radius:4px;white-space:nowrap;z-index:4}
.mslist{margin-top:11px;border-top:1px solid #f0f3f8;padding-top:9px}
.mi{display:flex;gap:8px;align-items:baseline;font-size:12.5px;padding:3px 0}
.mi b{font-weight:600;white-space:nowrap;min-width:52px}
.mi .sym{font-size:13px;line-height:1}
.mi small{color:#64748b;font-size:11.5px}
.risk{background:#fff;border:1px solid #d9e1ec;border-radius:12px;padding:12px 14px;margin-bottom:12px}
.risk h2{font-size:13px;color:#64748b;font-weight:600;margin-bottom:7px}
.ri{display:flex;gap:9px;font-size:13.5px;line-height:1.5;padding:6px 0;border-top:1px solid #f0f3f8}
.ri:first-of-type{border-top:0}
.ri .w{color:#b45309;font-size:14px;line-height:1.4}
details{margin-top:8px;border-top:1px solid #f0f3f8;padding-top:7px}
summary{font-size:12.5px;color:#155bb5;cursor:pointer;list-style:none}
summary::-webkit-details-marker{display:none}
summary::before{content:"▸ "}
details[open] summary::before{content:"▾ "}
.kv{font-size:12.5px;line-height:1.6;padding:5px 0;color:#334155}
.kv b{color:#16283f}
table{width:100%;border-collapse:collapse;font-size:11.5px;margin-top:6px}
th,td{text-align:left;padding:5px 3px;border-bottom:1px solid #f0f3f8;vertical-align:top}
th{color:#64748b;font-weight:500;font-size:10.5px}
.k{white-space:nowrap}
.k a{color:#155bb5;text-decoration:none}
.bar-row{display:flex;gap:8px;align-items:center;margin-bottom:11px}
button{font:inherit;font-size:13px;padding:7px 14px;border-radius:9px;border:1px solid #cbd5e1;
 background:#fff;color:#16283f;cursor:pointer}
.foot{padding:9px 16px 20px;font-size:10.5px;color:#7c8a9c;line-height:1.6}
.gate{padding:44px 22px}
.gate h1{font-size:20px;margin-bottom:6px}
.gate p{font-size:13.5px;color:#64748b;margin-bottom:18px;line-height:1.6}
.gate input{width:100%;font:inherit;font-size:16px;padding:12px 13px;border:1px solid #cbd5e1;
 border-radius:10px;margin-bottom:11px;background:#fff}
.gate button{width:100%;background:#155bb5;color:#fff;border-color:#155bb5;padding:12px;font-size:15px}
.gate .err{color:#991b1b;font-size:13px;margin-bottom:11px}
.center{text-align:center;padding:60px 24px;color:#64748b;font-size:14px;line-height:1.7}
/* 固定配色：写成类，避免任何行内 style 属性被 CSP 拦掉 */
.c-meeting{color:#b45309}.c-target{color:#1d4ed8}.c-trial{color:#7c3aed}
.c-done{color:#186342}.c-doing{color:#155bb5}.c-todo{color:#97a3b4}
.bg-done{background:#186342}.bg-doing{background:#155bb5}.bg-todo{background:#97a3b4}
.nowrap{white-space:nowrap}
.ml8{margin-left:8px}
"""

_STAGE_STYLE = {
    "已验收": ("bg-done", "c-done", "已通过业务验收"),
    "待验收": ("bg-done", "c-done", "全部完成，待验收"),
    "进行中": ("bg-doing", "c-doing", "正在推进"),
    "未开始": ("bg-todo", "c-todo", "尚未开始"),
}


class StyleSheet:
    """把计算出来的样式声明收集成类规则，写进带 nonce 的 <style>。

    存在的理由只有一个：CSP 下 style="" 属性会被拦。相同声明会复用同一个类名。
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
        return self.cls(f"left:{percent:.2f}%")

    def label_left(self, percent: float, margin: float = 5.0) -> str:
        """文字标签专用：把位置从两端收回来。

        标签是居中变换的，贴到 0% / 100% 会有一半探到画布外，
        把文档撑宽、触发横向滚动。标记本身不动，只挪文字。
        """
        return self.left(min(max(percent, margin), 100.0 - margin))

    def css(self) -> str:
        return "".join(f".{name}{{{decls}}}" for name, decls in self._rules)


def esc(value: Any) -> str:
    """任何进 HTML 的东西都要过这里。Jira 文本一律不可信。"""
    if value is None:
        return ""
    return html.escape(str(value), quote=True)


def jira_url(key: str | None) -> str | None:
    """只用已验证的站点地址 + 形状正确的 issue key 拼链接。

    描述里出现的任意 URL 绝不进 href——那是外部可控输入。
    """
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


# ---------- 时间轴 ----------

class Axis:
    """随数据范围自适应的时间轴。不再固定在某两周。"""

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
        # events = 交付目标 + 试用 + 会议。会议日期也必须参与范围计算，
        # 否则 9/17 的会议会被挤到轴外。
        for ev in snap.get("events") or []:
            for key in ("date", "end_date"):
                d = _parse(ev.get(key))
                if d:
                    dates.append(d)
        for it in snap.get("issues") or []:
            d = _parse(it.get("due"))
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
    if d == today:
        return "今天"
    if d == today + timedelta(days=1):
        return "明天"
    return ""


# ---------- 页面片段 ----------

def _dots(children: list[dict], axis: Axis, sheet: StyleSheet) -> str:
    """节点打勾：每个执行单按截止日落点，完成打勾、未完成空心。

    同一天到期的子项会重叠，后画的会盖住先画的——曾因此把唯一一个已完成节点藏掉。
    按日期分组后左右微调错开，已完成的画在最上层。
    """
    groups: dict[str, list[dict]] = {}
    for k in children:
        if k.get("due"):
            groups.setdefault(k["due"], []).append(k)
    out = ""
    for due, grp in sorted(groups.items()):
        d = _parse(due)
        if not d:
            continue
        grp.sort(key=lambda k: k.get("status_category") != "done")  # 已完成排后 → 叠在上层
        base = axis.pos(d)
        spread = 4.2 * (len(grp) - 1)
        for idx, k in enumerate(grp):
            off = -spread / 2 + 4.2 * idx
            done = k.get("status_category") == "done"
            cls = "dot d" if done else "dot"
            mark = "✓" if done else ""
            out += f'<span class="{cls} {sheet.left(base + off)}">{mark}</span>'
    return out


def _lane_details(line: dict, children: list[dict]) -> str:
    """细票、依赖、管理摘要原文放展开区，首页不堆技术细节。"""
    rows = ""
    for k in children:
        blocked = "、".join(esc(b) for b in (k.get("blocked_by") or []))
        rows += (
            f'<tr><td class="k">{jira_link(k.get("key"))}</td>'
            f'<td>{esc(k.get("summary"))}'
            + (f'<br><small class="warn">前置：{blocked}</small>' if blocked else "")
            + f'</td><td>{esc(k.get("status"))}</td>'
            f'<td class="nowrap">{esc((k.get("start") or "—")[5:])}→'
            f'{esc((k.get("due") or "—")[5:])}</td></tr>')

    kv = ""
    for label, key in (("已经具备", "has_now"), ("还需完成", "needs"),
                       ("整体验收", "acceptance"), ("验收证据", "evidence"),
                       ("需要决定", "decision_needed")):
        value = line.get(key)
        if value:
            kv += f'<div class="kv"><b>{label}：</b>{esc(value)}</div>'

    missing = "".join(
        f'<div class="kv warn">待确认：{esc(m)}</div>' for m in (line.get("missing") or []))

    reviewer = ""
    if line.get("reviewed_by") or line.get("reviewed_at"):
        reviewer = (f'<div class="kv"><b>业务核对：</b>{esc(line.get("reviewed_by") or "—")}'
                    f'　{esc(line.get("reviewed_at") or "")}</div>')

    link = jira_link(line.get("jira_key"), f'在 Jira 查看 {line.get("jira_key")}')
    table = (f'<table><tr><th>单号</th><th>内容</th><th>状态</th><th>起止</th></tr>{rows}</table>'
             if rows else '<div class="kv">这条主线下还没有执行单。</div>')

    return (f'<details><summary>展开详情</summary>{kv}{missing}{reviewer}{table}'
            f'<div class="kv">{link}</div></details>')


def _lanes_html(snap: dict, axis: Axis, today: date, sheet: StyleSheet) -> str:
    by_key = {i["key"]: i for i in snap.get("issues") or []}
    today_cls = sheet.left(axis.pos(today))
    out = ""
    for ln in snap.get("lines") or []:
        title = ln.get("title") or ln.get("jira_key") or ""
        note = ln.get("has_now") if ln.get("has_now") not in (None, "待核对") else ""
        stage = ln.get("stage") or "未开始"
        bg_cls, text_cls, tag = _STAGE_STYLE.get(stage, _STAGE_STYLE["未开始"])
        children = [by_key[k] for k in (ln.get("children") or []) if k in by_key]

        head = (f'<div class="lname">{esc(title)}</div>'
                + (f'<div class="lnote">{esc(note)}</div>' if note else ""))

        start, due = _parse(ln.get("start")), _parse(ln.get("due"))
        if not (start and due):
            out += (f'<div class="lane">{head}'
                    f'<div class="lnote warn">日期待确认</div>'
                    f'{_lane_details(ln, children)}</div>')
            continue

        a, b = axis.pos(start), axis.pos(due)
        bar_cls = sheet.cls(f"left:{a:.2f}%;width:{max(b - a, 2.5):.2f}%")
        progress = f'{ln.get("done_count", 0)}/{ln.get("total_count", 0)} 张执行单完成'
        # 阶段和风险是两个维度，首页要同时看得见：「正在推进」+「已延期」。
        # 以前只画阶段，算出来的"已延期"整页一个字都没有。
        risk = ln.get("risk")
        risk_chip = (f'<span class="tag warn ml8">{esc(risk)}</span>'
                     if risk in ("已延期", "有风险") else "")
        out += (
            f'<div class="lane">{head}'
            f'<div class="track"><div class="bar {bg_cls} {bar_cls}"></div>'
            f'{_dots(children, axis, sheet)}'
            f'<div class="today {today_cls}"></div></div>'
            f'<span class="tag {text_cls}">{esc(tag)}</span>{risk_chip}'
            f'<span class="lnote ml8">{esc(progress)}</span>'
            f'{_lane_details(ln, children)}</div>')
    return out


def _event_rail(snap: dict, axis: Axis, sheet: StyleSheet) -> str:
    """一条轨道上同时放交付目标、试用和会议。

    以前会议不在这里——快照里读到了 9/17 的会议，图上却没有菱形。
    """
    rail = ""
    for ev in snap.get("events") or []:
        d = _parse(ev.get("date"))
        if not d:
            continue                     # 没日期的在下面的清单里显示待确认
        left = sheet.left(axis.pos(d))
        kind = ev.get("kind") or "target"
        color_cls = KIND_CLASS.get(kind, "c-target")
        sym = KIND_SYMBOL.get(kind, "●")
        rail += (f'<span class="ms {color_cls} {left}">{sym}</span>'
                 f'<span class="msdate {sheet.label_left(axis.pos(d))}">{_md(d)}</span>')
    return rail


def _event_clock(ev: dict) -> str:
    """会议要显示时刻；时刻没填就明说，不留空让人以为是全天。"""
    if ev.get("kind") != "meeting":
        return ""
    start_t, end_t = ev.get("start_time"), ev.get("end_time")
    if start_t and end_t:
        clock = f"{start_t}–{end_t}"
    elif start_t:
        clock = f"{start_t}（结束时间待确认）"
    else:
        clock = "时刻待确认"
    return clock + ("（时区暂定）" if ev.get("time_provisional") else "")


def _event_list(snap: dict, today: date) -> str:
    events = snap.get("events") or []
    if not events:
        return ('<div class="kv warn">待确认：Jira 里还没有带 mgmt-milestone 或 '
                'mgmt-meeting 标签的节点记录。</div>')
    dated, undated = "", ""
    for ev in events:
        kind = ev.get("kind") or "target"
        color_cls = KIND_CLASS.get(kind, "c-target")
        sym = KIND_SYMBOL.get(kind, "●")
        title = esc(ev.get("title"))
        link = jira_link(ev.get("jira_key"))

        d = _parse(ev.get("date"))
        if not d:
            # 缺日期的记录保留并标出来，不能静默消失
            undated += (f'<div class="mi"><span class="sym {color_cls}">{sym}</span>'
                        f'<b class="warn">日期待确认</b><span>{title}'
                        f'<small>　{link}</small></span></div>')
            continue

        end = _parse(ev.get("end_date"))
        rel = _relative(d, today)
        head = f'{rel + " " if rel else ""}{_md(d)}' + (f'–{_md(end)}' if end else "")
        if kind == "meeting":
            state = "会议"
        elif ev.get("status_category") == "done":
            state = "已完成"
        else:
            state = "目标"
        extras = [state]
        clock = _event_clock(ev)
        if clock:
            extras.append(clock)
        if ev.get("date_provisional"):
            extras.append("日期暂定")
        dated += (f'<div class="mi"><span class="sym {color_cls}">{sym}</span>'
                  f'<b>{esc(head)}</b><span>{title}'
                  f'<small>　{esc("　".join(extras))}　{link}</small></span></div>')
    return dated + undated


def _meetings_html(snap: dict, today: date) -> str:
    meetings = snap.get("meetings") or []
    if not meetings:
        return ('<div class="risk"><h2>会议</h2>'
                '<div class="kv warn">待确认：Jira 里还没有带 mgmt-meeting 标签的会议记录。</div></div>')
    rows = ""
    for m in meetings:
        d = _parse(m.get("date"))
        if not d:
            continue
        rel = _relative(d, today)
        when = f'{rel + " " if rel else ""}{_md(d)}'
        start_t, end_t = m.get("start_time"), m.get("end_time")
        if start_t and end_t:
            clock = f"{start_t}–{end_t}"
        elif start_t:
            clock = f"{start_t}（结束时间待确认）"
        else:
            clock = "时刻待确认"
        tz_note = "（时区暂定）" if m.get("time_provisional") else ""
        body = f'<b>{esc(when)}　{esc(clock)}{esc(tz_note)}</b><br>{esc(m.get("title"))}'
        purpose = m.get("purpose")
        if purpose and purpose != "待核对":
            body += f'<br><small>目的：{esc(purpose)}</small>'
        outcome = m.get("outcome")
        if d < today:
            body += (f'<br><small>结论：{esc(outcome)}</small>' if outcome and outcome != "待核对"
                     else '<br><small class="warn">结论待录入</small>')
        if m.get("pending"):
            body += f'<br><small class="warn">待决：{esc(m.get("pending"))}</small>'
        for miss in m.get("missing") or []:
            body += f'<br><small class="warn">待确认：{esc(miss)}</small>'
        rows += f'<div class="kv">{body}　{jira_link(m.get("jira_key"))}</div>'
    return f'<div class="risk"><h2>会议</h2>{rows}</div>'


def _attention_html(snap: dict) -> str:
    """需要关注：管理摘要里的风险与待决策 + 排期冲突。

    排期冲突是**业务风险事实**，出现在这里恰恰说明报告在起作用，
    不是取数失败，也不该让页面不可用。
    """
    items: list[str] = []
    for ln in snap.get("lines") or []:
        title = ln.get("title") or ""
        # 自相矛盾优先：占位值冒充验收、同字段填了两个值
        for conflict in ln.get("conflicts") or []:
            items.append(esc(conflict))
        # 系统判定的风险：到期未完成。不需要人先补一句风险说明才看得见。
        risk = ln.get("risk")
        if risk == "已延期":
            left = (ln.get("total_count") or 0) - (ln.get("done_count") or 0)
            items.append(f'{esc(title)}：目标日 {esc(ln.get("due"))} 已过，'
                         f'仍有 {esc(left)} 张执行单未完成')
        elif risk == "有风险":
            items.append(f'{esc(title)}：已标记为有风险')
        if ln.get("risk_note"):
            items.append(f'{esc(title)}：{esc(ln["risk_note"])}')
        decision = ln.get("decision_needed")
        if decision and decision not in ("待核对", "无"):
            items.append(f'需要决定 — {esc(title)}：{esc(decision)}')
    for anomaly in (snap.get("date_check") or {}).get("anomalies") or []:
        items.append(esc(anomaly))

    if not items:
        return ('<div class="risk"><h2>需要关注</h2>'
                '<div class="kv">本次没有取到风险说明或排期冲突。'
                '<span class="warn">（"没有取到"不等于"没有风险"——风险判断需要人填。）</span>'
                '</div></div>')
    rows = "".join(f'<div class="ri"><span class="w">▲</span><span>{i}</span></div>'
                   for i in items[:8])
    return f'<div class="risk"><h2>需要关注</h2>{rows}</div>'


class _Event:
    """把快照里的事件 dict 包一层，好让 contract.next_event 用同一套规则。

    页面拿到的是 to_dict() 之后的普通字典，而"下一个节点"的规则只写一份，
    放在 contract 里。这层适配器就是为了不把规则复制第二遍。
    """

    __slots__ = ("_d",)

    def __init__(self, d: dict) -> None:
        self._d = d

    def __getattr__(self, name: str) -> Any:
        return self._d.get(name)

    def is_done(self) -> bool:
        return self._d.get("status_category") == "done"


def _lede(snap: dict, today: date) -> str:
    lines = snap.get("lines") or []
    counts: dict[str, int] = {}
    for ln in lines:
        stage = ln.get("stage") or "未开始"
        counts[stage] = counts.get(stage, 0) + 1
    parts = [f'{n} 条{stage}' for stage, n in counts.items()]
    sentence = f'共 {len(lines)} 条业务主线：' + "、".join(parts) + "。"
    if not counts.get("已验收") and lines:
        sentence += "目前还没有任何一条通过业务验收。"

    # 会议、交付目标、试用共用一个集合选"下一个"——不然快照里明明有 9/17 的会议，
    # 首页却指向 9/18 的交付单。
    nxt = next_event([_Event(e) for e in (snap.get("events") or [])], today)
    if nxt is not None:
        d = _parse(nxt.date)
        rel = _relative(d, today)
        clock = _event_clock({"kind": nxt.kind, "start_time": nxt.start_time,
                              "end_time": nxt.end_time,
                              "time_provisional": nxt.time_provisional})
        nxt_txt = (f'下一个节点：{rel + " " if rel else ""}{_md(d)} {nxt.title}'
                   + (f'　{clock}' if clock else ""))
    else:
        nxt_txt = "后续节点待确认"
    return (f'<div class="lede"><p>{esc(sentence)}</p>'
            f'<div class="nx">{esc(nxt_txt)}</div></div>')


def _banner(state: dict) -> str:
    if state.get("status") == "stale":
        fetched = (state.get("fetched_at") or "")[:16].replace("T", " ")
        return (f'<div class="banner stale">更新暂时失败，以下为 {esc(fetched)} 的数据。'
                f'页面会继续尝试更新。</div>')
    return ""


# ---------- 整页 ----------

# 一个脚本管三种页面：只在**状态或成功同步时间真的变了**才重载。
# 以前 unavailable 页用的脚本一发现 status != loading 就 reload，
# 重载后还是 unavailable，于是每 2 秒刷一次，死循环。
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
        if(changed){ location.reload(); return; }
        schedule();
      })
      .catch(function(){ schedule(); });
  }
  function schedule(){ clearTimeout(timer); timer = setTimeout(tick, interval()); }
  function tick(){ if(document.visibilityState === 'visible'){ check(); } else { schedule(); } }
  // 从微信后台切回来时立刻查一次
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
    today_cls = sheet.left(axis.pos(today))
    todaycap_cls = sheet.label_left(axis.pos(today), margin=9.0)

    ticks = "".join(
        f'<span class="{sheet.label_left(axis.pos(t))}">{_md(t)}</span>' for t in axis.ticks())
    rail = _event_rail(snap, axis, sheet)
    lanes = _lanes_html(snap, axis, today, sheet)

    fetched = (snap.get("fetched_at") or "")[:16].replace("T", " ")
    reviewed_times = [ln.get("reviewed_at") for ln in (snap.get("lines") or [])
                      if ln.get("reviewed_at")]
    reviewed = max(reviewed_times) if reviewed_times else "尚未核对"

    body = f"""<div class="wrap">
<div class="top">翻房协作系统</div><h1>内部上线进度</h1>
{_banner(state)}
{_lede(snap, today)}
<div class="chart">
<div class="legend"><i class="c-meeting">◆ 会议</i><i class="c-target">● 交付目标</i>
<i class="c-trial">▰ 试用</i><i class="c-done">✓ 已完成</i><i>○ 未完成</i><i>▮ 今天</i></div>
<div class="grid">
<div class="axis">{ticks}</div>
<div class="msrail"><div class="today {today_cls}"></div>
<span class="todaycap {todaycap_cls}">今天 {_md(today)}</span>{rail}</div>
{lanes}
</div>
<div class="mslist">{_event_list(snap, today)}</div>
</div>
{_attention_html(snap)}
{_meetings_html(snap, today)}
<div class="bar-row"><button id="refresh" type="button">刷新</button>
<span class="lnote">页面会自动检查更新</span></div>
</div>
<div class="foot">横条为计划时间，非完成进度；节点打勾表示该项工作已完成，日期走过不代表完成。<br>
本次共纳入 {esc(snap.get("issue_count", 0))} 张执行单（受当前读取账号可见范围限制）。<br>
最后成功同步 {esc(fetched)}　业务核对 {esc(reviewed)}　时区 {esc(settings.TIMEZONE)}</div>"""

    return _shell("内部上线进度", body, nonce, extra_css=sheet.css(), script=POLL_SCRIPT,
                  status=state.get("status", ""), fetched_at=snap.get("fetched_at") or "")


def loading_page(nonce: str) -> str:
    body = ('<div class="center">正在同步 Jira 最新进度……<br>'
            '<small>首次打开或服务刚重启时需要几秒钟，请稍候。</small></div>')
    return _shell("正在同步", body, nonce, script=POLL_SCRIPT, status="loading")


def unavailable_page(state: dict, nonce: str) -> str:
    """注意：这一页也用 POLL_SCRIPT，但它只在状态真的变了才重载，不会自刷循环。"""
    body = ('<div class="wrap"><div class="banner bad">进度暂不可用：还没有成功取到过 Jira 数据。'
            '<br>这不代表进度为零，只代表这次没读到。</div>'
            '<div class="center">页面会每隔约 20 秒自动重试。<br>'
            '若持续如此，请联系 Ryan 检查报告服务的 Jira 配置。</div></div>')
    return _shell("暂不可用", body, nonce, script=POLL_SCRIPT, status="unavailable")


def passcode_page(nonce: str, error: str = "") -> str:
    err = f'<div class="err">{esc(error)}</div>' if error else ""
    body = (f'<div class="gate"><h1>内部上线进度</h1>'
            f'<p>这是内部进度报告，请输入访问口令。<br>输入一次后本设备会保持登录。</p>'
            f'{err}'
            f'<form method="post" action="/login">'
            f'<input type="password" name="passcode" placeholder="访问口令" '
            f'autocomplete="current-password" autofocus>'
            f'<button type="submit">进入</button></form></div>')
    return _shell("内部上线进度", body, nonce)
