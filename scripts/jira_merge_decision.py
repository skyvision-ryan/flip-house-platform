#!/usr/bin/env python3
"""PR 合入之后，这张票该转到哪个状态。

纯计算：不联网、不读环境变量。给定 PR 正文、分支名、标题和票当前状态，算出目标状态和理由。
这样 `.github/workflows/jira-on-merge.yml` 里就只剩「调 API」，判断全部可以离线单测。

口径（Ryan 2026-09-21 定；2026-09-22 按新 PR 模板细化）：
- 只看 PR 正文「## 本票关闭验收」一节的表格：**没有**「未验证」「❌」→ 可转「已完成」
- **有** → 只转到「审查中」，并在评论里说明卡在哪
- 「## 后续集成验证」一节是归属声明（真机/真实账号/云归哪张票），**不影响**本票判定
- 「## 范围核对」一节的表格里出现「待确认」→ 有未经批准的改动，同样停在「审查中」
- 正文没有「## 本票关闭验收」标题（旧模板的 PR）→ 退回旧口径：扫全部表格行

为什么不一律自动 Done：AGENTS.md 写着「Jira Done、代码合并和测试通过不能互相替代」。
合入只证明代码进了 main，不证明业务验收过了。让 PR 作者在验收表里自己声明有没有未验证项，
比让流水线假定「合了就是好了」诚实。
"""

from __future__ import annotations

import argparse
import json
import re
import sys

TICKET_RE = re.compile(r"KAN-\d+")

STATUS_REVIEW = "审查中"
STATUS_DONE = "已完成"

# 声明「还没验」的写法。中英文和符号都认，因为 PR 模板只规定了列，没规定字面。
UNVERIFIED_MARKERS = ("未验证", "未测", "待验证", "❌")

# 范围核对表里「还没批准」的写法。
SCOPE_PENDING_MARKERS = ("待确认",)

# 新 PR 模板（.claude/templates/pr-body.md）的三个标题。旧 PR 没有这些标题时退回全表扫描。
SECTION_CLOSING = "本票关闭验收"
SECTION_SCOPE = "范围核对"
SECTION_FOLLOWUP = "后续集成验证"

# 这些状态已经到位或更靠后，不再往回推，也不重复推进。
TERMINAL = (STATUS_DONE,)


def ticket_of(*texts: str | None) -> str | None:
    """从分支名、标题里取票号。优先分支名——分支是 hook 认的唯一权威。"""
    for text in texts:
        if not text:
            continue
        hit = TICKET_RE.search(text)
        if hit:
            return hit.group(0)
    return None


def strip_code_blocks(body: str) -> str:
    """围栏代码块里的内容不算声明。

    PR 正文里常贴命令输出，里面出现「未验证」只是别处抄来的文本，不是作者在声明本次有未验证项。
    """
    return re.sub(r"```.*?```", "", body, flags=re.S)


def table_rows(body: str) -> str:
    """只取表格行。

    验收是写在**表格**里的，散文不是声明。不加这条限制，任何一篇讨论验证的 PR 都会被
    误判——实测第一次真实触发时就中招了：PR 正文里写着这条规则本身
    （「没有『未验证 / 未测 / 待验证 / ❌』」），工具于是匹配到了自己的说明书，四个词全命中。
    """
    return "\n".join(line for line in body.splitlines() if line.lstrip().startswith("|"))


def section(body: str, heading: str) -> str | None:
    """取「## <heading>」到下一个 ## 之间的正文；没有这个标题返回 None。

    标题按前缀匹配（「## 本票关闭验收」「## 本票关闭验收（演示身份）」都算），不区分 ## 的个数。
    """
    lines = body.splitlines()
    start = None
    for i, line in enumerate(lines):
        stripped = line.strip()
        if re.match(r"#{1,6}\s*" + re.escape(heading), stripped):
            start = i + 1
            break
    if start is None:
        return None
    out = []
    for line in lines[start:]:
        if re.match(r"#{1,6}\s", line.strip()):
            break
        out.append(line)
    return "\n".join(out)


