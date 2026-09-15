#!/usr/bin/env python3
"""只读检查当前仓库身份与同步状态；不拉取、不切分支、不修改文件。"""
from pathlib import Path
import subprocess
import sys


def git(*args):
    result = subprocess.run(["git", *args], capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else None


def main():
    root = git("rev-parse", "--show-toplevel")
    if not root:
        print("当前目录不是 Git 工作区。请先进入项目文件夹。")
        return 1
    print("项目文件夹：", root)
    print("当前分支：", git("branch", "--show-current") or "未在分支上（detached HEAD）")
    print("当前版本：", git("log", "-1", "--format=%h %s"))
    # Compare known identities without printing potentially credential-bearing URLs.
    for remote, repo in (("origin", "skyvision-ryan/flip-house-platform"),
                         ("upstream", "LianCr/flip-house-platform")):
        value = git("remote", "get-url", remote)
        expected = ("https://github.com/" + repo + ".git", "https://github.com/" + repo,
                    "git@github.com:" + repo + ".git")
        print(remote + "：", repo if value in expected else "未配置或地址与约定不同，请核对")
    counts = git("rev-list", "--left-right", "--count", "origin/main...HEAD")
    if counts:
        missing, extra = counts.split()
        print("与本地记录的 origin/main 相比：缺少 %s 个提交，另有 %s 个提交。" % (missing, extra))
    print("跟踪分支：", git("rev-parse", "--abbrev-ref", "@{upstream}") or "未设置")
    for marker in ("MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"):
        path = git("rev-parse", "--git-path", marker)
        if path and Path(path).exists():
            print("注意：尚有进行中的 Git 操作：", marker)
    print("工作区状态：")
    print(git("-c", "core.quotePath=false", "status", "--short") or "干净，没有未提交改动。")
    print("本检查没有联网。远端可能已经更新；用 git fetch origin 刷新记录后再检查。")
    print("协作规则：docs/仓库与协作约定.md；同一工作区不要同时由两个助手修改。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
