#!/usr/bin/env python3
"""把快照渲染成 VP 手机首页与技术详情附页。

第一阶段的验证载体：产出 PNG 供人工审阅，不是最终产品架构。
第二阶段按 vp-report-brief.md 做受权限保护的动态网页，消费同一份 contract。

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
W = 390                      # iPhone 竖屏逻辑宽度
AXIS_START, AXIS_END = date(2026, 9, 14), date(2026, 9, 27)

STAGE_COLOR = {"未开始": "#6b7a8d", "进行中": "#155bb5", "待验收": "#845006", "已验收": "#186342"}
RISK_COLOR = {"按计划": "#186342", "有风险": "#845006", "已延期": "#a32c2c", "待确认": "#6b7a8d"}

CSS = """
*{box-sizing:border-box;margin:0;padding:0}
body{width:390px;background:#f4f6fa;color:#182c46;
 font:16px/1.6 -apple-system,"PingFang SC","Heiti SC",sans-serif;-webkit-font-smoothing:antialiased}
.banner{background:#fff5df;color:#845006;font-size:12px;padding:8px 16px;text-align:center;
 border-bottom:1px solid #eadfc4;line-height:1.45}
.head{background:#fff;padding:18px 16px 14px;border-bottom:1px solid #dee5ee}
.brand{font-size:13px;color:#52647a}
h1{font-size:25px;font-weight:600;line-height:1.3;margin:2px 0 8px}
.byline{display:flex;justify-content:space-between;font-size:12px;color:#52647a;flex-wrap:wrap;gap:4px 12px}
.panel{padding:14px 16px}
.card{background:#fff;border:1px solid #dee5ee;border-radius:12px;padding:15px;margin-bottom:12px}
h2{font-size:17px;font-weight:600;margin-bottom:9px}
.now{font-size:18px;font-weight:600;line-height:1.45}
.sub{font-size:13px;color:#52647a;margin-top:7px;line-height:1.55}
.next{margin-top:12px;padding-top:11px;border-top:1px solid #eef2f7;font-size:14px;display:flex;gap:10px}
.next b{color:#155bb5;white-space:nowrap}
.legend{font-size:12px;color:#52647a;margin-bottom:7px}
.axis{position:relative;height:18px;font-size:11px;color:#52647a}
.axis span{position:absolute;transform:translateX(-50%)}
.lane{border-top:1px solid #eef2f7;padding:10px 0 11px}
.lane:first-of-type{border-top:0}
.lrow{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.lname{font-size:15px;font-weight:500}
.ldate{font-size:12px;color:#52647a;white-space:nowrap}
.track{position:relative;height:18px;margin-top:7px;border-radius:3px;
 background:repeating-linear-gradient(to right,#e4eaf2 0 1px,transparent 1px calc(100%/13))}
.bar{position:absolute;top:3px;height:12px;border-radius:3px;background:#155bb5;opacity:.72}
.bar.ms{background:#845006}
.today{position:absolute;top:-2px;bottom:-2px;width:2px;background:#182c46}
.chips{display:flex;gap:6px;margin-top:7px;flex-wrap:wrap}
.chip{font-size:11px;padding:2px 7px;border-radius:5px;border:1px solid currentColor;line-height:1.5}
.note{font-size:12px;color:#52647a;margin-top:8px;line-height:1.5}
.mt{display:flex;gap:11px;padding:10px 0;border-top:1px solid #eef2f7;font-size:14px}
.mt:first-of-type{border-top:0}
.mt b{color:#155bb5;white-space:nowrap;font-size:13px}
.mt small{display:block;color:#52647a;font-size:12px;margin-top:2px}
.q{padding:9px 0;border-top:1px solid #eef2f7;font-size:14px}
.q:first-of-type{border-top:0}
.q dt{font-size:12px;color:#52647a;margin-bottom:2px}
.q dd{font-size:14px}
.pend{color:#845006;font-weight:500}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{text-align:left;padding:6px 4px;border-bottom:1px solid #eef2f7;vertical-align:top}
th{color:#52647a;font-weight:500;font-size:11px}
.k{white-space:nowrap;color:#155bb5}
.foot{background:#fff;border-top:1px solid #dee5ee;padding:12px 16px 16px;font-size:11px;
 color:#52647a;line-height:1.7}
.foot b{color:#182c46;font-weight:500}
"""


def pos(d: date) -> float:
    span = (AXIS_END - AXIS_START).days
    return max(0.0, min(100.0, (d - AXIS_START).days / span * 100))


def bar(start: str | None, due: str | None, cls: str = "") -> str:
    if not start or not due:
        return '<div class="note">日期待确认</div>'
    a, b = pos(date.fromisoformat(start)), pos(date.fromisoformat(due))
    return (f'<div class="bar {cls}" style="left:{a:.2f}%;'
            f'width:{max(b - a, 2.2):.2f}%"></div>')


def md(s: str) -> str:
    return f'<span class="pend">{html.escape(s)}</span>' if s in ("待核对", "待确认") else html.escape(s)


def overview(s: dict) -> str:
    today = date.fromisoformat(s["today"])
    fetched = s["fetched_at"][:16].replace("T", " ")
    issues = {i["key"]: i for i in s["issues"]}
    done = sum(1 for i in s["issues"] if i["parent"] and i["status_category"] == "done")
    total = sum(1 for i in s["issues"] if i["parent"])

    lanes = ""
    for ln in s["lines"]:
        ms = "ms" if ln["jira_key"] is None else ""
        dates = (f'{ln["start"][5:].replace("-", "/")}—{ln["due"][5:].replace("-", "/")}'
                 if ln["start"] and ln["due"] else "待确认")
        tag = "（暂定）" if ln["dates_provisional"] else ""
        extra = (f'<span class="chip" style="color:#6b7a8d">{ln["jira_note"]}</span>'
                 if ln["jira_key"] is None else
                 f'<span class="chip" style="color:#6b7a8d">{ln["done_count"]}/{ln["total_count"]} 项已完成</span>')
        lanes += f"""<div class="lane"><div class="lrow">
 <span class="lname">{html.escape(ln["title"])}</span>
 <span class="ldate">{dates}{tag}</span></div>
 <div class="track">{bar(ln["start"], ln["due"], ms)}
 <div class="today" style="left:{pos(today):.2f}%"></div></div>
 <div class="chips">
  <span class="chip" style="color:{STAGE_COLOR[ln["stage"]]}">{ln["stage"]}</span>
  <span class="chip" style="color:{RISK_COLOR[ln["risk"]]}">{ln["risk"]}</span>{extra}</div></div>"""

    mtgs = ""
    for m in s["meetings"]:
        d = date.fromisoformat(m["date"])
        rel = "今天" if d == today else ("明天" if d == today + timedelta(days=1) else "")
        when = f'{rel} ' if rel else ""
        t = m["start_time"] + (f'—{m["end_time"]}' if m["end_time"] else "（结束时间待确认）")
        note = "" if m["jira_key"] else '<small>尚未在 Jira 建记录</small>'
        mtgs += (f'<div class="mt"><b>{when}{d.month}/{d.day}<br>{t}</b>'
                 f'<div>{html.escape(m["title"])}<small>{html.escape(m["purpose"])}</small>{note}</div></div>')

    deps = ""
    for dp in s["deployments"]:
        deps += (f'<div class="q"><dt>演示环境部署</dt>'
                 f'<dd>{html.escape(dp["environment"])} · {html.escape(dp["sha"])} · '
                 f'{html.escape(dp["state"])}</dd></div>')
    if not deps:
        deps = '<div class="q"><dt>演示环境部署</dt><dd class="pend">无记录</dd></div>'

    qs = ""
    for label, key in (("现在已经能做什么", "has_now"), ("还差什么", "needs"),
                       ("怎样才算交付", "definition_of_done"), ("需要谁决定什么", "decision_needed")):
        qs += f'<div class="q"><dt>{label}</dt><dd>{md(s["lines"][0][key])}</dd></div>'

    return f"""<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<style>{CSS}</style><body data-vp-report="1">
<div class="banner">第一阶段审阅稿 · 数据来自 Jira 与 GitHub 实际记录 · 横条为<b>暂定</b>计划工期，非管理层已确认承诺</div>
<div class="head"><div class="brand">翻房协作系统</div><h1>内部上线进度</h1>
<div class="byline"><span>交付负责人：Ryan</span><span>数据截至 {fetched}</span></div></div>

<div class="panel">
<div class="card"><div class="now">15 项开发工作已完成 {done} 项</div>
<div class="sub">代码基线已统一。账号权限、任务分派、手机交接三项仍在开发中，均未通过业务验收。</div>
<div class="next"><b>下一节点</b><span>9/17 会议确定试用范围；9/18 目标演示手机协作</span></div></div>

<div class="card"><h2>接下来怎么推进</h2>
<div class="legend">横条＝暂定计划工期（不表示完成度）　竖线＝今天 {today.month}/{today.day}</div>
<div class="axis"><span style="left:0;transform:none">9/14</span><span style="left:{pos(date(2026,9,18)):.1f}%">9/18</span>
<span style="left:{pos(date(2026,9,22)):.1f}%">9/22</span><span style="left:100%;transform:translateX(-100%)">9/27</span></div>
{lanes}
<div class="note">左侧四项为业务交付主线，{total} 张开发执行单见技术详情附页。</div></div>

<div class="card"><h2>近期会议</h2>{mtgs}
<div class="note">会议召开不等于决议落实；结论与行动需会后回填。</div></div>

<div class="card"><h2>上线情况</h2>{deps}
<div class="q"><dt>AWS 内部上线</dt><dd class="pend">{html.escape(s["aws_status"])}</dd></div>
<div class="q"><dt>真机验收</dt><dd class="pend">尚未进行</dd></div>
<div class="note">演示环境部署成功 ≠ 内部上线。开发完成、部署成功、真机验收、业务上线为四件不同的事。</div></div>

<div class="card"><h2>业务判断</h2>{qs}
<div class="note">以上四项须由业务负责人填写后才会显示内容，系统不代为推断。</div></div>
</div>

<div class="foot">
<b>数据截至：</b>{fetched}（最后一次成功同步）<br>
<b>业务核对人：</b>{s["reviewed_by"] or "尚未核对"}　<b>业务核对时间：</b>{s["reviewed_at"] or "尚未核对"}<br>
<b>证据来源：</b>Jira KAN 项目（Epic KAN-35/36/37 及其子项）、GitHub 部署记录<br>
<b>口径：</b>开始日期为按依赖链倒推的暂定值，非实际开工时间；不提供总体完成百分比。
</div></body></html>"""


def detail(s: dict) -> str:
    fetched = s["fetched_at"][:16].replace("T", " ")
    epics = {ln["jira_key"]: ln["title"] for ln in s["lines"] if ln["jira_key"]}
    rows = ""
    for ep, title in epics.items():
        rows += f'<tr><td colspan="4" style="padding-top:12px"><b>{html.escape(title)}（{ep}）</b></td></tr>'
        for i in sorted((x for x in s["issues"] if x["parent"] == ep), key=lambda x: int(x["key"][4:])):
            rows += (f'<tr><td class="k">{i["key"]}</td><td>{html.escape(i["summary"])}</td>'
                     f'<td>{i["status"]}</td>'
                     f'<td style="white-space:nowrap">{(i["start"] or "—")[5:]}→{(i["due"] or "—")[5:]}</td></tr>')

    chk = s.get("date_check", {})
    anomalies = "".join(f'<div class="q"><dd>{html.escape(a)}</dd></div>' for a in chk.get("anomalies", []))

    return f"""<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<style>{CSS}</style><body data-vp-report="1">
<div class="banner">技术详情附页 · 供追溯用 · 不面向 VP 首页阅读</div>
<div class="head"><div class="brand">翻房协作系统</div><h1>开发执行单明细</h1>
<div class="byline"><span>15 张执行单 · 3 个 Epic</span><span>数据截至 {fetched}</span></div></div>
<div class="panel"><div class="card"><table>
<tr><th>单号</th><th>内容</th><th>状态</th><th>暂定起止</th></tr>{rows}</table>
<div class="note">所有起止日期为倒推暂定值。状态为 Jira 工作流状态，不代表业务验收结果。</div></div>

<div class="card"><h2>日期一致性检查</h2>
<div class="q"><dt>检查项</dt><dd>{chk.get("checked", "?")} 项</dd></div>
<div class="q"><dt>缺失</dt><dd>{len(chk.get("missing", []))} 项</dd></div>
<div class="q"><dt>异常</dt><dd>{len(chk.get("anomalies", []))} 项</dd></div>
{anomalies}
<div class="note">由脚本逐条比较得出。JQL 不支持字段与字段比较，不能用于此项验证。</div></div>
</div></body></html>"""


SENTINEL = "data-vp-report=\"1\""


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
    for name, fn, h in (("overview", overview, 2480), ("detail", detail, 1760)):
        p = args.outdir / f"{name}.html"
        p.write_text(fn(s), encoding="utf-8")
        shot(p, args.outdir / f"{name}.png", h)
        print(f"已生成 {args.outdir / (name + '.png')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
