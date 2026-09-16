#!/usr/bin/env python3
"""把 Jira 取数结果与 GitHub 部署记录组装成一份经校验的报告快照。

第一阶段的取数由带 Atlassian MCP 授权的助手完成，结果存成 JSON 后交给本脚本；
本机没有 Jira 凭证（~/.config/jira/token 不存在），scripts/jira.py 暂时跑不了。
凭证到位后，把 --jira-dump 换成直连 /rest/api/3/search/jql 即可，契约不变。

用法：
  build_snapshot.py --jira-dump <search结果.json> --out output/vp-report/snapshot-<日期>.json
"""

from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys
from datetime import datetime, date

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from vp_report.contract import (  # noqa: E402
    Deployment, Issue, Line, Meeting, Snapshot,
    FETCH_OK, FETCH_PARTIAL, UNKNOWN, UNREVIEWED,
    check_dates, validate,
)

REPO = "skyvision-ryan/flip-house-platform"
TZ = "America/Los_Angeles"

# Epic → VP 首页的业务主线名称。业务语言，不照搬 Epic 原标题。
LINES = [
    ("account", "账号与安全上线", "KAN-35"),
    ("tasks", "任务分派与确认", "KAN-36"),
    ("mobile", "手机协作演示", "KAN-37"),
]

# 阻塞关系，来自 Jira 实际 is blocked by 链接（2026-09-16 经 MCP 读取核对）。
# 第二阶段改为直接从 API 读取 issuelinks，不再在此维护。
BLOCKS = {
    "KAN-21": ["KAN-20"],
    "KAN-22": ["KAN-20", "KAN-21", "KAN-25"],
    "KAN-23": ["KAN-21", "KAN-25"],
    "KAN-24": ["KAN-21", "KAN-25"],
    "KAN-25": ["KAN-21"],
    "KAN-26": ["KAN-22", "KAN-23", "KAN-24", "KAN-25"],
    "KAN-27": ["KAN-20", "KAN-21"],
    "KAN-28": ["KAN-21", "KAN-27"],
    "KAN-29": ["KAN-27", "KAN-28"],
    "KAN-30": ["KAN-28", "KAN-29"],
    "KAN-31": ["KAN-21", "KAN-27", "KAN-28"],
    "KAN-32": ["KAN-29", "KAN-30", "KAN-31"],
    "KAN-33": ["KAN-21", "KAN-31"],
    "KAN-34": ["KAN-30", "KAN-32", "KAN-33"],
}

# 会议时间由用户在 2026-09-16 的纠偏指令中明确给出，时区 America/Los_Angeles。
# 尚未在 Jira 建记录——jira_key 为 None 时报告会如实标注。
MEETINGS = [
    Meeting(
        title="确定试用范围与验收标准",
        date="2026-09-17", start_time="14:00", end_time=None,
        purpose="确定内部试用的范围、人员、职责与验收标准",
    ),
    Meeting(
        title="检查上线准备，决定试用安排",
        date="2026-09-22", start_time="14:00", end_time="14:45",
        purpose="检查上线准备，明确试用安排与启动条件",
    ),
]


def load_issues(dump: pathlib.Path) -> list[Issue]:
    raw = json.loads(dump.read_text(encoding="utf-8"))
    nodes = raw.get("issues")
    if not isinstance(nodes, list) or not nodes:
        raise ValueError(f"{dump} 里没有 issues 列表；这是取数失败，不是零结果")
    out = []
    for n in nodes:
        f = n["fields"]
        st = f["status"]
        parent = (f.get("parent") or {}).get("key")
        assignee = (f.get("assignee") or {}).get("displayName")
        out.append(Issue(
            key=n["key"], summary=f["summary"],
            status=st["name"], status_category=st["statusCategory"]["key"],
            start=f.get("customfield_10015"), due=f.get("duedate"),
            start_provisional=True,     # 全部为倒推所得，见 KAN-40 更正评论
            parent=parent, assignee=assignee,
        ))
    return out


