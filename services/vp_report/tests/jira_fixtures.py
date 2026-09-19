"""构造 Jira 原始响应形状的测试数据。

形状照抄真实响应（2026-09-16 经 Atlassian MCP 读取 KAN 项目核对）：
status.statusCategory.key、issuetype.hierarchyLevel/subtask、parent.key、
duedate、labels、issuelinks、description(ADF)。

刻意不复用 output 里的旧快照当输入——那是**输出**格式，不是 Jira 的输入格式。
"""

from __future__ import annotations

from typing import Any

START_FIELD = "customfield_10015"

CAT_NEW, CAT_DOING, CAT_DONE = "new", "indeterminate", "done"
_CAT_NAME = {CAT_NEW: "待办", CAT_DOING: "正在进行", CAT_DONE: "已完成"}


def adf_paragraphs(*lines: str) -> dict[str, Any]:
    """手打形状：一行一个 paragraph。"""
    return {
        "type": "doc", "version": 1,
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": line}]}
            for line in lines
        ],
    }


def adf_code_block(text: str, *, preamble: str = "") -> dict[str, Any]:
    """粘贴形状：整段模板落在一个 codeBlock 里。"""
    content: list[dict[str, Any]] = []
    if preamble:
        content.append({"type": "heading", "attrs": {"level": 3},
                        "content": [{"type": "text", "text": preamble}]})
    content.append({"type": "codeBlock", "content": [{"type": "text", "text": text}]})
    return {"type": "doc", "version": 1, "content": content}


SUMMARY_TEMPLATE = """管理摘要 v1
业务名称：{name}
已经具备：{has_now}
还需完成：{needs}
整体验收：{acceptance}
验收证据：{evidence}
风险判断：{risk}
风险或变更说明：{risk_note}
需要决定：{decision}
业务核对人：{by}
业务核对时间：{at}"""


def summary_block(
    name="手机操作，电脑同步看到",
    has_now="代码基线已合并",
    needs="账号权限联调",
    acceptance="待验收",
    evidence="",
    risk="按计划",
    risk_note="",
    decision="无",
    by="Ryan",
    at="2026-09-16 09:00 America/Los_Angeles",
    *,
    shape="code",
) -> dict[str, Any]:
    text = SUMMARY_TEMPLATE.format(
        name=name, has_now=has_now, needs=needs, acceptance=acceptance,
        evidence=evidence, risk=risk, risk_note=risk_note, decision=decision, by=by, at=at)
    if shape == "code":
        return adf_code_block(text, preamble="交付目标")
    return adf_paragraphs(*text.splitlines())


MEETING_TEMPLATE = """会议纪要 v1
开始：{start}
结束：{end}
时区：{tz}
参与人：{who}
目的：{purpose}
待决问题：{pending}
决议：{outcome}"""


def meeting_block(start="14:00", end="", tz="America/Los_Angeles",
                  who="Ryan、J、PM", purpose="确认内部试用范围与验收方式",
                  pending="", outcome="", *, shape="code") -> dict[str, Any]:
    text = MEETING_TEMPLATE.format(
        start=start, end=end, tz=tz, who=who, purpose=purpose,
        pending=pending, outcome=outcome)
    if shape == "code":
        return adf_code_block(text)
    return adf_paragraphs(*text.splitlines())


STATUS_TEMPLATE = """状态更新 v1
整体判断：{health}
判断依据：{basis}
另一面：{counter}
本期完成：{done}
下一步：{next_steps}
需要决定：{decisions}
更新人：{by}"""


def status_block(health="有风险",
                 basis="6 项逾期里有 2 项没有任何进展记录；16 项未关闭工作没有负责人",
                 counter="主干已合入 3 个改动；逾期 6 项里有 4 项只是状态没回写",
                 done="账号契约与手机待办第一版已合入主干",
                 next_steps="给无负责人的工作定人，优先 09-25 试用范围",
                 decisions="双人确认是否必须｜David｜09-22\n线索是否进平台｜David｜",
                 by="Ryan", *, shape="code") -> dict[str, Any]:
    text = STATUS_TEMPLATE.format(health=health, basis=basis, counter=counter, done=done,
                                  next_steps=next_steps, decisions=decisions, by=by)
    if shape == "code":
        return adf_code_block(text)
    return adf_paragraphs(*text.splitlines())


def issue(key: str, summary: str, *, category: str = CAT_NEW, parent: str | None = None,
          due: str | None = None, start: str | None = None, labels: list[str] | None = None,
          subtask: bool = False, epic: bool = False, blocked_by: list[str] | None = None,
          description: Any = None, assignee: str | None = "ryanlian") -> dict[str, Any]:
    if epic:
        itype = {"name": "长篇故事", "subtask": False, "hierarchyLevel": 1}
    elif subtask:
        itype = {"name": "Subtask", "subtask": True, "hierarchyLevel": -1}
    else:
        itype = {"name": "故事", "subtask": False, "hierarchyLevel": 0}

    links = []
    for bk in blocked_by or []:
        links.append({"type": {"inward": "is blocked by", "outward": "blocks"},
                      "inwardIssue": {"key": bk}})

    return {
        "key": key,
        "fields": {
            "summary": summary,
            "issuetype": itype,
            "status": {"name": _CAT_NAME[category], "statusCategory": {"key": category}},
            "parent": {"key": parent} if parent else None,
            "duedate": due,
            START_FIELD: start,
            "labels": labels or [],
            "issuelinks": links,
            "description": description,
            "assignee": {"displayName": assignee} if assignee else None,
        },
    }


