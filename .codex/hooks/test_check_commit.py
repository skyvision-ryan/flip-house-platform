#!/usr/bin/env python3
"""Hermetic tests for check_commit.py; never use the real repo branch or state."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

HOOK = Path(__file__).with_name("check_commit.py")

CASES = [
    ("正确主题", "KAN-20-test", 'git commit -m "KAN-20 修复权限"', 0),
    ("key 不在开头", "KAN-20-test", 'git commit -m "fix KAN-20 权限"', 2),
    ("没有 key", "KAN-20-test", 'git commit -m "修一下"', 2),
    ("与分支不符", "KAN-20-test", 'git commit -m "KAN-99 别的单"', 2),
    ("第二段正文不干扰", "KAN-20-test", 'git commit -m "KAN-20 测试" -m "python -m unittest"', 0),
    ("heredoc 正确", "KAN-20-test", "git commit -F - <<'MSG'\nKAN-20 加测试\nMSG", 0),
    ("heredoc 错误", "KAN-20-test", "git commit -F - <<'MSG'\nKAN-99 别的单\nMSG", 2),
    ("文档正文提到 commit", "KAN-20-test", "cat <<'DOC'\ngit commit -m x\nDOC", 0),
    ("无关命令", "KAN-20-test", "python -m unittest", 0),
    ("amend 保留信息", "KAN-20-test", "git commit --amend --no-edit", 0),
    ("无票分支提交", "docs-cleanup", 'git commit -m "KAN-20 假借单号"', 2),
    ("force push", "KAN-20-test", "git push --force origin HEAD", 2),
    ("force-with-lease", "KAN-20-test", "git push --force-with-lease origin HEAD", 2),
    ("明确推 main", "KAN-20-test", "git push origin main", 2),
    ("main 默认推送", "main", "git push", 2),
    ("推执行单分支", "KAN-20-test", "git push -u origin HEAD", 0),
    ("提交后推送仍验提交", "KAN-20-test", 'git commit -m "错误" && git push origin HEAD', 2),
]


def call(repo: Path, branch: str, command: str) -> tuple[int, str]:
    subprocess.run(["git", "-C", str(repo), "checkout", "-q", "-B", branch],
                   check=True, capture_output=True)
    payload = json.dumps({"tool_input": {"command": command}})
    env = {**os.environ, "CLAUDE_PROJECT_DIR": str(repo)}
    env.pop("KAN_BYPASS", None)
    result = subprocess.run([sys.executable, str(HOOK)], input=payload,
                            capture_output=True, text=True, env=env)
    return result.returncode, (result.stderr or result.stdout).strip()


def main() -> int:
    failures = 0
    with tempfile.TemporaryDirectory(prefix="check-commit-") as directory:
        repo = Path(directory)
        subprocess.run(["git", "init", "-q", str(repo)], check=True)
        for name, branch, command, expected in CASES:
            code, message = call(repo, branch, command)
            ok = code == expected
            failures += not ok
            detail = f" · {message.splitlines()[0][:70]}" if message else ""
            print(f"{'OK' if ok else 'FAIL'} {name}: {code}（期望 {expected}）{detail}")
    print(f"\n{len(CASES) - failures}/{len(CASES)} 通过")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
