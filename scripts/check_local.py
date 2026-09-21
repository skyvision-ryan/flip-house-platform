#!/usr/bin/env python3
"""Run the repository's local checks without touching real app data or external services."""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"


def run(label: str, command: list[str], cwd: Path, env: dict[str, str] | None = None) -> bool:
    print(f"\n[{label}] {' '.join(command)}")
    result = subprocess.run(command, cwd=cwd, env=env)
    if result.returncode:
        print(f"{label} 失败（退出码 {result.returncode}）")
        return False
    print(f"{label} 通过")
    return True


def main() -> int:
    python = BACKEND / ".venv" / "bin" / "python"
    if not python.exists():
        print("缺少 backend/.venv；按 README 安装开发依赖。")
        return 2
    py_version = subprocess.run(
        [str(python), "-c", "import sys; print('.'.join(map(str, sys.version_info[:3])))"],
        capture_output=True, text=True,
    ).stdout.strip()
    if tuple(map(int, py_version.split(".")[:2])) < (3, 12):
        print(f"需要 Python 3.12+，当前虚拟环境是 {py_version}。")
        return 2

    node22 = Path("/opt/homebrew/opt/node@22/bin")
    env = os.environ.copy()
    if (node22 / "node").exists():
        env["PATH"] = str(node22) + os.pathsep + env.get("PATH", "")
    node = shutil.which("node", path=env.get("PATH"))
    if not node:
        print("找不到 Node；按 README 安装 Node 22。")
        return 2
    node_major = int(subprocess.run([node, "-p", "process.versions.node.split('.')[0]"],
                                    capture_output=True, text=True).stdout.strip())
    if node_major != 22:
        print(f"需要 Node 22，当前是 {node_major}。")
        return 2

    if not (FRONTEND / "node_modules").is_dir():
        print("缺少 frontend/node_modules；按 README 运行 npm ci。")
        return 2

    ok = True
    with tempfile.TemporaryDirectory(prefix="flip-house-check-") as data_dir:
        test_env = env.copy()
        test_env.update({"DATA_DIR": data_dir, "SEED_DEMO": "0", "DEMO_MODE": "1"})
        ok &= run("后端测试", [str(python), "-m", "unittest", "discover", "-s", "tests"],
                  BACKEND, test_env)
    ok &= run("开发工具测试", [sys.executable, ".claude/hooks/test_check_commit.py"], ROOT, env)
    # 前端纯逻辑单测：Node 22 自带 --test 和 TS 剥离，不需要额外依赖。
    # 按目录发现，不写死文件名——写死的话新增测试不会被跑到，还得记得改这一行。
    # 排序保证每次命令行一致；一个都找不到判失败，免得测试文件被删光了却静默通过。
    tests = sorted(p.relative_to(FRONTEND).as_posix() for p in (FRONTEND / "src").rglob("*.test.ts"))
    if not tests:
        print("没有找到 frontend/src 下的 *.test.ts")
        ok = False
    else:
        ok &= run("前端单测", [node, "--test", "--experimental-strip-types", *tests], FRONTEND, env)
    ok &= run("前端构建", ["npm", "run", "build"], FRONTEND, env)
    ok &= run("Git diff 格式", ["git", "diff", "--check"], ROOT, env)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
