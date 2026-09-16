#!/usr/bin/env python3
"""VP 进度报告的数据契约与一致性检查。

设计约束（来自 KAN-40 的纠偏要求）：
- 取数失败必须与「零结果」区分。
- 倒推得到的日期一律 provisional=True，显示为「暂定」，不是已确认承诺。
- 未知信息用 UNKNOWN 显式表达，不用空字符串冒充「没有问题」。
- 交付阶段与风险提示是两个独立维度，不能互相推导。
- 不产出总体完成百分比：本项目没有可靠口径。

**两类失败必须分开**（第二阶段新增，这是最容易做错的一点）：

- `validate_integrity()` 检查的是「这份快照本身是不是坏的」——取数失败、分页没取完、
  必需字段解析不出来、内部自相矛盾。不通过 → 不替换上次成功快照。
- `check_dates()` 检查的是「排期本身有没有冲突」——缺日期、日期倒置、子项超出承诺日、
  依赖日期矛盾。这些是**真实的业务风险事实，不是取数失败**。快照照常有效，
  冲突显示在「需要关注」里。

把第二类当成第一类，会让页面在排期真的有冲突时永久停在「暂不可用」——
而排期有冲突恰恰是 VP 最需要看到的时候。
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import date
from typing import Any

SCHEMA_VERSION = 2

UNKNOWN = "待确认"
UNREVIEWED = "待核对"

# 交付阶段：只描述工作推进到哪，不代表业务已认可
STAGES = ("未开始", "进行中", "待验收", "已验收")
# 风险提示：独立维度，不由阶段推导
RISKS = ("按计划", "有风险", "已延期", UNKNOWN)

FETCH_OK, FETCH_PARTIAL, FETCH_FAILED = "ok", "partial", "failed"

MILESTONE_KINDS = ("meeting", "target", "trial")


class ContractError(ValueError):
    """契约校验失败：这份快照本身是坏的，不能拿去替换上次成功快照。"""


@dataclass
class Issue:
    key: str
    summary: str
    status: str
    status_category: str          # new / indeterminate / done
    start: str | None
    due: str | None
    start_provisional: bool
    parent: str | None
    assignee: str | None
    is_subtask: bool = False      # Subtask 只在详情显示，不计入 done/total
    blocked_by: list[str] = field(default_factory=list)


@dataclass
class Line:
    """VP 首页的一条交付主线（对应一个打了 mgmt-lane 标签的 Epic）。"""
    id: str
    title: str
    jira_key: str | None          # None = 尚未在 Jira 建记录
    jira_note: str = ""
    start: str | None = None
    due: str | None = None        # Epic 自己的 duedate = 承诺日
    rollup_due: str | None = None  # max(子项 duedate)，只用于提示，不覆盖承诺日
    dates_provisional: bool = True
    stage: str = "未开始"
    risk: str = UNKNOWN
    children: list[str] = field(default_factory=list)
    subtasks: list[str] = field(default_factory=list)
    done_count: int = 0           # 仅辅助信息，不等于业务完成度
    active_count: int = 0         # 正在进行的执行单数：子单开工，主线就该动
    total_count: int = 0
    # 业务叙述：只从 Epic 描述的「管理摘要 v1」区读，脚本永不推断
    business_name: str = ""
    has_now: str = UNREVIEWED
    needs: str = UNREVIEWED
    definition_of_done: str = UNREVIEWED
    acceptance: str = UNREVIEWED
    evidence: str = ""
    risk_note: str = ""
    decision_needed: str = UNREVIEWED
    reviewed_by: str | None = None
    reviewed_at: str | None = None
    # 这条主线缺了什么，逐条说清楚，供页面显示「待确认：…」
    missing: list[str] = field(default_factory=list)
    # 自相矛盾、占位值冒充结论之类的问题：必须出现在首页「需要关注」，
    # 埋在展开详情里等于没说
    conflicts: list[str] = field(default_factory=list)


@dataclass
class Milestone:
    """首页上少量、具名的业务节点。技术 ticket 默认不是里程碑。"""
    title: str
    date: str
    kind: str                     # meeting / target / trial
    end_date: str | None = None
    status_category: str = "new"
    jira_key: str | None = None
    note: str = ""
    date_provisional: bool = False   # 日期字段有值 ≠ 已确认承诺
    missing: list[str] = field(default_factory=list)


@dataclass
class Event:
    """首页统一展示的业务节点。

    交付目标、试用、会议**共用一条时间轴**。分开维护会出现这种事：
    9/17 的会议在快照里读到了，首页却说下一个节点是 9/18 的交付单。
    """
    title: str
    kind: str                        # meeting / target / trial
    date: str                        # "" = 日期待确认，仍要显示，不能静默消失
    end_date: str | None = None
    start_time: str | None = None    # None = 时刻未填
    end_time: str | None = None
    time_provisional: bool = False   # 没写时区，按 LA 解释
    date_provisional: bool = False   # 日期只是暂定
    status_category: str = "new"
    jira_key: str | None = None
    note: str = ""
    missing: list[str] = field(default_factory=list)

    def order(self) -> tuple:
        """同日按已知时刻排序；时刻未知的排在当天已知时刻之后。"""
        return (self.date or "9999-12-31", self.start_time or "99:99")

    def is_done(self) -> bool:
        return self.status_category == "done"


@dataclass
class Meeting:
    title: str
    date: str
    start_time: str | None        # None = 时刻未填
    end_time: str | None          # None = 结束时间未确认
    purpose: str
    jira_key: str | None = None
    outcome: str = UNREVIEWED
    pending: str = ""
    attendees: str = ""
    timezone: str = ""
    time_provisional: bool = False  # True = 没写时区，按 LA 解释
    missing: list[str] = field(default_factory=list)


@dataclass
class Deployment:
    environment: str
    sha: str
    state: str
    created_at: str
    url: str


@dataclass
class Snapshot:
    fetch_status: str
    fetched_at: str               # 最后一次**成功同步**时间，不是页面生成时间
    timezone: str
    today: str
    schema_version: int = SCHEMA_VERSION
    fetch_errors: list[str] = field(default_factory=list)
    lines: list[Line] = field(default_factory=list)
    # events = 页面实际展示的统一节点集合（由 milestones + meetings 合并去重）
    events: list[Event] = field(default_factory=list)
    milestones: list[Milestone] = field(default_factory=list)
    meetings: list[Meeting] = field(default_factory=list)
    deployments: list[Deployment] = field(default_factory=list)
    issues: list[Issue] = field(default_factory=list)
    date_check: dict[str, Any] = field(default_factory=dict)
    issue_count: int = 0
    source_note: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def validate_integrity(snap: Snapshot) -> None:
    """快照**结构**校验。不通过 = 这份数据坏了，不得替换上次成功快照。

    注意这里**不**检查排期冲突。排期冲突是业务事实，见 check_dates()。
    """
    if snap.fetch_status not in (FETCH_OK, FETCH_PARTIAL, FETCH_FAILED):
        raise ContractError(f"fetch_status 非法：{snap.fetch_status!r}")
    if snap.fetch_status == FETCH_FAILED and not snap.fetch_errors:
        raise ContractError("fetch_status=failed 但没有记录失败原因")
    if snap.fetch_status == FETCH_OK and snap.fetch_errors:
        raise ContractError("fetch_status=ok 但存在 fetch_errors，两者矛盾")
    if snap.schema_version != SCHEMA_VERSION:
        raise ContractError(f"schema_version 不匹配：{snap.schema_version} != {SCHEMA_VERSION}")
    if not snap.lines:
        raise ContractError("没有任何交付主线；空报告不得产出")
    for ln in snap.lines:
        if ln.stage not in STAGES:
            raise ContractError(f"{ln.id} 交付阶段非法：{ln.stage!r}")
        if ln.risk not in RISKS:
            raise ContractError(f"{ln.id} 风险提示非法：{ln.risk!r}")
        # 自相矛盾：声称业务已验收，却拿不出完整依据。
        # 四样缺一不可：验收结果、验收证据、业务核对人、业务核对时间。
        if ln.stage == "已验收":
            if ln.definition_of_done == UNREVIEWED:
                raise ContractError(f"{ln.id} 标为已验收但没有验收结果，拒绝产出")
            for label, value in (("验收证据", ln.evidence),
                                 ("业务核对人", ln.reviewed_by),
                                 ("业务核对时间", ln.reviewed_at)):
                if not value:
                    raise ContractError(f"{ln.id} 标为已验收但缺少{label}，拒绝产出")
    for ms in snap.milestones:
        if ms.kind not in MILESTONE_KINDS:
            raise ContractError(f"里程碑 {ms.title} 类型非法：{ms.kind!r}")
        # 缺日期是**业务事实**（没填交付日），不是数据损坏：页面显示待确认。
        if ms.date:
            _require_date(ms.date, f"里程碑 {ms.title}")
    for m in snap.meetings:
        if m.date:
            _require_date(m.date, f"会议 {m.title}")
    for ev in snap.events:
        if ev.kind not in MILESTONE_KINDS:
            raise ContractError(f"节点 {ev.title} 类型非法：{ev.kind!r}")
        if ev.date:
            _require_date(ev.date, f"节点 {ev.title}")


def next_event(events: list[Event], today: date) -> Event | None:
    """下一个待办节点：日期未过且没完成的第一个。

    过去的、已完成的都不算——首页写「下一个节点」却指着上周的会议，
    比不写还糟。events 已按 (日期, 时刻) 排好序。
    """
    for ev in events:
        if not ev.date or ev.is_done():
            continue
        try:
            when = date.fromisoformat(ev.date)
        except ValueError:
            continue
        if when >= today:
            return ev
    return None


def _require_date(value: str, what: str) -> None:
    try:
        date.fromisoformat(value)
    except (TypeError, ValueError):
        raise ContractError(f"{what} 日期无法解析：{value!r}") from None


def _d(value: str | None) -> date | None:
    try:
        return date.fromisoformat(value) if value else None
    except ValueError:
        return None


def check_dates(snap: Snapshot) -> dict[str, Any]:
    """逐条比较开始/截止日期，产出**业务风险事实**。

    这些结果**不是**取数失败，绝不能用来拒绝一份结构完好的快照。
    发现冲突恰恰说明报告在起作用，应显示在「需要关注」里。

    不使用 JQL 做字段与字段的比较——`cf[10015] > duedate` 在本站不报错但恒不匹配，
    据此得出的「零违规」结论已在 Jira 撤回。依赖关系读 Jira 原生 issuelinks。
    """
    by_key = {i.key: i for i in snap.issues}
    checked, missing, anomalies = 0, [], []

    for iss in snap.issues:
        if iss.is_subtask:
            continue
        checked += 1
        s, d = _d(iss.start), _d(iss.due)
        if s is None:
            missing.append(f"{iss.key} 缺开始日期")
        if d is None:
            missing.append(f"{iss.key} 缺截止日期")
        if s and d and s > d:
            anomalies.append(f"{iss.key} 开始({iss.start}) 晚于截止({iss.due})")

    # 依赖矛盾：被阻塞单的截止早于阻塞它的单
    for iss in snap.issues:
        target_due = _d(iss.due)
        if target_due is None:
            continue
        for bk in iss.blocked_by:
            src = by_key.get(bk)
            src_due = _d(src.due) if src else None
            if src_due and target_due < src_due:
                anomalies.append(
                    f"{iss.key} 截止({iss.due}) 早于其前置 {bk} 截止({src.due})")

    # 子项汇总日超出 Epic 承诺日：提示，绝不覆盖承诺日
    for ln in snap.lines:
        due, rollup = _d(ln.due), _d(ln.rollup_due)
        if due and rollup and rollup > due:
            anomalies.append(
                f"{ln.title} 子项日期({ln.rollup_due}) 已超出承诺日({ln.due}) "
                f"{(rollup - due).days} 天")

    return {"checked": checked, "missing": missing, "anomalies": anomalies}
