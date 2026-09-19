"""把 Jira 的原始响应组装成一份报告快照。

这里**不允许出现任何 issue key、会议日期、试用日期、依赖关系或业务文案**。
全部来自 Jira：主线来自 mgmt-lane 标签的 Epic，里程碑来自 mgmt-milestone，
会议来自 mgmt-meeting，状态更新来自 mgmt-status，业务叙述来自描述里的
「管理摘要 v1」「状态更新 v1」区。
缺什么就说缺什么，不用旧常量顶替。

取数与组装分开：`assemble()` 是纯函数，测试直接喂 fixture，不需要网络。
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from . import adf, settings
from .contract import (
    FETCH_FAILED, FETCH_OK, FETCH_PARTIAL, SCHEMA_VERSION, UNKNOWN, UNREVIEWED,
    HEALTHS, Decision, Issue, Line, Meeting, Milestone, Snapshot, StatusUpdate, check_dates,
)
from .jira_client import JiraClient, JiraError

TZ = ZoneInfo(settings.TIMEZONE)

LANE_LABEL = "mgmt-lane"
MILESTONE_LABEL = "mgmt-milestone"
MEETING_LABEL = "mgmt-meeting"
TRIAL_LABEL = "mgmt-trial"
STATUS_LABEL = "mgmt-status"

_RISK_MAP = {"按计划": "按计划", "有风险": "有风险", "已延期": "已延期", UNREVIEWED: UNKNOWN}


def today_local() -> date:
    return datetime.now(TZ).date()


def now_iso() -> str:
    return datetime.now(TZ).isoformat(timespec="seconds")


# ---------- 原始 Jira → 契约对象 ----------

def parse_issue(raw: dict[str, Any], start_field: str) -> Issue:
    f = raw.get("fields") or {}
    itype = f.get("issuetype") or {}
    status = f.get("status") or {}
    category = (status.get("statusCategory") or {}).get("key") or "new"
    blocked_by = []
    for link in f.get("issuelinks") or []:
        # inwardIssue + type.inward == "is blocked by"
        inward = link.get("inwardIssue")
        ltype = (link.get("type") or {}).get("inward", "")
        if inward and "block" in str(ltype).lower():
            blocked_by.append(inward.get("key"))
    start = f.get(start_field)
    return Issue(
        key=raw.get("key", ""),
        summary=f.get("summary") or "",
        status=status.get("name") or "",
        status_category=category,
        start=start if isinstance(start, str) else None,
        due=f.get("duedate"),
        start_provisional=False,
        parent=(f.get("parent") or {}).get("key"),
        assignee=(f.get("assignee") or {}).get("displayName"),
        is_subtask=bool(itype.get("subtask")) or itype.get("hierarchyLevel", 0) < 0,
        blocked_by=[k for k in blocked_by if k],
    )


def _labels(raw: dict[str, Any]) -> list[str]:
    return [str(x) for x in ((raw.get("fields") or {}).get("labels") or [])]


def compute_lane_state(
    done_count: int, total_count: int, epic_category: str,
    summary: dict[str, str], due: str | None, today: date,
) -> tuple[str, str]:
    """交付阶段与风险提示。**顶部摘要和图里的状态都调这一个函数。**

    规则（brief §6）：ticket 全 Done 只到「待验收」；必须有明确的整体验收结果
    才是「已验收」。不得仅凭处于待验收就显示延期。
    """
    # 「已验收」是业务结论，门槛是四样齐全：验收结果 + 证据 + 确认人 + 确认时间。
    # 少任何一样都只能停在「待验收」——没人签字的"已验收"就是猜的。
    accepted = (
        summary.get("整体验收") == "已通过"
        and summary.get("验收证据")
        and summary.get("业务核对人")
        and summary.get("业务核对时间")
    )
    if accepted:
        stage = "已验收"
    elif total_count > 0 and done_count == total_count:
        stage = "待验收"
    elif done_count > 0 or epic_category == "indeterminate":
        stage = "进行中"
    else:
        stage = "未开始"

    # 风险是独立维度，不由阶段推导。只有一种自动判定：还没做完且目标日已过。
    risk = _RISK_MAP.get(summary.get("风险判断", ""), UNKNOWN)
    if stage in ("未开始", "进行中") and due:
        try:
            if date.fromisoformat(due) < today:
                risk = "已延期"
        except ValueError:
            pass
    return stage, risk


def _rollup_due(children: list[Issue]) -> str | None:
    dues = [c.due for c in children if c.due]
    return max(dues) if dues else None


def build_line(epic: dict[str, Any], children: list[Issue], subtasks: list[Issue],
               today: date, start_field: str = "customfield_10015") -> Line:
    f = epic.get("fields") or {}
    key = epic.get("key", "")
    fields, missing_fields, has_block = adf.parse_summary(f.get("description"))

    missing: list[str] = []
    if not has_block:
        missing.append(f"{key} 描述里没有「{adf.SUMMARY_MARKER}」区")
    elif missing_fields:
        missing.append(f"{key} 管理摘要缺：{'、'.join(missing_fields)}")
    if not f.get("duedate"):
        missing.append(f"{key} 没有填承诺日（截止日期）")

    done = sum(1 for c in children if c.status_category == "done")
    category = ((f.get("status") or {}).get("statusCategory") or {}).get("key") or "new"
    stage, risk = compute_lane_state(done, len(children), category, fields,
                                     f.get("duedate"), today)

    return Line(
        id=key.lower(),
        title=fields.get("业务名称") or f.get("summary") or key,
        jira_key=key,
        start=_lane_start(epic, children, start_field),
        due=f.get("duedate"),
        rollup_due=_rollup_due(children),
        dates_provisional=False,
        stage=stage,
        risk=risk,
        children=[c.key for c in children],
        subtasks=[s.key for s in subtasks],
        done_count=done,
        total_count=len(children),
        business_name=fields.get("业务名称", ""),
        has_now=fields.get("已经具备", UNREVIEWED),
        needs=fields.get("还需完成", UNREVIEWED),
        definition_of_done=fields.get("整体验收", UNREVIEWED),
        acceptance=fields.get("整体验收", UNREVIEWED),
        evidence=fields.get("验收证据", ""),
        risk_note=fields.get("风险或变更说明", ""),
        decision_needed=fields.get("需要决定", UNREVIEWED),
        reviewed_by=fields.get("业务核对人"),
        reviewed_at=fields.get("业务核对时间"),
        missing=missing,
    )


def _lane_start(epic: dict[str, Any], children: list[Issue], start_field: str) -> str | None:
    """先用 Epic 自己的开始日期；没填才退回子项里最早的开始日。"""
    own = (epic.get("fields") or {}).get(start_field)
    if isinstance(own, str) and own:
        return own
    starts = [c.start for c in children if c.start]
    return min(starts) if starts else None


def build_milestone(raw: dict[str, Any], start_field: str) -> Milestone:
    f = raw.get("fields") or {}
    labels = _labels(raw)
    kind = "trial" if TRIAL_LABEL in labels else (
        "meeting" if MEETING_LABEL in labels else "target")
    start = f.get(start_field)
    due = f.get("duedate")
    begin = start if isinstance(start, str) and start else due
    end = due if (start and due and start != due) else None
    category = ((f.get("status") or {}).get("statusCategory") or {}).get("key") or "new"
    return Milestone(
        title=f.get("summary") or raw.get("key", ""),
        date=begin or "",
        end_date=end,
        kind=kind,
        status_category=category,
        jira_key=raw.get("key"),
    )


def build_meeting(raw: dict[str, Any]) -> Meeting:
    f = raw.get("fields") or {}
    key = raw.get("key", "")
    fields, missing_fields, has_block = adf.parse_meeting(f.get("description"))

    missing: list[str] = []
    if not has_block:
        missing.append(f"{key} 描述里没有「{adf.MEETING_MARKER}」区")
    elif missing_fields:
        missing.append(f"{key} 会议纪要缺：{'、'.join(missing_fields)}")

    tz_text = fields.get("时区", "")
    # duedate 只有日期，代替不了 14:00 的时刻；时刻只从纪要区读。
    return Meeting(
        title=f.get("summary") or key,
        date=f.get("duedate") or "",
        start_time=fields.get("开始") or None,
        end_time=fields.get("结束") or None,
        purpose=fields.get("目的", UNREVIEWED),
        jira_key=key,
        outcome=fields.get("决议", UNREVIEWED),
        pending=fields.get("待决问题", ""),
        attendees=fields.get("参与人", ""),
        timezone=tz_text or settings.TIMEZONE,
        time_provisional=not tz_text,
        missing=missing,
    )


def _parse_decisions(text: str) -> list[Decision]:
    """「需要决定」一行一条：事项｜决策人｜最晚日期。写「无」= 没有待决事项。

    只拆分隔符，不猜：没写决策人或日期就留 UNKNOWN，页面显示「待确认」。
    """
    items: list[Decision] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line in ("无", "无。"):
            continue
        parts = [p.strip() for p in line.replace("|", "｜").split("｜")]
        item = parts[0]
        if not item:
            continue
        owner = parts[1] if len(parts) > 1 and parts[1] else UNKNOWN
        deadline = parts[2] if len(parts) > 2 and parts[2] else UNKNOWN
        items.append(Decision(item=item, owner=owner, deadline=deadline))
    return items


def build_status_update(raw: dict[str, Any]) -> StatusUpdate:
    f = raw.get("fields") or {}
    key = raw.get("key", "")
    fields, missing_fields, has_block = adf.parse_status(f.get("description"))

    missing: list[str] = []
    if not has_block:
        missing.append(f"{key} 描述里没有「{adf.STATUS_MARKER}」区")
    elif missing_fields:
        # 「另一面」「本期完成」可以为空（写「无」），不算缺
        required = [m for m in missing_fields if m not in ("另一面", "本期完成")]
        if required:
            missing.append(f"{key} 状态更新缺：{'、'.join(required)}")

    health = fields.get("整体判断", "")
    if health and health not in HEALTHS:
        missing.append(f"{key} 整体判断「{health}」不在可选值内（按计划 / 有风险 / 已延期 / 暂停 / 已完成）")
        health = UNKNOWN
    if not health:
        health = UNKNOWN

    return StatusUpdate(
        jira_key=key,
        title=f.get("summary") or key,
        date=f.get("duedate") or "",
        health=health,
        basis=fields.get("判断依据", UNREVIEWED),
        counter=fields.get("另一面", ""),
        done_since=fields.get("本期完成", ""),
        next_steps=fields.get("下一步", UNREVIEWED),
        decisions=_parse_decisions(fields.get("需要决定", "")),
        author=fields.get("更新人") or None,
        missing=missing,
    )


# ---------- 组装 ----------

def assemble(
    lane_raw: list[dict[str, Any]],
    child_raw: list[dict[str, Any]],
    milestone_raw: list[dict[str, Any]],
    meeting_raw: list[dict[str, Any]],
    start_field: str,
    today: date | None = None,
    fetched_at: str | None = None,
    fetch_errors: list[str] | None = None,
    status_raw: list[dict[str, Any]] | None = None,
) -> Snapshot:
    """纯函数：原始 Jira 响应 → 快照。测试直接喂 fixture。"""
    today = today or today_local()
    errors = list(fetch_errors or [])

    all_issues = [parse_issue(r, start_field) for r in child_raw]
    by_parent: dict[str, list[Issue]] = {}
    subs_by_parent: dict[str, list[Issue]] = {}
    for iss in all_issues:
        bucket = subs_by_parent if iss.is_subtask else by_parent
        bucket.setdefault(iss.parent or "", []).append(iss)

    lines = []
    for epic in lane_raw:
        key = epic.get("key", "")
        children = by_parent.get(key, [])
        # Subtask 挂在执行单下，不是挂在 Epic 下：按执行单 key 收集
        child_keys = {c.key for c in children}
        subs = [s for parent, group in subs_by_parent.items()
                if parent in child_keys for s in group]
        lines.append(build_line(epic, children, subs, today, start_field))

    milestones = [build_milestone(r, start_field) for r in milestone_raw]
    milestones = [m for m in milestones if m.date]
    milestones.sort(key=lambda m: m.date)

    meetings = [build_meeting(r) for r in meeting_raw]
    meetings = [m for m in meetings if m.date]
    meetings.sort(key=lambda m: m.date)

    # 没有截止日期 = 不知道是哪一期，不进页面，但要记下来
    updates_all = [build_status_update(r) for r in (status_raw or [])]
    notes = [f"{su.jira_key} 状态更新缺截止日期（= 更新日期），未纳入"
             for su in updates_all if not su.date]
    status_updates = [su for su in updates_all if su.date]
    # 最新在前；同一天取 key 大的（后建的）为最新
    status_updates.sort(key=lambda su: (su.date, _key_number(su.jira_key)), reverse=True)

    status = FETCH_PARTIAL if errors else FETCH_OK
    snap = Snapshot(
        fetch_status=status,
        fetched_at=fetched_at or now_iso(),
        timezone=settings.TIMEZONE,
        today=today.isoformat(),
        schema_version=SCHEMA_VERSION,
        fetch_errors=errors,
        lines=lines,
        milestones=milestones,
        meetings=meetings,
        status_updates=status_updates,
        notes=notes,
        issues=all_issues,
        issue_count=sum(1 for i in all_issues if not i.is_subtask),
        source_note="数据来自 Jira；业务叙述来自 Epic 描述的管理摘要区。",
    )
    # 排期冲突是业务事实，写进快照，**不作为拒绝快照的理由**
    snap.date_check = check_dates(snap)
    return snap


def _key_number(key: str) -> int:
    try:
        return int(key.rsplit("-", 1)[1])
    except (IndexError, ValueError):
        return 0


def fetch(client: JiraClient) -> Snapshot:
    """真正去 Jira 取数。任何一次失败都抛 JiraError，由调用方决定保留旧快照。"""
    start_field = client.start_date_field()
    lane_raw = client.search(settings.LANE_JQL)
    if not lane_raw:
        raise JiraError(
            f"没有取到任何带 {LANE_LABEL} 标签的 Epic；"
            "这可能是标签没打或权限不足，不是「进度为空」")

    keys = ", ".join(e["key"] for e in lane_raw if e.get("key"))
    child_raw = client.search(f"parent in ({keys})") if keys else []
    # Subtask 的 parent 是执行单，不是 Epic，所以再取一层
    exec_keys = ", ".join(c["key"] for c in child_raw if c.get("key"))
    if exec_keys:
        child_raw = child_raw + client.search(f"parent in ({exec_keys})")

    # 主线取不到 = 报告没有意义，直接抛错保留旧快照（上面已处理）。
    # 里程碑和会议是**页面的一整块内容**：取不到就标 partial 并记录原因，
    # 由 SnapshotStore 决定保留上次完整快照——不能拿缺一块的数据盖掉完整数据。
    errors: list[str] = []
    try:
        milestone_raw = client.search(settings.MILESTONE_JQL)
    except JiraError as exc:
        milestone_raw, _ = [], errors.append(f"里程碑查询失败：{exc}")
    try:
        meeting_raw = client.search(settings.MEETING_JQL)
    except JiraError as exc:
        meeting_raw, _ = [], errors.append(f"会议查询失败：{exc}")
    try:
        status_raw = client.search(settings.STATUS_JQL)
    except JiraError as exc:
        status_raw, _ = [], errors.append(f"状态更新查询失败：{exc}")

    return assemble(lane_raw, child_raw, milestone_raw, meeting_raw, start_field,
                    fetch_errors=errors, status_raw=status_raw)


def failed_snapshot(reason: str) -> Snapshot:
    """取数彻底失败时的占位快照。只用于表达失败，不会被当成有效数据展示。"""
    return Snapshot(
        fetch_status=FETCH_FAILED,
        fetched_at=now_iso(),
        timezone=settings.TIMEZONE,
        today=today_local().isoformat(),
        fetch_errors=[reason],
    )
