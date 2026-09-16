#!/usr/bin/env python3
"""Claude Bash hook for obvious unsafe commit/push commands.

This is a convenience guard, not a security boundary. The Git branch is the only
source of the active ticket; .claude/state may be stale after checkout.
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
SUBJECT_RE = re.compile(r"^(KAN-[0-9]+)\b")
HEREDOC_RE = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n")
GIT_COMMIT_RE = re.compile(r"(?:^|[;&|(\s])git\s+(?:-C\s+\S+\s+)?commit\b")
GIT_PUSH_RE = re.compile(r"(?:^|[;&|(\s])git\s+(?:-C\s+\S+\s+)?push\b")
FORCE_RE = re.compile(r"(--force(?![-\w])|--force-with-lease|\s-f(?=\s|$))")
PUSH_MAIN_RE = re.compile(r"push[^|;&]*?(?:\s|:)(?:main|master)(?:\s|$)")
PROJ = Path(os.environ.get("CLAUDE_PROJECT_DIR") or Path(__file__).resolve().parents[2]).resolve()
STATE_DIR = PROJ / ".claude" / "state"


def split_heredocs(command: str) -> tuple[str, list[tuple[int, str]]]:
    code_parts: list[str] = []
    bodies: list[tuple[int, str]] = []
    pos = 0
    while True:
        match = HEREDOC_RE.search(command, pos)
        if not match:
            code_parts.append(command[pos:])
            break
        code_parts.append(command[pos:match.start()])
        rest = command[match.end():]
        end = re.search(r"^" + re.escape(match.group(2)) + r"\s*$", rest, re.M)
        body = rest[:end.start()] if end else rest
        bodies.append((match.start(), body))
        pos = match.end() + (end.end() if end else len(rest))
    return "".join(code_parts), bodies


def subject_from_flags(code: str) -> str | None:
    try:
        parts = shlex.split(code)
    except ValueError:
        parts = code.split()
    for index, part in enumerate(parts):
        if part in ("-m", "--message") and index + 1 < len(parts):
            return parts[index + 1]
        if part.startswith("--message="):
            return part.split("=", 1)[1]
        if re.fullmatch(r"-[A-Za-z]*m", part) and index + 1 < len(parts):
            return parts[index + 1]
    return None


def first_line(text: str) -> str | None:
    return next((line.strip() for line in text.splitlines() if line.strip()), None)


def git(*args: str) -> str:
    try:
        return subprocess.run(
            ["git", "-C", str(PROJ), *args], capture_output=True, text=True, timeout=10
        ).stdout.strip()
    except Exception:
        return ""


def branch() -> str:
    return git("branch", "--show-current")


def active_ticket() -> str | None:
    hit = TICKET_RE.search(branch())
    return hit.group(0) if hit else None


def log_bypass(action: str) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    with (STATE_DIR / "bypass.log").open("a", encoding="utf-8") as handle:
        handle.write(f"{datetime.now():%Y-%m-%d %H:%M:%S}\t{branch()}\t{action}\n")


def deny(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(2)


def check(command: str) -> None:
    code, bodies = split_heredocs(command)
    commit_match = GIT_COMMIT_RE.search(code)
    is_commit = bool(commit_match)
    is_push = bool(GIT_PUSH_RE.search(code))
    if not (is_commit or is_push):
        return

    if os.environ.get("KAN_BYPASS") == "1":
        log_bypass(code.strip()[:160])
        print("KAN_BYPASS=1：已放行并写入 bypass.log。")
        return

    current_branch = branch()
    if is_push:
        if FORCE_RE.search(code):
            deny("不允许 force push。")
        if current_branch in ("main", "master") or PUSH_MAIN_RE.search(code):
            deny("不允许从 Claude 直推 main/master；推执行单分支并开 PR。")

    if not is_commit:
        return

    if current_branch in ("main", "master"):
        deny(f"当前在 {current_branch}，不能直接提交业务改动。")

    current = active_ticket()
    if not current:
        deny(f"分支 {current_branch or '<detached>'} 没有 KAN-编号，不能提交业务改动。")

    subject = subject_from_flags(code)
    if subject is None and commit_match:
        after = [body for pos, body in bodies if pos >= commit_match.start()] or [body for _, body in bodies]
        subject = first_line(after[0]) if after else None

    if not subject:
        if re.search(r"(--amend|--no-edit|--reuse-message|-C\s)", code):
            return
        deny("提交必须显式提供主题，格式：KAN-<n> 一句话。")

    hit = SUBJECT_RE.match(subject)
    if not hit:
        deny(f"提交主题必须以 {current} 开头；当前是：{subject[:80]}")
    if hit.group(1) != current:
        deny(f"提交主题是 {hit.group(1)}，当前分支是 {current}；不要混单。")


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError:
        print("check_commit：无法解析 hook 输入，本次未检查。", file=sys.stderr)
        return
    command = (payload.get("tool_input") or {}).get("command") or ""
    if command:
        check(command)


if __name__ == "__main__":
    main()