def load_deployments() -> tuple[list[Deployment], list[str]]:
    """读 GitHub 部署记录。失败必须记进 fetch_errors，不能静默当成「没有部署」。"""
    errors: list[str] = []
    try:
        ids = subprocess.run(
            ["gh", "api", f"repos/{REPO}/deployments",
             "--jq", ".[] | {id, environment, ref, created_at}"],
            capture_output=True, text=True, timeout=60, check=True,
        ).stdout.strip()
    except Exception as exc:                       # noqa: BLE001
        return [], [f"读取 GitHub deployments 失败：{exc}"]
    if not ids:
        return [], []
    out = []
    for line in ids.splitlines():
        d = json.loads(line)
        try:
            state = subprocess.run(
                ["gh", "api", f"repos/{REPO}/deployments/{d['id']}/statuses",
                 "--jq", ".[0] | .state"],
                capture_output=True, text=True, timeout=60, check=True,
            ).stdout.strip() or "无状态"
        except Exception as exc:                   # noqa: BLE001
            state = "读取失败"
            errors.append(f"deployment {d['id']} 状态读取失败：{exc}")
        out.append(Deployment(
            environment=d["environment"], sha=d["ref"][:7],
            state=state, created_at=d["created_at"],
            url=f"https://github.com/{REPO}/deployments",
        ))
    return out, errors


def stage_of(children: list[Issue]) -> tuple[str, int, int]:
    """交付阶段只反映工作推进程度。
    「已验收」需要人工填写的验收依据，脚本永不自行判定——最高只到「待验收」。
    """
    total = len(children)
    done = sum(1 for c in children if c.status_category == "done")
    active = any(c.status_category == "indeterminate" for c in children)
    if total and done == total:
        return "待验收", done, total
    if done or active:
        return "进行中", done, total
    return "未开始", done, total


def risk_of(children: list[Issue], today: date) -> str:
    """风险提示与交付阶段互不推导。已过目标日期且未完成 → 已延期。
    其余一律「待确认」：没有业务核对前，不得用「尚未发现风险」冒充「按计划」。
    """
    for c in children:
        if c.due and c.status_category != "done" and date.fromisoformat(c.due) < today:
            return "已延期"
    return UNKNOWN


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jira-dump", required=True, type=pathlib.Path)
    ap.add_argument("--out", required=True, type=pathlib.Path)
    ap.add_argument("--today", default=date.today().isoformat())
    args = ap.parse_args()

    today = date.fromisoformat(args.today)
    errors: list[str] = []

    issues = load_issues(args.jira_dump)
    deployments, dep_errors = load_deployments()
    errors += dep_errors

    by_key = {i.key: i for i in issues}
    lines: list[Line] = []
    for lid, title, epic_key in LINES:
        epic = by_key.get(epic_key)
        if epic is None:
            errors.append(f"缺少 Epic {epic_key}")
            continue
        kids = [i for i in issues if i.parent == epic_key]
        stage, done, total = stage_of(kids)
        lines.append(Line(
            id=lid, title=title, jira_key=epic_key,
            start=epic.start, due=epic.due, dates_provisional=True,
            stage=stage, risk=risk_of(kids, today),
            children=[k.key for k in kids], done_count=done, total_count=total,
        ))

    # 首批房屋试用：业务里程碑，尚未在 Jira 建记录，如实标注
    lines.append(Line(
        id="trial", title="首批房屋试用", jira_key=None,
        jira_note="尚未在 Jira 建记录",
        start="2026-09-24", due="2026-09-25", dates_provisional=True,
        stage="未开始", risk=UNKNOWN,
    ))

    snap = Snapshot(
        fetch_status=FETCH_PARTIAL if errors else FETCH_OK,
        fetched_at=datetime.now().astimezone().isoformat(timespec="seconds"),
        timezone=TZ, today=args.today, fetch_errors=errors,
        lines=lines, meetings=MEETINGS, deployments=deployments,
        aws_status="未开始", issues=issues,
        reviewed_by=None, reviewed_at=None,
        source_note=("Jira 经 Atlassian MCP 读取；部署记录经 gh api 读取。"
                     "开始日期为倒推所得的暂定计划值，非实际开工时间。"),
    )
    validate(snap)

    report = check_dates(snap, BLOCKS)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(
        {**snap.to_dict(), "date_check": report}, ensure_ascii=False, indent=2,
    ), encoding="utf-8")

    print(f"快照已写入 {args.out}")
    print(f"取数状态：{snap.fetch_status}" + (f"（{len(errors)} 处问题）" if errors else ""))
    for e in errors:
        print(f"  ! {e}")
    print(f"日期检查：共 {report['checked']} 项，"
          f"缺失 {len(report['missing'])} 项，异常 {len(report['anomalies'])} 项")
    for m in report["missing"]:
        print(f"  缺失：{m}")
    for a in report["anomalies"]:
        print(f"  异常：{a}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
