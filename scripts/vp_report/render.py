#!/usr/bin/env python3
"""把快照渲染成 PM/VP 手机进度图与技术详情附页。

第一阶段的验证载体：产出 PNG 供人工审阅，不是最终产品架构。
第二阶段按 vp-report-brief.md 做受权限保护的动态网页，消费同一份 contract。

首页是一张图，不是文字报告：统一时间轴、按业务分组的横条、今天竖线、
里程碑节点、一眼可辨的状态。进展用「节点打勾」表达，不画虚假完成百分比。

硬规则：fetch_status 不是 ok 就拒绝出图，只输出错误说明。
"""

from __future__ import annotations

import argparse
import html
import json
import pathlib
import subprocess
import sys
from datetime import date, timedelta

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
W = 390
AXIS_START, AXIS_END = date(2026, 9, 14), date(2026, 9, 27)
SENTINEL = 'data-vp-report="1"'

DONE, DOING, TODO = "#186342", "#155bb5", "#97a3b4"

# 里程碑：会议与交付目标用不同符号。目标节点一律不画成已完成。
# 时间与口径由用户 2026-09-16 指令给出，时区 America/Los_Angeles。
MILESTONES = [
    ("2026-09-17", "meeting", "◆", "试用方案确认会", "下午 2:00（结束时间待确认）"),
    ("2026-09-18", "target",  "●", "手机协作演示",   "目标"),
    ("2026-09-22", "meeting", "◆", "上线准备检查会", "下午 2:00–2:45"),
    ("2026-09-23", "target",  "●", "云上线验收",     "目标"),
    ("2026-09-24", "trial",   "▰", "首批房屋内部试用", "目标 9/24–25"),
]

# 每条主线一句业务说明。描述做什么，不描述做到哪——做到哪由节点打勾表达。
LANE_NOTE = {
    "account": "每人独立登录，只能看到自己项目的资料",
    "tasks": "负责人能派任务，并确认交付结果",
    "mobile": "执行者用手机交材料，负责人在电脑确认",
    "trial": "选 2–3 套房，真实走一遍流程",
}
LANE_TITLE = {
    "account": "账号权限与上线准备",
    "tasks": "任务分派与交付确认",
    "mobile": "手机协作演示",
    "trial": "首批房屋内部试用",
}

CSS = """
*{box-sizing:border-box;margin:0;padding:0}
body{width:390px;background:#eef1f6;color:#16283f;
 font:15px/1.55 -apple-system,"PingFang SC","Heiti SC",sans-serif;-webkit-font-smoothing:antialiased}
.wrap{padding:14px 14px 0}
.top{font-size:12px;color:#64748b;letter-spacing:.02em}
h1{font-size:21px;font-weight:600;margin:1px 0 10px}
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
.ms.meeting{color:#b45309}.ms.target{color:#1d4ed8}.ms.trial{color:#7c3aed}
.msdate{position:absolute;transform:translateX(-50%);top:21px;font-size:9.5px;color:#7c8a9c;white-space:nowrap}
.lane{position:relative;padding:9px 0 10px;border-top:1px solid #f0f3f8}
.lname{font-size:14.5px;font-weight:600;line-height:1.35}
.lnote{font-size:11.5px;color:#64748b;margin-top:1px;line-height:1.4}
.track{position:relative;height:20px;margin-top:8px}
.bar{position:absolute;top:5px;height:10px;border-radius:5px}
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
.ri em{font-style:normal;color:#155bb5;font-weight:600}
.foot{padding:9px 16px 15px;font-size:10.5px;color:#7c8a9c;line-height:1.6}
"""


def pos(d: date) -> float:
    span = (AXIS_END - AXIS_START).days
    return max(0.0, min(100.0, (d - AXIS_START).days / span * 100))


def esc(s: str) -> str:
    return html.escape(s)


