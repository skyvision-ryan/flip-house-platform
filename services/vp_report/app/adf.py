"""读 Jira 描述（ADF）里的固定管理模板区。

只识别固定模板区，描述里的其他内容一律不碰、不改、不显示。
缺失、冲突或格式损坏时标记「待核对」，**不从自由评论或 AI 推断补出验收结论**。

为什么要吃两种形状：模板在维护文档里是以代码块给出的，粘进 Jira 会变成一个
`codeBlock` 节点（整段在一个 text 子节点里）；有人手打就会变成 N 个 `paragraph`
或 `bulletList`。两种都得能解析，否则 PM 换个粘贴方式页面就空了。
"""

from __future__ import annotations

from typing import Any

SUMMARY_MARKER = "管理摘要 v1"
MEETING_MARKER = "会议纪要 v1"
STATUS_MARKER = "状态更新 v1"

# 全角/半角冒号都接受——中文输入法下两种都会出现
_COLONS = ("：", ":")

SUMMARY_FIELDS = (
    "业务名称", "已经具备", "还需完成", "整体验收", "验收证据",
    "风险判断", "风险或变更说明", "需要决定", "业务核对人", "业务核对时间",
)
MEETING_FIELDS = (
    "开始", "结束", "时区", "参与人", "目的", "待决问题", "决议",
)
# 状态更新：一条工作项 = 一期更新，只新增不改写，历史自然保留（对齐 Asana 的做法）。
# 「需要决定」一行一条，行内用「｜」分隔 事项｜决策人｜最晚日期，所以要保留换行。
STATUS_FIELDS = (
    "整体判断", "判断依据", "另一面", "本期完成", "下一步", "需要决定", "更新人",
)
STATUS_MULTILINE = ("需要决定",)


def node_text(node: Any) -> str:
    """把一个 ADF 节点里的文字抽出来。hardBreak 视为换行。"""
    if not isinstance(node, dict):
        return ""
    if node.get("type") == "text":
        return node.get("text", "")
    if node.get("type") == "hardBreak":
        return "\n"
    parts = []
    for child in node.get("content") or []:
        parts.append(node_text(child))
    text = "".join(parts)
    # 列表项之间要断行，否则「已经具备：a还需完成：b」会粘成一行
    if node.get("type") in ("paragraph", "listItem", "heading", "codeBlock"):
        text += "\n"
    return text


def _heading_level(node: dict) -> int | None:
    if node.get("type") != "heading":
        return None
    return (node.get("attrs") or {}).get("level", 1)


def extract_block(description: Any, marker: str) -> list[str]:
    """取出模板区的所有文字行。找不到返回空列表。

    起点：第一个文字以 marker 开头的顶层节点（heading / paragraph / codeBlock 都行）。
    终点：下一个同级或更高级的 heading，或一条 rule（分隔线），或文档结束。
    """
    if not isinstance(description, dict):
        return []
    top = description.get("content") or []
    if not isinstance(top, list):
        return []

    start = None
    start_level = None
    for idx, node in enumerate(top):
        if not isinstance(node, dict):
            continue
        text = node_text(node).strip()
        if text.startswith(marker):
            start = idx
            start_level = _heading_level(node)
            break
    if start is None:
        return []

    collected: list[str] = []
    first_text = node_text(top[start])
    collected.extend(first_text.splitlines())

    # codeBlock 是自包含的：整段模板就在这一个节点里，到此为止。
    # 继续往后吃会把模板后面的说明文字并进最后一个字段——真实数据里正是这样，
    # 「决议：」原本是空的，却被后面一段「说明：…」顶成了已填写。
    if top[start].get("type") == "codeBlock":
        return [line.strip() for line in collected if line.strip()]

    for node in top[start + 1:]:
        if not isinstance(node, dict):
            continue
        if node.get("type") == "rule":
            break
        level = _heading_level(node)
        if level is not None and (start_level is None or level <= start_level):
            break
        collected.extend(node_text(node).splitlines())

    return [line.strip() for line in collected if line.strip()]


def parse_fields(lines: list[str], expected: tuple[str, ...],
                 multiline: tuple[str, ...] = ()) -> tuple[dict[str, str], list[str]]:
    """把「字段：值」的行解析成字典，并报告哪些字段缺失。

    支持值写在下一行（`已经具备：` 换行后写内容），也支持多行值累加。
    `multiline` 里的字段保留换行（一行一条），其余字段多行合成一行。
    返回 (字段字典, 缺失字段列表)。
    """
    found: dict[str, list[str]] = {}
    current: str | None = None

    for line in lines:
        matched = None
        for name in expected:
            for colon in _COLONS:
                prefix = f"{name}{colon}"
                if line.startswith(prefix):
                    matched = (name, line[len(prefix):].strip())
                    break
            if matched:
                break
        if matched:
            current = matched[0]
            found[current] = [matched[1]] if matched[1] else []
        elif current is not None:
            # 续行：属于上一个字段
            found[current].append(line)

    result = {}
    missing = []
    for name in expected:
        joiner = "\n" if name in multiline else " "
        value = joiner.join(found.get(name, [])).strip()
        # 模板占位符 <...> 不算已填
        if value.startswith("<") and value.endswith(">"):
            value = ""
        if value:
            result[name] = value
        else:
            missing.append(name)
    return result, missing


def parse_summary(description: Any) -> tuple[dict[str, str], list[str], bool]:
    """解析「管理摘要 v1」区。返回 (字段, 缺失字段, 模板区是否存在)。"""
    lines = extract_block(description, SUMMARY_MARKER)
    if not lines:
        return {}, list(SUMMARY_FIELDS), False
    fields, missing = parse_fields(lines, SUMMARY_FIELDS)
    return fields, missing, True


def parse_meeting(description: Any) -> tuple[dict[str, str], list[str], bool]:
    """解析「会议纪要 v1」区。返回 (字段, 缺失字段, 模板区是否存在)。"""
    lines = extract_block(description, MEETING_MARKER)
    if not lines:
        return {}, list(MEETING_FIELDS), False
    fields, missing = parse_fields(lines, MEETING_FIELDS)
    return fields, missing, True


def parse_status(description: Any) -> tuple[dict[str, str], list[str], bool]:
    """解析「状态更新 v1」区。返回 (字段, 缺失字段, 模板区是否存在)。"""
    lines = extract_block(description, STATUS_MARKER)
    if not lines:
        return {}, list(STATUS_FIELDS), False
    fields, missing = parse_fields(lines, STATUS_FIELDS, multiline=STATUS_MULTILINE)
    return fields, missing, True
