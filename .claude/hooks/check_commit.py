#!/usr/bin/env python3
"""PreToolUse / Bash：守住提交与推送。

规则
  - 提交主题必须含 KAN-<n>，且与当前 ticket 一致
  - 不允许在 main / master 上提交
  - 不允许 force push，不允许直推 main

为什么用 python 而不是 shell：判断必须区分「命令本身」与「heredoc 正文」。
如果只对整段命令文本做 grep，就会把正文里出现的 `git commit` 当成真的在提交
（例如写文档或造测试用例时），也会把正文里的 `-m unittest` 当成提交信息。
所以这里先把所有 heredoc 正文抠掉再判断，正文只用来取提交主题。

退出码：0 放行；2 阻断并把 stderr 回灌给模型。
"""

from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import sys
from datetime import datetime
from pathlib import Path

TICKET_RE = re.compile(r"KAN-[0-9]+")
HEREDOC_RE = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n")
GIT_COMMIT_RE = re.compile(r"(?:^|[;&|(\s])git\s+(?:-C\s+\S+\s+)?commit\b")
GIT_PUSH_RE = re.compile(r"(?:^|[;&|(\s])git\s+(?:-C\s+\S+\s+)?push\b")
FORCE_RE = re.compile(r"(--force(?![-\w])|--force-with-lease|\s-f(?=\s|$))")
PUSH_MAIN_RE = re.compile(r"push[^|;&]*?\s(?:origin\s+)?(?:main|master)(?:\s|$)")
PROJ = Path(os.environ.get("CLAUDE_PROJECT_DIR") or Path(__file__).resolve().parents[2])
STATE_DIR = PROJ / ".claude" / "state"


def split_heredocs(cmd: str) -> tuple[str, list[tuple[int, str]]]:
    """返回 (剥掉 heredoc 正文的命令, [(起始行在命令里的位置, 正文)])。"""
    code_parts: list[str] = []
    bodies: list[tuple[int, str]] = []
    pos = 0
    while True:
        m = HEREDOC_RE.search(cmd, pos)
        if not m:
            code_parts.append(cmd[pos:])
            break
        code_parts.append(cmd[pos:m.start()])
        rest = cmd[m.end():]
        end = re.search(r"^" + re.escape(m.group(2)) + r"\s*$", rest, re.M)
        body = rest[:end.start()] if end else rest
        bodies.append((m.start(), body))
        pos = m.end() + (end.end() if end else len(rest))
    return "".join(code_parts), bodies


def subject_from_flags(code: str) -> str | None:
    """从 -m / --message 取第一段信息（只看命令部分，不看 heredoc 正文）。"""
    try:
        parts = shlex.split(code)
    except ValueError:
        parts = code.split()
    i = 0
    while i < len(parts):
        p = parts[i]
        if p in ("-m", "--message") and i + 1 < len(parts):
            return parts[i + 1]
        if p.startswith("--message="):
            return p.split("=", 1)[1]
        if re.fullmatch(r"-[a-zA-Z]*m", p) and i + 1 < len(parts):
            return parts[i + 1]
        i += 1
    return None


def first_line(text: str) -> str | None:
    for line in text.splitlines():
        if line.strip():
            return line.strip()
    return None


def git(*args: str) -> str:
    try:
        return subprocess.run(["git", "-C", str(PROJ), *args], capture_output=True,
                              text=True, timeout=10).stdout.strip()
    except Exception:
        return ""


def branch() -> str:
    return git("rev-parse", "--abbrev-ref", "HEAD")


def active_ticket() -> str | None:
    f = STATE_DIR / "active-ticket"
    if f.is_file():
        hit = TICKET_RE.search(f.read_text(encoding="utf-8"))
        if hit:
            return hit.group(0)
    hit = TICKET_RE.search(branch())
    return hit.group(0) if hit else None


def log_bypass(what: str) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    with (STATE_DIR / "bypass.log").open("a", encoding="utf-8") as fh:
        fh.write(f"{datetime.now():%Y-%m-%d %H:%M:%S}\t{branch()}\t{what}\n")


def deny(msg: str) -> None:
    print(msg, file=sys.stderr)
    sys.exit(2)


def check(cmd: str) -> None:
    code, bodies = split_heredocs(cmd)
    is_commit = bool(GIT_COMMIT_RE.search(code))
    is_push = bool(GIT_PUSH_RE.search(code))
    if not (is_commit or is_push):
        return

    if os.environ.get("KAN_BYPASS") == "1":
        log_bypass(f"KAN_BYPASS 放行：{code.strip()[:120]}")
        print("⚠ KAN_BYPASS=1 已放行本次 git 操作，已记入 .claude/state/bypass.log。"
              "提交信息里请写明绕过原因。")
        return

    if is_push:
        if FORCE_RE.search(code):
            deny("不允许 force push。要改历史请说明原因并由人工执行。")
        if PUSH_MAIN_RE.search(code):
            deny("不允许直推 main。流程是：推当前分支 → 开 PR → 转 In Review → 由人合入 main。")
        return

    if branch() in ("main", "master"):
        deny(f"当前在 {branch()} 分支上，不能直接提交。"
             "先 /jira:next 或 /jira:start <KAN-n> 切到 ticket 分支。")

    subject = subject_from_flags(code)
    if subject is None:
        # 用 -F - / heredoc 传信息：取 git commit 之后那段 heredoc 正文的首行
        cpos = GIT_COMMIT_RE.search(code).start()
        after = [b for p, b in bodies if p >= cpos] or [b for _, b in bodies]
        subject = first_line(after[0]) if after else None

    if not subject:
        if re.search(r"(--amend|--no-edit|--reuse-message|-C\s)", code):
            return
        deny("提交请用 -m 或 heredoc 显式写信息，便于校验 ticket 号。"
             "格式：KAN-<n> 一句话说明。")

    hit = TICKET_RE.search(subject)
    if not hit:
        ticket = active_ticket() or "KAN-<n>"
        deny(f"提交主题必须以 ticket 号开头，例如：{ticket} 加上一句话说明。"
             f"当前信息是：{subject[:60]}")

    current = active_ticket()
    if current and hit.group(0) != current:
        deny(f"提交信息写的是 {hit.group(0)}，但当前 ticket 是 {current}。"
             f"一张 ticket 一个分支一组提交，不要混改；确实要换单请先 /jira:start {hit.group(0)}。")


def main() -> None:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw or "{}")
    except json.JSONDecodeError:
        # 读不懂输入时放行：守卫本身不该因为协议变化把所有命令挡死，
        # 但要在 stderr 留一行，方便发现。
        print("check_commit：hook 输入不是合法 JSON，已放行本次命令。", file=sys.stderr)
        return
    cmd = (payload.get("tool_input") or {}).get("command") or ""
    if cmd:
        check(cmd)


if __name__ == "__main__":
    main()