def overview(s: dict) -> str:
    today = date.fromisoformat(s["today"])
    fetched = s["fetched_at"][:16].replace("T", " ")
    by_key = {i["key"]: i for i in s["issues"]}
    tpos = pos(today)

    rail = ""
    for iso, kind, sym, _t, _d in MILESTONES:
        p = pos(date.fromisoformat(iso))
        md_ = date.fromisoformat(iso)
        rail += (f'<span class="ms {kind}" style="left:{p:.2f}%">{sym}</span>'
                 f'<span class="msdate" style="left:{p:.2f}%">{md_.month}/{md_.day}</span>')

    lanes = ""
    for ln in s["lines"]:
        lid = ln["id"]
        title = LANE_TITLE.get(lid, ln["title"])
        note = LANE_NOTE.get(lid, "")
        if not (ln["start"] and ln["due"]):
            lanes += (f'<div class="lane"><div class="lname">{esc(title)}</div>'
                      f'<div class="lnote">{esc(note)}</div>'
                      f'<div class="lnote" style="color:#b45309">日期待确认</div></div>')
            continue
        a, b = pos(date.fromisoformat(ln["start"])), pos(date.fromisoformat(ln["due"]))
        kids = [by_key[k] for k in ln["children"] if k in by_key]
        done_n = sum(1 for k in kids if k["status_category"] == "done")

        if kids and done_n == len(kids):
            col, tag, tcol = DONE, "全部完成，待验收", DONE
        elif done_n or ln["stage"] == "进行中":
            col, tag, tcol = DOING, "正在推进", DOING
        else:
            col, tag, tcol = TODO, "尚未开始", TODO

        # 节点打勾：每个子项按其截止日落点，完成打勾、未完成空心。
        # 不按日期填充长度——日期走过不代表工作完成。
        # 同一天到期的子项会重叠，后画的会盖住先画的——曾因此把唯一一个
        # 已完成节点藏掉。按日期分组后左右微调错开，已完成的画在最上层。
        groups: dict[str, list[dict]] = {}
        for k in kids:
            if k["due"]:
                groups.setdefault(k["due"], []).append(k)
        dots = ""
        for due, grp in groups.items():
            grp.sort(key=lambda k: k["status_category"] != "done")  # 已完成排后 → 叠在上层
            base = pos(date.fromisoformat(due))
            span = 4.2 * (len(grp) - 1)
            for idx, k in enumerate(grp):
                off = -span / 2 + 4.2 * idx
                cls = "dot d" if k["status_category"] == "done" else "dot"
                mark = "✓" if k["status_category"] == "done" else ""
                dots += (f'<span class="{cls}" style="left:{base + off:.2f}%">'
                         f'{mark}</span>')

        lanes += f"""<div class="lane">
<div class="lname">{esc(title)}</div><div class="lnote">{esc(note)}</div>
<div class="track"><div class="bar" style="left:{a:.2f}%;width:{max(b-a,2.5):.2f}%;
 background:{col};opacity:.30"></div>{dots}
<div class="today" style="left:{tpos:.2f}%"></div></div>
<span class="tag" style="color:{tcol}">{tag}</span></div>"""

    mlist = ""
    for iso, kind, sym, title, when in MILESTONES:
        d = date.fromisoformat(iso)
        rel = "今天" if d == today else ("明天" if d == today + timedelta(days=1) else "")
        head = f'{rel + " " if rel else ""}{d.month}/{d.day}'
        cls = {"meeting": "#b45309", "target": "#1d4ed8", "trial": "#7c3aed"}[kind]
        mlist += (f'<div class="mi"><span class="sym" style="color:{cls}">{sym}</span>'
                  f'<b>{head}</b><span>{esc(title)}<small>　{esc(when)}</small></span></div>')

    upcoming = [m for m in MILESTONES if date.fromisoformat(m[0]) >= today]
    if upcoming:
        n = min(upcoming, key=lambda m: m[0])
        nd = date.fromisoformat(n[0])
        rel = "今天 " if nd == today else ("明天 " if nd == today + timedelta(days=1) else "")
        nxt_txt = f"下一个节点：{rel}{nd.month}/{nd.day} {n[3]}　{n[4]}"
    else:
        nxt_txt = "后续节点待确认"

    return f"""<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<style>{CSS}</style><body {SENTINEL}>
<div class="wrap">
<div class="top">翻房协作系统</div><h1>内部上线进度</h1>

<div class="lede"><p>代码基线已完成。账号权限、任务分派、手机协作三项正在开发，都还没有通过验收。</p>
<div class="nx">{esc(nxt_txt)}</div></div>

<div class="chart">
<div class="legend"><i style="color:#b45309">◆ 会议</i><i style="color:#1d4ed8">● 交付目标</i>
<i style="color:#7c3aed">▰ 试用</i><i style="color:#186342">✓ 已完成</i><i>○ 未完成</i><i>▮ 今天</i></div>
<div class="grid">
<div class="axis"><span style="left:3%">9/14</span><span style="left:{pos(date(2026,9,18)):.1f}%">9/18</span>
<span style="left:{pos(date(2026,9,22)):.1f}%">9/22</span><span style="left:95%">9/27</span></div>
<div class="msrail"><div class="today" style="left:{tpos:.2f}%"></div>
<span class="todaycap" style="left:{tpos:.2f}%">今天 {today.month}/{today.day}</span>{rail}</div>
{lanes}
</div>
<div class="mslist">{mlist}</div>
</div>

<div class="risk"><h2>需要关注</h2>
<div class="ri"><span class="w">▲</span><span>上线准备检查会排在云上线验收<b>前一天</b>，若当天准备未就绪，需当场决定缩小试用范围或改期。<em>　→ Ryan 与 PM</em></span></div>
<div class="ri"><span class="w">▲</span><span>下周云上线的两项准备工作，计划完成时间早于它们依赖的基础设施，排期需要确认。<em>　→ Ryan</em></span></div>
</div>
</div>
<div class="foot">横条为暂定计划时间，非已确认承诺；节点打勾表示该项工作已完成，日期走过不代表完成。<br>
数据截至 {fetched}　业务核对：尚未核对　时区 America/Los_Angeles</div>
</body></html>"""