def unverified_markers(body: str | None) -> list[str]:
    """本票关闭验收表里出现了哪些「还没验」的声明。返回命中的字面，便于评论里写清楚。

    新模板的 PR 只看「## 本票关闭验收」一节——「## 后续集成验证」写的是真机/真实账号归哪张票，
    是归属不是失败，不能因为它把票压在审查中。旧模板（没有这个标题）退回扫全部表格行。
    """
    if not body:
        return []
    clean = strip_code_blocks(body)
    closing = section(clean, SECTION_CLOSING)
    text = table_rows(closing if closing is not None else clean)
    return [m for m in UNVERIFIED_MARKERS if m in text]


def scope_pending(body: str | None) -> list[str]:
    """范围核对表里有没有标「待确认」的改动。有就说明 diff 里有未经批准的东西，不能自动 Done。"""
    if not body:
        return []
    scope = section(strip_code_blocks(body), SECTION_SCOPE)
    if scope is None:
        return []
    text = table_rows(scope)
    return [m for m in SCOPE_PENDING_MARKERS if m in text]


def decide(body: str | None, current_status: str | None) -> dict:
    """算出目标状态。

    返回 {action, target, reason, markers}。action 为 "skip" 时 target 是 None。
    """
    if current_status in TERMINAL:
        return {
            "action": "skip",
            "target": None,
            "reason": f"票已经是「{current_status}」，不重复推进。",
            "markers": [],
        }

    markers = unverified_markers(body)
    pending = scope_pending(body)
    target = STATUS_REVIEW if (markers or pending) else STATUS_DONE
    if target == current_status:
        # 转到自己没有意义，只会在票上留一条「审查中 → 审查中」的噪声评论
        return {
            "action": "skip",
            "target": None,
            "reason": f"票已经是「{current_status}」，就是该去的状态，不重复转。",
            "markers": markers,
            "scope_pending": pending,
        }

    if markers or pending:
        why = []
        if markers:
            why.append("本票关闭验收表里有未验证项（命中：" + "、".join(markers) + "）")
        if pending:
            why.append("范围核对表里有未经批准的改动（命中：" + "、".join(pending) + "）")
        return {
            "action": "transition",
            "target": STATUS_REVIEW,
            "reason": "；".join(why) + "，按口径只转到「审查中」，等人确认后再标完成。",
            "markers": markers,
            "scope_pending": pending,
        }
    return {
        "action": "transition",
        "target": STATUS_DONE,
        "reason": "PR 已合入，本票关闭验收表里没有未验证项，范围核对表里没有待确认项。",
        "markers": [],
        "scope_pending": [],
    }


def pick_transition(transitions: list[dict], target: str) -> str | None:
    """从 Jira 给的可用转换里挑通往 target 的那个。

    按**状态名**找，不写死 id：工作流改了这里不用跟着改，而写死的 id 改了也不会报错，
    只会安静地转到别的状态去。
    """
    for t in transitions:
        if (t.get("to") or {}).get("name") == target:
            return t.get("id")
    return None


def comment_adf(text: str) -> dict:
    """把一段纯文本包成 Jira 的 ADF 评论体。换行要拆成多个段落，ADF 不认 \n。"""
    paragraphs = [
        {"type": "paragraph", "content": ([{"type": "text", "text": line}] if line else [])}
        for line in text.split("\n")
    ]
    return {"body": {"type": "doc", "version": 1, "content": paragraphs}}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="PR 合入后该把票转到哪个状态")
    parser.add_argument("--body", default="", help="PR 正文")
    parser.add_argument("--body-file", help="PR 正文所在文件，优先于 --body")
    parser.add_argument("--branch", default="", help="PR 的来源分支名")
    parser.add_argument("--title", default="", help="PR 标题")
    parser.add_argument("--status", default="", help="票当前状态名")
    args = parser.parse_args(argv)

    body = args.body
    if args.body_file:
        with open(args.body_file, encoding="utf-8") as handle:
            body = handle.read()

    key = ticket_of(args.branch, args.title)
    if not key:
        out = {"action": "skip", "key": None, "target": None,
               "reason": "分支名和标题里都没有 KAN 票号，跳过。", "markers": [], "scope_pending": []}
    else:
        out = {"key": key, **decide(body, args.status or None)}

    json.dump(out, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
