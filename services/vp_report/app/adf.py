"""读 Jira 描述（ADF）里的固定管理模板区。

只识别固定模板区，描述里的其他内容一律不碰、不改、不显示。
缺失、冲突或格式损坏时标记「待核对」，**不从自由评论或 AI 推断补出验收结论**。

为什么要吃两种形状：模板在维护文档里是以代码块给出的，粘进 Jira 会变成一个
`codeBlock` 节点（整段在一个 text 子节点里）；有人手打就会变成 N 个 `paragraph`
或 `bulletList`。两种都得能解析，否则 PM 换个粘贴方式页面就空了。

**占位值与冲突**（实测纠偏）：
- 「待核对」「待确认」「无」这类占位词**不是**已填写。验收类字段拿它当值，
  会把一条没人签字的主线显示成「已验收」。
- 同一个字段写了两遍且值不同（先写未通过、后改成已通过），不能默认后写的算数。
  两边都留着、标成冲突，由人去 Jira 里改清楚——猜错的代价是管理层看到假验收。
"""

from __future__ import annotations

from typing import Any, NamedTuple

SUMMARY_MARKER = "管理摘要 v1"
MEETING_MARKER = "会议纪要 v1"

# 全角/半角冒号都接受——中文输入法下两种都会出现
_COLONS = ("：", ":")

SUMMARY_FIELDS = (
    "业务名称", "已经具备", "还需完成", "整体验收", "验收证据",
    "风险判断", "风险或变更说明", "需要决定", "业务核对人", "业务核对时间",
)
MEETING_FIELDS = (
    "开始", "结束", "时区", "参与人", "目的", "待决问题", "决议",
)

# 这些词表示「还没填」，不能当成事实。大小写与全半角都归一后比对。
PLACEHOLDERS = frozenset({
    "待核对", "待确认", "待定", "未定", "暂无", "无", "没有", "n/a", "na",
    "tbd", "todo", "-", "--", "—", "?", "？", "未知", "待补充",
})

# 描述里可以单独写的自由行（不需要整套模板），谁都能在 Jira 里维护
DISPLAY_NAME_KEY = "展示名称"
DATE_STATUS_KEY = "日期状态"
PROVISIONAL_WORDS = frozenset({"暂定", "待确认", "未确认", "tentative"})


class Parsed(NamedTuple):
    """解析结果。conflicts / placeholders 不为空时，调用方必须显示出来。"""
    fields: dict[str, str]
    missing: list[str]
    conflicts: list[str]
    placeholders: list[str]
    found: bool          # 模板区是否存在


def is_placeholder(value: Any) -> bool:
    """这个值是不是「还没填」。空、模板占位符 <…>、占位词都算。"""
    if value is None:
        return True
    text = str(value).strip()
    if not text:
        return True
    if text.startswith("<") and text.endswith(">"):
        return True
    return text.lower() in PLACEHOLDERS


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


def all_lines(description: Any) -> list[str]:
    """整份描述的所有文字行，用于读自由行（展示名称、日期状态）。"""
    if not isinstance(description, dict):
        return []
    out: list[str] = []
    for node in description.get("content") or []:
        out.extend(node_text(node).splitlines())
    return [line.strip() for line in out if line.strip()]


def find_line_value(description: Any, key: str) -> str | None:
    """在描述里找 `键：值` 这样的一行。写在哪儿都行，不要求整套模板。

    这样「展示名称」「日期状态」就能在 Jira 里维护，不用写死回代码。
    """
    for line in all_lines(description):
        for colon in _COLONS:
            prefix = f"{key}{colon}"
            if line.startswith(prefix):
                value = line[len(prefix):].strip()
                return value or None
    return None


def _heading_level(node: dict) -> int | None:
    if node.get("type") != "heading":
        return None
    return (node.get("attrs") or {}).get("level", 1)


def _marker_starts(top: list, marker: str) -> list[int]:
    """模板区的所有起点。出现多次 = 冲突，不能只认第一个。"""
    starts = []
    for idx, node in enumerate(top):
        if isinstance(node, dict) and node_text(node).strip().startswith(marker):
            starts.append(idx)
    return starts


def extract_block(description: Any, marker: str) -> tuple[list[str], int]:
    """取出模板区的文字行，并返回模板区出现了几次。

    起点：文字以 marker 开头的顶层节点（heading / paragraph / codeBlock 都行）。
    终点：codeBlock 自成一体到此为止；否则到下一个同级/更高级 heading 或 rule。
    """
    if not isinstance(description, dict):
        return [], 0
    top = description.get("content") or []
    if not isinstance(top, list):
        return [], 0

    starts = _marker_starts(top, marker)
    if not starts:
        return [], 0

    start = starts[0]
    start_level = _heading_level(top[start])

    collected: list[str] = []
    collected.extend(node_text(top[start]).splitlines())

    # codeBlock 是自包含的：整段模板就在这一个节点里，到此为止。
    # 继续往后吃会把模板后面的说明文字并进最后一个字段——真实数据里正是这样，
    # 「决议：」原本是空的，却被后面一段「说明：…」顶成了已填写。
    if top[start].get("type") == "codeBlock":
        return [line.strip() for line in collected if line.strip()], len(starts)

    for node in top[start + 1:]:
        if not isinstance(node, dict):
            continue
        if node.get("type") == "rule":
            break
        level = _heading_level(node)
        if level is not None and (start_level is None or level <= start_level):
            break
        collected.extend(node_text(node).splitlines())

    return [line.strip() for line in collected if line.strip()], len(starts)


def parse_fields(lines: list[str], expected: tuple[str, ...]) -> Parsed:
    """把「字段：值」的行解析成字典。

    同一个字段出现多次且值不同 → 记冲突，并把该字段当作**没填**，
    不按「后写的算数」猜结论。
    """
    found: dict[str, list[list[str]]] = {}   # 字段 → 每次出现的值（可多行）
    current: list[str] | None = None

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
            name, first = matched
            bucket = [first] if first else []
            found.setdefault(name, []).append(bucket)
            current = bucket
        elif current is not None:
            current.append(line)          # 续行：属于上一个字段

    fields: dict[str, str] = {}
    missing: list[str] = []
    conflicts: list[str] = []
    placeholders: list[str] = []

    for name in expected:
        occurrences = [" ".join(parts).strip() for parts in found.get(name, [])]
        distinct = sorted({v for v in occurrences if v})

        if len(distinct) > 1:
            conflicts.append(f"{name} 填了多个不同的值（{' / '.join(distinct)}）")
            missing.append(name)
            continue

        value = distinct[0] if distinct else ""
        if is_placeholder(value):
            if value:                      # 填了，但填的是占位词
                placeholders.append(name)
            missing.append(name)
            continue
        fields[name] = value

    return Parsed(fields, missing, conflicts, placeholders, found=True)


def _parse(description: Any, marker: str, expected: tuple[str, ...]) -> Parsed:
    lines, block_count = extract_block(description, marker)
    if not lines:
        return Parsed({}, list(expected), [], [], found=False)
    parsed = parse_fields(lines, expected)
    conflicts = list(parsed.conflicts)
    if block_count > 1:
        conflicts.insert(0, f"描述里有 {block_count} 个「{marker}」区，无法判断以哪个为准")
    return parsed._replace(conflicts=conflicts)


def parse_summary(description: Any) -> Parsed:
    """解析「管理摘要 v1」区。"""
    return _parse(description, SUMMARY_MARKER, SUMMARY_FIELDS)


def parse_meeting(description: Any) -> Parsed:
    """解析「会议纪要 v1」区。"""
    return _parse(description, MEETING_MARKER, MEETING_FIELDS)
