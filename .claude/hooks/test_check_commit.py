#!/usr/bin/env python3
"""守卫自己的测试：python3 .claude/hooks/test_check_commit.py

守卫拦错东西比不拦更糟（它会把正常开发挡死），所以这些用例都是真实踩到过的形状：
命令文本里出现 `git commit` 字样但并不是在提交、提交正文里出现 `-m unittest`、
heredoc 起始行后面还跟着管道。
"""

import json
import os
import subprocess
import sys
from pathlib import Path

HOOK = Path(__file__).with_name("check_commit.py")
PROJ = Path(__file__).resolve().parents[2]

# (说明, 命令, 期望退出码)  0 = 放行，2 = 阻断
CASES = [
    ("-m 带正确 key", 'git commit -m "KAN-20 修好了"', 0),
    ("-m 没有 key", 'git commit -m "修一下东西"', 2),
    ("-m 的第二段正文里有 -m unittest",
     'git commit -m "KAN-20 修好了" -m "跑 python -m unittest discover -s tests"', 0),
    ("heredoc 正文里有 -m unittest",
     "git commit -F - <<'MSG'\nKAN-20 加了测试\n\n跑 python -m unittest discover -s tests\nMSG", 0),
    ("heredoc 起始行后面还有管道",
     "cd /x && git add a && git commit -F - <<'MSG' 2>&1 | tail -4\nKAN-20 加了测试\nMSG\ngit log -1", 0),
    ("heredoc 正文没有 key", "git commit -F - <<'MSG'\n修一下东西\nMSG", 2),
    ("heredoc 里的 key 与当前单不符", "git commit -F - <<'MSG'\nKAN-99 别的单\nMSG", 2),
    ("命令里只是提到 git commit 字样，并不是在提交",
     "python3 - <<'PY'\ncases = [\"git commit -m 'KAN-1 x'\"]\nprint(cases)\nPY", 0),
    ("写文档时正文出现 git commit",
     "cat > doc.md <<'MD'\n提交格式：git commit -m \"KAN-<n> 说明\"\nMD", 0),
    ("amend 不带信息", "git commit --amend --no-edit", 0),
    ("完全无关的命令", "ls -la && grep -rn foo .", 0),
    ("force push", "git push --force origin HEAD", 2),
    ("force-with-lease", "git push --force-with-lease origin HEAD", 2),
    ("直推 main", "git push origin main", 2),
    ("推自己的 ticket 分支", "git push -u origin KAN-20-baseline-alignment", 0),
]


def run(cmd: str) -> tuple[int, str]:
    payload = json.dumps({"tool_input": {"command": cmd}})
    env = {**os.environ, "CLAUDE_PROJECT_DIR": str(PROJ)}
    env.pop("KAN_BYPASS", None)
    p = subprocess.run([sys.executable, str(HOOK)], input=payload,
                       capture_output=True, text=True, env=env)
    return p.returncode, (p.stderr or p.stdout).strip()


def main() -> int:
    failed = 0
    for name, cmd, want in CASES:
        got, msg = run(cmd)
        ok = got == want
        failed += 0 if ok else 1
        print(f"{'✅' if ok else '❌'} {name:<34} 退出码 {got}（期望 {want}）"
              + (f"  · {msg.splitlines()[0][:70]}" if msg else ""))
    print(f"\n{len(CASES) - failed}/{len(CASES)} 通过")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
