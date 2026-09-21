#!/usr/bin/env python3
"""PR 合入后回写 Jira 状态（KAN-40）。由 .github/workflows/jira-on-merge.yml 调用。

这个文件只负责 I/O：读环境变量、调 Jira REST API、打 GitHub 注解。
**所有判断都在 jira_merge_decision.py**，那边是纯函数、有单测。这边刻意不做任何决策，
这样「该不该标 Done」这件事永远只有一个出处。

只用标准库（urllib），不给 CI 加依赖。

退出码：0 = 做完了或按规则跳过；1 = 真出错（读不到票、转换不存在、API 失败）。
"""

from __future__ import annotations

import base64
import json
import os
import sys
import urllib.error
import urllib.request

from jira_merge_decision import comment_adf, decide, pick_transition, ticket_of

TIMEOUT = 30


def notice(title: str, message: str) -> None:
    print(f"::notice title={title}::{message}")


def fail(title: str, message: str) -> int:
    print(f"::error title={title}::{message}", file=sys.stderr)
    return 1


class Jira:
    def __init__(self, base_url: str, email: str, token: str) -> None:
        self.base = base_url.rstrip("/")
        raw = f"{email}:{token}".encode()
        self.auth = "Basic " + base64.b64encode(raw).decode()

    def call(self, method: str, path: str, payload: dict | None = None) -> tuple[int, dict | None]:
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(f"{self.base}/rest/api/3{path}", data=data, method=method)
        req.add_header("Authorization", self.auth)
        req.add_header("Accept", "application/json")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                body = resp.read().decode() or ""
                return resp.status, (json.loads(body) if body.strip() else None)
        except urllib.error.HTTPError as exc:
            body = exc.read().decode(errors="replace")
            # 出错正文可能很长且含无关字段，截断即可定位问题
            return exc.code, {"error": body[:400]}
        except urllib.error.URLError as exc:
            return 0, {"error": str(exc.reason)}


def main() -> int:
    env = os.environ
    key = ticket_of(env.get("PR_BRANCH"), env.get("PR_TITLE"))
    if not key:
        notice("跳过", "分支名和标题里都没有 KAN 票号。")
        return 0

    base_url, email, token = env.get("JIRA_BASE_URL"), env.get("JIRA_EMAIL"), env.get("JIRA_API_TOKEN")
    if not (base_url and email and token):
        notice("跳过 Jira 回写",
               f"缺少 JIRA_BASE_URL / JIRA_EMAIL / JIRA_API_TOKEN 之一，{key} 的状态没有改。"
               "加上 secret 后下次合入即生效。")
        return 0

    jira = Jira(base_url, email, token)

    status, data = jira.call("GET", f"/issue/{key}?fields=status")
    if status != 200 or not data:
        return fail(f"读不到 {key}", f"HTTP {status} {(data or {}).get('error', '')}")
    current = data["fields"]["status"]["name"]
    print(f"{key} 当前状态：{current}")

    plan = decide(env.get("PR_BODY"), current)
    if plan["action"] == "skip":
        notice(f"{key} 不需要动", plan["reason"])
        return 0
    target = plan["target"]

    status, data = jira.call("GET", f"/issue/{key}/transitions")
    if status != 200 or not data:
        return fail(f"读不到 {key} 的可用转换", f"HTTP {status} {(data or {}).get('error', '')}")
    transitions = data.get("transitions", [])
    tid = pick_transition(transitions, target)
    if not tid:
        avail = "、".join((t.get("to") or {}).get("name", "?") for t in transitions)
        return fail(f"{key} 没有通往「{target}」的转换", f"可用的是：{avail}")

    status, data = jira.call("POST", f"/issue/{key}/transitions", {"transition": {"id": tid}})
    if status != 204:
        return fail(f"{key} 转「{target}」失败", f"HTTP {status} {(data or {}).get('error', '')}")

    text = (
        f"PR [#{env.get('PR_NUM', '?')}|{env.get('PR_URL', '')}] 已合入 main"
        f"（{env.get('PR_TITLE', '')}，commit {(env.get('MERGE_SHA') or '')[:7]}）。\n"
        "\n"
        f"状态：{current} → {target}。{plan['reason']}\n"
        "\n"
        "本条由 .github/workflows/jira-on-merge.yml 自动写入。判据是 PR 正文的验收表，"
        "逻辑在 scripts/jira_merge_decision.py。"
    )
    status, data = jira.call("POST", f"/issue/{key}/comment", comment_adf(text))
    if status != 201:
        # 状态已经改成功了，评论没写进去不该让整个 job 变红
        print(f"::warning title={key} 评论没写进去::HTTP {status}（状态已经改成 {target}）")

    notice(f"{key} 已更新", f"{current} → {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
