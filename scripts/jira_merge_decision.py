#!/usr/bin/env python3
"""PR 合入之后，这张票该转到哪个状态。

纯计算：不联网、不读环境变量。给定 PR 正文、分支名、标题和票当前状态，算出目标状态和理由。
这样 `.github/workflows/jira-on-merge.yml` 里就只剩「调 API」，判断全部可以离线单测。

口径（Ryan 2026-09-21 定）：
- PR 验收表里**没有**「未验证」「❌」→ 转「已完成」
- **有** → 只转到「审查中」，并在评论里说明卡在哪

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


def unverified_markers(body: str | None) -> list[str]:
    """PR 验收表里出现了哪些「还没验」的声明。返回命中的字面，便于评论里写清楚。"""
    if not body:
        return []
    text = table_rows(strip_code_blocks(body))
    return [m for m in UNVERIFIED_MARKERS if m in text]


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
    target = STATUS_REVIEW if markers else STATUS_DONE
    if target == current_status:
        # 转到自己没有意义，只会在票上留一条「审查中 → 审查中」的噪声评论
        return {
            "action": "skip",
            "target": None,
            "reason": f"票已经是「{current_status}」，就是该去的状态，不重复转。",
            "markers": markers,
        }

    if markers:
        return {
            "action": "transition",
            "target": STATUS_REVIEW,
            "reason": (
                "PR 验收表里有未验证项（命中：" + "、".join(markers) + "），"
                "按口径只转到「审查中」，等人确认后再标完成。"
            ),
            "markers": markers,
        }
    return {
        "action": "transition",
        "target": STATUS_DONE,
        "reason": "PR 已合入且验收表里没有未验证项。",
        "markers": [],
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
               "reason": "分支名和标题里都没有 KAN 票号，跳过。", "markers": []}
    else:
        out = {"key": key, **decide(body, args.status or None)}

    json.dump(out, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
