"""把 Jira 的原始响应组装成一份报告快照。

这里**不允许出现任何 issue key、会议日期、试用日期、依赖关系或业务文案**。
全部来自 Jira：主线来自 mgmt-lane 标签的 Epic，里程碑来自 mgmt-milestone，
会议来自 mgmt-meeting，业务叙述来自描述里的「管理摘要 v1」区。
缺什么就说缺什么，不用旧常量顶替。

取数与组装分开：`assemble()` 是纯函数，测试直接喂 fixture，不需要网络。
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from . import adf, settings
from .contract import (
    FETCH_FAILED, FETCH_OK, FETCH_PARTIAL, SCHEMA_VERSION, UNKNOWN, UNREVIEWED,
    Event, Issue, Line, Meeting, Milestone, Snapshot, check_dates, next_event,
)
from .jira_client import JiraClient, JiraError

TZ = ZoneInfo(settings.TIMEZONE)

LANE_LABEL = "mgmt-lane"
MILESTONE_LABEL = "mgmt-milestone"
MEETING_LABEL = "mgmt-meeting"
TRIAL_LABEL = "mgmt-trial"

_RISK_MAP = {"按计划": "按计划", "有风险": "有风险", "已延期": "已延期", UNREVIEWED: UNKNOWN}

# 业务核对时间至少要有一个能解析的日期，可再带 HH:MM 和时区文字
_REVIEW_TIME_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2}))?")


def today_local() -> date:
    return datetime.now(TZ).date()


def now_iso() -> str:
    return datetime.now(TZ).isoformat(timespec="seconds")


def valid_review_time(text: Any) -> bool:
    """业务核对时间必须是能解析的日期（可带时刻），不能是一句话或占位词。"""
    if adf.is_placeholder(text):
        return False
    m = _REVIEW_TIME_RE.match(str(text).strip())
    if not m:
        return False
    try:
        date.fromisoformat(m.group(1))
    except ValueError:
        return False
    if m.group(2) is not None:
        hh, mm = int(m.group(2)), int(m.group(3))
        if not (0 <= hh <= 23 and 0 <= mm <= 59):
            return False
    return True


# ---------- 原始 Jira → 契约对象 ----------

def parse_issue(raw: dict[str, Any], start_field: str) -> Issue:
    f = raw.get("fields") or {}
    itype = f.get("issuetype") or {}
    status = f.get("status") or {}
    category = (status.get("statusCategory") or {}).get("key") or "new"
    blocked_by = []
    for link in f.get("issuelinks") or []:
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


def display_name(raw: dict[str, Any]) -> str:
    """页面上显示的名字。

    Jira 标题是给开发看的（「D4 · 修复真机验收问题…」「B4 · 用 CDK 建立…」），
    VP 不该读这些。想换个说法，在描述里写一行「展示名称：…」即可——
    **在 Jira 维护，不写死回代码**。没写就照用 Jira 标题。
    """
    f = raw.get("fields") or {}
    name = adf.find_line_value(f.get("description"), adf.DISPLAY_NAME_KEY)
    if name and not adf.is_placeholder(name):
        return name
    return f.get("summary") or raw.get("key", "")


def _date_is_provisional(raw: dict[str, Any]) -> bool:
    """日期字段有值 ≠ 已确认承诺。要暂定就在描述里写「日期状态：暂定」。"""
    f = raw.get("fields") or {}
    status = adf.find_line_value(f.get("description"), adf.DATE_STATUS_KEY)
    if not status:
        return False
    return status.strip().lower() in adf.PROVISIONAL_WORDS


def compute_lane_state(
    done_count: int, active_count: int, total_count: int, epic_category: str,
    summary: dict[str, str], due: str | None, today: date,
) -> tuple[str, str]:
    """交付阶段与风险提示。**顶部摘要和图里的状态都调这一个函数。**

    规则（brief §6）：ticket 全 Done 只到「待验收」；必须有明确的整体验收结果
    才是「已验收」。不得仅凭处于待验收就显示延期。

    `active_count` 是**正在进行**的执行单数。没有它的话，Epic 还挂在「待办」、
    子单已经开工的主线会显示成「未开始」——开工要靠人手动去改 Epic 才看得见，
    那报告就不是跟着 Jira 走了。
    """
    # 「已验收」是业务结论，门槛是四样齐全且**都不是占位词**：
    # 验收结果 + 证据 + 确认人 + 可解析的确认时间。
    # 「整体验收：已通过 / 验收证据：待核对」不是验收，是还没填完。
    accepted = (
        summary.get("整体验收") == "已通过"
        and not adf.is_placeholder(summary.get("验收证据"))
        and not adf.is_placeholder(summary.get("业务核对人"))
        and valid_review_time(summary.get("业务核对时间"))
    )
    if accepted:
        stage = "已验收"
    elif total_count > 0 and done_count == total_count:
        stage = "待验收"
    elif done_count > 0 or active_count > 0 or epic_category == "indeterminate":
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


def _lane_start(epic: dict[str, Any], children: list[Issue], start_field: str) -> str | None:
    """先用 Epic 自己的开始日期；没填才退回子项里最早的开始日。"""
    own = (epic.get("fields") or {}).get(start_field)
    if isinstance(own, str) and own:
        return own
    starts = [c.start for c in children if c.start]
    return min(starts) if starts else None


def build_line(epic: dict[str, Any], children: list[Issue], subtasks: list[Issue],
               today: date, start_field: str = "customfield_10015") -> Line:
    f = epic.get("fields") or {}
    key = epic.get("key", "")
    parsed = adf.parse_summary(f.get("description"))
    fields = parsed.fields

    missing: list[str] = []
    conflicts: list[str] = []
    if not parsed.found:
        missing.append(f"{key} 描述里没有「{adf.SUMMARY_MARKER}」区")
    else:
        conflicts.extend(f"{key} {c}" for c in parsed.conflicts)
        if parsed.placeholders:
            missing.append(f"{key} 这些字段还是占位值：{'、'.join(parsed.placeholders)}")
        remaining = [m for m in parsed.missing if m not in parsed.placeholders]
        if remaining:
            missing.append(f"{key} 管理摘要缺：{'、'.join(remaining)}")
    if not f.get("duedate"):
        missing.append(f"{key} 没有填承诺日（截止日期）")
    # 声称已通过但拿不出完整依据：这是矛盾，要让人看见，不是静静降级
    if fields.get("整体验收") == "已通过":
        gaps = [label for label, ok in (
            ("验收证据", not adf.is_placeholder(fields.get("验收证据"))),
            ("业务核对人", not adf.is_placeholder(fields.get("业务核对人"))),
            ("业务核对时间", valid_review_time(fields.get("业务核对时间"))),
        ) if not ok]
        if gaps:
            conflicts.append(
                f"{key} 标了「整体验收：已通过」，但 {'、'.join(gaps)} 还不可用，"
                "按待验收显示")

    done = sum(1 for c in children if c.status_category == "done")
    active = sum(1 for c in children if c.status_category == "indeterminate")
    category = ((f.get("status") or {}).get("statusCategory") or {}).get("key") or "new"
    stage, risk = compute_lane_state(done, active, len(children), category, fields,
                                     f.get("duedate"), today)

    return Line(
        id=key.lower(),
        title=display_name(epic),
        jira_key=key,
        start=_lane_start(epic, children, start_field),
        due=f.get("duedate"),
        rollup_due=_rollup_due(children),
        dates_provisional=_date_is_provisional(epic),
        stage=stage,
        risk=risk,
        children=[c.key for c in children],
        subtasks=[s.key for s in subtasks],
        done_count=done,
        active_count=active,
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
        conflicts=conflicts,
    )


def milestone_kind(raw: dict[str, Any]) -> str:
    labels = _labels(raw)
    if TRIAL_LABEL in labels:
        return "trial"
    if MEETING_LABEL in labels:
        return "meeting"
    return "target"


def build_milestone(raw: dict[str, Any], start_field: str) -> Milestone:
    """按类别决定节点画在哪一天。

    交付目标画在**交付日**（截止日期）。以前一律优先开始日，结果
    start=9/21、due=9/23 的交付单被画在 9/21——把开工日当成了交付承诺。
    缺截止日期就留空，页面显示待确认，不拿开工日顶替。
    """
    f = raw.get("fields") or {}
    key = raw.get("key", "")
    kind = milestone_kind(raw)
    start = f.get(start_field)
    start = start if isinstance(start, str) and start else None
    due = f.get("duedate")

    missing: list[str] = []
    if kind == "trial":
        # 试用是一段区间：开始 → 结束
        begin = start or due
        end = due if (start and due and start != due) else None
        if not begin:
            missing.append(f"{key} 试用没有填开始或结束日期")
    elif kind == "meeting":
        begin, end = due, None
        if not begin:
            missing.append(f"{key} 会议没有填日期")
    else:
        begin, end = due, None          # 交付目标 = 交付日
        if not begin:
            missing.append(f"{key} 没有填交付日（截止日期）")

    category = ((f.get("status") or {}).get("statusCategory") or {}).get("key") or "new"
    return Milestone(
        title=display_name(raw),
        date=begin or "",
        end_date=end,
        kind=kind,
        status_category=category,
        jira_key=key,
        date_provisional=_date_is_provisional(raw),
        missing=missing,
    )


def build_meeting(raw: dict[str, Any]) -> Meeting:
    f = raw.get("fields") or {}
    key = raw.get("key", "")
    parsed = adf.parse_meeting(f.get("description"))
    fields = parsed.fields

    missing: list[str] = []
    if not parsed.found:
        missing.append(f"{key} 描述里没有「{adf.MEETING_MARKER}」区")
    else:
        for conflict in parsed.conflicts:
            missing.append(f"{key} {conflict}")
        if parsed.missing:
            missing.append(f"{key} 会议纪要缺：{'、'.join(parsed.missing)}")
    if not f.get("duedate"):
        missing.append(f"{key} 会议没有填日期")

    tz_text = fields.get("时区", "")
    # duedate 只有日期，代替不了 14:00 的时刻；时刻只从纪要区读。
    return Meeting(
        title=display_name(raw),
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


def build_events(milestones: list[Milestone], meetings: list[Meeting]) -> list[Event]:
    """交付目标、试用、会议合并成**一条时间轴**上的同一批节点。

    会议只凭 mgmt-meeting 标签就该出现，不要求再补第二个标签。
    同一个 Jira key 两边都出现时按会议算——会议带时刻，信息更全。
    """
    events: list[Event] = []
    seen: set[str] = set()

    for m in meetings:
        if m.jira_key:
            seen.add(m.jira_key)
        events.append(Event(
            title=m.title, kind="meeting", date=m.date,
            start_time=m.start_time, end_time=m.end_time,
            time_provisional=m.time_provisional,
            status_category="new", jira_key=m.jira_key, missing=list(m.missing),
        ))

    for ms in milestones:
        if ms.jira_key and ms.jira_key in seen:
            continue                     # 已经以会议身份进来了，不重复
        events.append(Event(
            title=ms.title, kind=ms.kind, date=ms.date, end_date=ms.end_date,
            date_provisional=ms.date_provisional,
            status_category=ms.status_category, jira_key=ms.jira_key,
            missing=list(ms.missing),
        ))

    events.sort(key=lambda e: e.order())
    return events


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

    # 缺日期的记录**保留**并显示为待确认，不静默丢掉
    milestones = [build_milestone(r, start_field) for r in milestone_raw]
    milestones.sort(key=lambda m: m.date or "9999-12-31")

    meetings = [build_meeting(r) for r in meeting_raw]
    meetings.sort(key=lambda m: (m.date or "9999-12-31", m.start_time or "99:99"))

    status = FETCH_PARTIAL if errors else FETCH_OK
    snap = Snapshot(
        fetch_status=status,
        fetched_at=fetched_at or now_iso(),
        timezone=settings.TIMEZONE,
        today=today.isoformat(),
        schema_version=SCHEMA_VERSION,
        fetch_errors=errors,
        lines=lines,
        events=build_events(milestones, meetings),
        milestones=milestones,
        meetings=meetings,
        issues=all_issues,
        issue_count=sum(1 for i in all_issues if not i.is_subtask),
        source_note="数据来自 Jira；业务叙述来自 Epic 描述的管理摘要区。",
    )
    # 排期冲突是业务事实，写进快照，**不作为拒绝快照的理由**
    snap.date_check = check_dates(snap)
    return snap


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

    return assemble(lane_raw, child_raw, milestone_raw, meeting_raw, start_field,
                    fetch_errors=errors)


def failed_snapshot(reason: str) -> Snapshot:
    """取数彻底失败时的占位快照。只用于表达失败，不会被当成有效数据展示。"""
    return Snapshot(
        fetch_status=FETCH_FAILED,
        fetched_at=now_iso(),
        timezone=settings.TIMEZONE,
        today=today_local().isoformat(),
        fetch_errors=[reason],
    )
