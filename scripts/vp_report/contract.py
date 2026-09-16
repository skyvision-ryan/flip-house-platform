#!/usr/bin/env python3
"""VP 进度报告的数据契约与一致性检查。

这是第一阶段与第二阶段共用的部分：第一阶段把快照渲染成图片供人工审阅，
第二阶段（受权限保护的手机网页）消费同一份契约。渲染器是验证载体，契约不是。

设计约束（来自 KAN-40 的纠偏要求）：
- 取数失败必须与「零结果」区分。fetch_status 不是 ok 时，渲染器拒绝出图。
- 倒推得到的日期一律 provisional=True，显示为「暂定」，不是已确认承诺。
- 未知信息用 UNKNOWN 显式表达，不用空字符串冒充「没有问题」。
- 交付阶段与风险提示是两个独立维度，不能互相推导。
- 不产出总体完成百分比：本项目没有可靠口径。
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import date
from typing import Any

SCHEMA_VERSION = 1

UNKNOWN = "待确认"
UNREVIEWED = "待核对"

# 交付阶段：只描述工作推进到哪，不代表业务已认可
STAGES = ("未开始", "进行中", "待验收", "已验收")
# 风险提示：独立维度，不由阶段推导
RISKS = ("按计划", "有风险", "已延期", UNKNOWN)

FETCH_OK, FETCH_PARTIAL, FETCH_FAILED = "ok", "partial", "failed"


class ContractError(ValueError):
    """契约校验失败。宁可抛错，也不产出一张看似正常的报告。"""


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


@dataclass
class Line:
    """VP 首页的一条交付主线。"""
    id: str
    title: str                    # 业务语言，不是 Epic 原标题
    jira_key: str | None          # None = 尚未在 Jira 建记录
    jira_note: str = ""
    start: str | None = None
    due: str | None = None
    dates_provisional: bool = True
    stage: str = "未开始"
    risk: str = UNKNOWN
    children: list[str] = field(default_factory=list)
    done_count: int = 0           # 仅辅助信息，不等于业务完成度
    total_count: int = 0
    # 业务叙述：只能由人填写，脚本永不推断
    has_now: str = UNREVIEWED
    needs: str = UNREVIEWED
    definition_of_done: str = UNREVIEWED
    decision_needed: str = UNREVIEWED


@dataclass
class Meeting:
    title: str
    date: str
    start_time: str
    end_time: str | None          # None = 结束时间未确认
    purpose: str
    jira_key: str | None = None
    outcome: str = UNREVIEWED


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
    fetched_at: str
    timezone: str
    today: str
    fetch_errors: list[str] = field(default_factory=list)
    lines: list[Line] = field(default_factory=list)
    meetings: list[Meeting] = field(default_factory=list)
    deployments: list[Deployment] = field(default_factory=list)
    aws_status: str = "未开始"
    issues: list[Issue] = field(default_factory=list)
    reviewed_by: str | None = None      # 业务核对人
    reviewed_at: str | None = None      # 业务核对时间（≠ 最后成功同步时间）
    source_note: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def validate(snap: Snapshot) -> None:
    """校验不通过即抛错。调用方不得吞掉异常后继续渲染。"""
    if snap.fetch_status not in (FETCH_OK, FETCH_PARTIAL, FETCH_FAILED):
        raise ContractError(f"fetch_status 非法：{snap.fetch_status!r}")
    if snap.fetch_status == FETCH_FAILED and not snap.fetch_errors:
        raise ContractError("fetch_status=failed 但没有记录失败原因")
    if snap.fetch_status == FETCH_OK and snap.fetch_errors:
        raise ContractError("fetch_status=ok 但存在 fetch_errors，两者矛盾")
    if not snap.lines:
        raise ContractError("没有任何交付主线；空报告不得产出")
    for ln in snap.lines:
        if ln.stage not in STAGES:
            raise ContractError(f"{ln.id} 交付阶段非法：{ln.stage!r}")
        if ln.risk not in RISKS:
            raise ContractError(f"{ln.id} 风险提示非法：{ln.risk!r}")
        if ln.stage == "已验收" and ln.definition_of_done == UNREVIEWED:
            raise ContractError(f"{ln.id} 标为已验收但没有验收依据，拒绝产出")


def _d(value: str | None) -> date | None:
    return date.fromisoformat(value) if value else None


def check_dates(snap: Snapshot, blocks: dict[str, list[str]]) -> dict[str, Any]:
    """逐条比较开始/截止日期。不使用 JQL 做字段与字段的比较——
    `cf[10015] > duedate` 在本站不报错但恒不匹配，无法作为验证依据。

    blocks: {被阻塞单: [阻塞它的单, ...]}
    """
    by_key = {i.key: i for i in snap.issues}
    checked, missing, anomalies = 0, [], []

    for iss in snap.issues:
        checked += 1
        s, d = _d(iss.start), _d(iss.due)
        if s is None:
            missing.append(f"{iss.key} 缺开始日期")
        if d is None:
            missing.append(f"{iss.key} 缺截止日期")
        if s and d and s > d:
            anomalies.append(f"{iss.key} 开始({iss.start}) 晚于截止({iss.due})")

    for blocked, blockers in blocks.items():
        target = by_key.get(blocked)
        if target is None or not target.due:
            continue
        for bk in blockers:
            src = by_key.get(bk)
            if src is None or not src.due:
                continue
            if _d(target.due) < _d(src.due):
                anomalies.append(
                    f"{blocked} 截止({target.due}) 早于其前置 {bk} 截止({src.due})"
                )

    return {"checked": checked, "missing": missing, "anomalies": anomalies}