# ---------- 一套完整的、贴近真实的场景 ----------

def lanes(**overrides: Any) -> list[dict[str, Any]]:
    return [
        issue("KAN-35", "统一账号与 AWS 部署基础", epic=True, category=CAT_DOING,
              start="2026-09-15", due="2026-09-23", labels=["mgmt-lane"],
              description=summary_block(name="账号与安全上线", has_now="代码基线已合并",
                                        needs="账号权限、数据库与云上线")),
        issue("KAN-36", "将阶段清单升级为可分派的项目任务", epic=True,
              start="2026-09-16", due="2026-09-17", labels=["mgmt-lane"],
              description=summary_block(name="任务分派与确认", has_now="尚无",
                                        needs="任务模板与分派流程", risk="有风险",
                                        risk_note="依赖账号接口，起步偏晚")),
    ]


def children() -> list[dict[str, Any]]:
    return [
        issue("KAN-20", "A1 · 对齐代码基线", parent="KAN-35", category=CAT_DONE,
              start="2026-09-15", due="2026-09-16"),
        issue("KAN-21", "A2 · 账号与项目权限", parent="KAN-35",
              start="2026-09-15", due="2026-09-16"),
        issue("KAN-22", "B1 · 接入 PostgreSQL", parent="KAN-35",
              start="2026-09-18", due="2026-09-21", blocked_by=["KAN-25"]),
        issue("KAN-25", "B4 · CDK 基础设施", parent="KAN-35",
              start="2026-09-18", due="2026-09-22"),
        issue("KAN-27", "C1 · 任务模板与项目实例", parent="KAN-36",
              start="2026-09-16", due="2026-09-17"),
    ]


def subtasks() -> list[dict[str, Any]]:
    return [
        issue("KAN-41", "拆分：建表", parent="KAN-22", subtask=True,
              category=CAT_DONE, due="2026-09-20"),
    ]


def milestones() -> list[dict[str, Any]]:
    return [
        issue("KAN-34", "手机协作演示", due="2026-09-18", labels=["mgmt-milestone"]),
        issue("KAN-26", "云上线验收", due="2026-09-23", labels=["mgmt-milestone"]),
        issue("KAN-60", "首批房屋内部试用", start="2026-09-24", due="2026-09-25",
              labels=["mgmt-milestone", "mgmt-trial"]),
    ]


def meetings() -> list[dict[str, Any]]:
    return [
        issue("KAN-61", "试用方案确认会", due="2026-09-17", labels=["mgmt-meeting"],
              description=meeting_block(start="14:00", end="")),
        issue("KAN-62", "上线准备检查会", due="2026-09-22", labels=["mgmt-meeting"],
              description=meeting_block(start="14:00", end="14:45",
                                        purpose="检查上线准备，决定试用安排")),
    ]


def status_updates() -> list[dict[str, Any]]:
    """两期更新：最新一期有风险，上一期按计划。"""
    return [
        issue("KAN-70", "状态更新 09-14", due="2026-09-14", labels=["mgmt-status"],
              description=status_block(health="按计划", basis="基线已合并，排期无冲突",
                                       counter="无", done="无", decisions="无")),
        issue("KAN-71", "状态更新 09-16", due="2026-09-16", labels=["mgmt-status"],
              description=status_block()),
    ]


# ---------- 恶意输入 ----------

XSS = '<script>alert("x")</script>" onmouseover="alert(1)'
XSS_URL = "javascript:alert(1)"


def hostile_lanes() -> list[dict[str, Any]]:
    """Jira 里的一切都是外部可控输入。这份 fixture 专门喂脏字符。"""
    return [
        issue("KAN-35", f"Epic {XSS}", epic=True, category=CAT_DOING,
              start="2026-09-15", due="2026-09-23", labels=["mgmt-lane"],
              description=summary_block(
                  name=f"业务 {XSS}",
                  has_now=f"已具备 {XSS}",
                  risk_note=f"风险 {XSS} 详见 {XSS_URL}",
                  decision=f"决定 {XSS}")),
    ]


def hostile_status_updates() -> list[dict[str, Any]]:
    return [
        issue("KAN-98", f"状态更新 {XSS}", due="2026-09-16", labels=["mgmt-status"],
              description=status_block(basis=f"依据 {XSS}", decisions=f"决定 {XSS}｜{XSS}｜{XSS}",
                                       by=f"人 {XSS}")),
    ]


def hostile_children() -> list[dict[str, Any]]:
    return [
        issue(f"KAN-99", f"执行单 {XSS}", parent="KAN-35", due="2026-09-20",
              assignee=f"经办人 {XSS}"),
    ]