def detail(s: dict) -> str:
    fetched = s["fetched_at"][:16].replace("T", " ")
    epics = {ln["jira_key"]: LANE_TITLE.get(ln["id"], ln["title"])
             for ln in s["lines"] if ln["jira_key"]}
    rows = ""
    for ep, title in epics.items():
        rows += (f'<tr><td colspan="4" style="padding-top:12px">'
                 f'<b>{esc(title)}（{ep}）</b></td></tr>')
        for i in sorted((x for x in s["issues"] if x["parent"] == ep),
                        key=lambda x: int(x["key"][4:])):
            rows += (f'<tr><td class="k">{i["key"]}</td><td>{esc(i["summary"])}</td>'
                     f'<td>{i["status"]}</td>'
                     f'<td style="white-space:nowrap">{(i["start"] or "—")[5:]}→{(i["due"] or "—")[5:]}</td></tr>')

    chk = s.get("date_check", {})
    an = "".join(f'<div class="ri"><span class="w">▲</span><span>{esc(a)}</span></div>'
                 for a in chk.get("anomalies", []))
    deps = "".join(
        f'<div class="mi"><b>{esc(d["environment"])}</b>'
        f'<span>{esc(d["sha"])} · {esc(d["state"])}</span></div>' for d in s["deployments"])

    return f"""<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<style>{CSS}
table{{width:100%;border-collapse:collapse;font-size:11.5px}}
th,td{{text-align:left;padding:5px 3px;border-bottom:1px solid #f0f3f8;vertical-align:top}}
th{{color:#64748b;font-weight:500;font-size:10.5px}}
.k{{white-space:nowrap;color:#155bb5}}
</style><body {SENTINEL}>
<div class="wrap"><div class="top">技术详情附页 · 供追溯用</div><h1>开发执行单明细</h1>
<div class="chart"><table>
<tr><th>单号</th><th>内容</th><th>状态</th><th>暂定起止</th></tr>{rows}</table>
<div class="foot" style="padding:9px 0 0">状态为 Jira 工作流状态，不代表业务验收结果。</div></div>

<div class="chart"><div class="legend">上线情况</div>{deps}
<div class="mi"><b>AWS 内部上线</b><span style="color:#b45309">未开始</span></div>
<div class="mi"><b>真机验收</b><span style="color:#b45309">尚未进行</span></div>
<div class="foot" style="padding:9px 0 0">演示环境部署成功 ≠ 内部上线。</div></div>

<div class="risk"><h2>日期一致性检查（脚本逐条比较）</h2>
<div class="ri"><span></span><span>共 {chk.get("checked","?")} 项，缺失 {len(chk.get("missing",[]))} 项，
异常 {len(chk.get("anomalies",[]))} 项</span></div>{an}</div>
</div>
<div class="foot">数据截至 {fetched}　所有起止为倒推暂定值</div>
</body></html>"""


def shot(html_path: pathlib.Path, png: pathlib.Path, height: int) -> None:
    """截图前先确认 Chrome 真的加载了我们的页面。

    曾经踩过：给 file:// 传相对路径导致 ERR_INVALID_URL，Chrome 仍退出 0 并
    截下一张错误页，脚本却报「已生成」。哨兵校验让这种情况无法再冒充成功。
    """
    url = html_path.resolve().as_uri()
    dom = subprocess.run([CHROME, "--headless", "--disable-gpu", "--dump-dom", url],
                         capture_output=True, text=True, timeout=120)
    if SENTINEL not in dom.stdout:
        raise RuntimeError(
            f"Chrome 未能加载 {url}（页面中找不到哨兵标记），拒绝出图。"
            f"stderr 摘要：{dom.stderr.strip()[:200]}")
    subprocess.run([CHROME, "--headless", "--disable-gpu", "--hide-scrollbars",
                    f"--screenshot={png}", f"--window-size={W},{height}",
                    "--force-device-scale-factor=2", url],
                   check=True, capture_output=True, timeout=120)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapshot", required=True, type=pathlib.Path)
    ap.add_argument("--outdir", required=True, type=pathlib.Path)
    args = ap.parse_args()

    s = json.loads(args.snapshot.read_text(encoding="utf-8"))
    if s.get("fetch_status") != "ok":
        print(f"取数状态为 {s.get('fetch_status')}，拒绝出图。原因：", file=sys.stderr)
        for e in s.get("fetch_errors", ["（未记录）"]):
            print(f"  - {e}", file=sys.stderr)
        return 1

    args.outdir.mkdir(parents=True, exist_ok=True)
    for name, fn, h in (("overview", overview, 1265), ("detail", detail, 1700)):
        p = args.outdir / f"{name}.html"
        p.write_text(fn(s), encoding="utf-8")
        shot(p, args.outdir / f"{name}.png", h)
        print(f"已生成 {args.outdir / (name + '.png')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
