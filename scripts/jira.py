#!/usr/bin/env python3
"""JIRA Cloud REST v3 最小封装：atlassian MCP 不可用时的回退实现。

命令层（.claude/commands/jira/*.md）只依赖这里的子命令名，所以换实现不用改流程。

认证（三者都要）：
  JIRA_SITE   例如 https://yourteam.atlassian.net
  JIRA_EMAIL  你的 Atlassian 账号邮箱
  token       ~/.config/jira/token（chmod 600），或环境变量 JIRA_TOKEN

用法：
  jira.py search  'project = KAN AND statusCategory != Done ORDER BY Rank ASC' [--max 20]
  jira.py get     KAN-16
  jira.py create  --type Bug --summary '一句话' --file body.md [--priority Highest] [--parent KAN-1]
  jira.py transitions KAN-16
  jira.py transition  KAN-16 'In Progress'
  jira.py comment KAN-16 --file evidence.md
  jira.py link    KAN-17 blocks KAN-16        # 关系名：blocks / relates
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

TOKEN_FILE = pathlib.Path.home() / ".config" / "jira" / "token"
LINK_TYPES = {"blocks": "Blocks", "relates": "Relates"}


def _auth_header() -> str:
    site = os.environ.get("JIRA_SITE", "").strip().rstrip("/")
    email = os.environ.get("JIRA_EMAIL", "").strip()
    token = os.environ.get("JIRA_TOKEN", "").strip()
    if not token and TOKEN_FILE.exists():
        token = TOKEN_FILE.read_text(encoding="utf-8").strip()
    missing = [n for n, v in (("JIRA_SITE", site), ("JIRA_EMAIL", email), ("token", token)) if not v]
    if missing:
        sys.exit(f"缺少认证信息：{', '.join(missing)}。见 scripts/jira.py 顶部说明。")
    raw = f"{email}:{token}".encode()
    return "Basic " + base64.b64encode(raw).decode()


def _site() -> str:
    return os.environ["JIRA_SITE"].strip().rstrip("/")


def call(method: str, path: str, body: dict | None = None, query: dict | None = None) -> dict:
    url = f"{_site()}{path}"
    if query:
        url += "?" + urllib.parse.urlencode(query)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", _auth_header())
    req.add_header("Accept", "application/json")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            text = resp.read().decode() or "{}"
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:800]
        sys.exit(f"JIRA {method} {path} 失败：HTTP {e.code}\n{detail}")
    except urllib.error.URLError as e:
        sys.exit(f"连不上 JIRA：{e.reason}")
    return json.loads(text) if text.strip() else {}


def adf(text: str) -> dict:
    """纯文本 → ADF。v3 的 description / comment 只接受 ADF，不接受裸字符串。"""
    blocks = []
    for para in text.replace("\r\n", "\n").split("\n\n"):
        para = para.strip("\n")
        if not para:
            continue
        blocks.append({"type": "paragraph",
                       "content": [{"type": "text", "text": para}]})
    if not blocks:
        blocks = [{"type": "paragraph", "content": []}]
    return {"type": "doc", "version": 1, "content": blocks}


def _read_body(args) -> str:
    if getattr(args, "file", None):
        return pathlib.Path(args.file).read_text(encoding="utf-8")
    if getattr(args, "text", None):
        return args.text
    if not sys.stdin.isatty():
        return sys.stdin.read()
    sys.exit("需要正文：用 --file 或 --text，或从 stdin 传入。")


def cmd_search(args) -> None:
    fields = "summary,status,issuetype,priority,assignee,parent"
    # Jira Cloud 新端点是 /search/jql，老站点仍是 /search；两个都试
    try:
        out = call("GET", "/rest/api/3/search/jql",
                   query={"jql": args.jql, "maxResults": args.max, "fields": fields})
    except SystemExit:
        out = call("GET", "/rest/api/3/search",
                   query={"jql": args.jql, "maxResults": args.max, "fields": fields})
    issues = out.get("issues", [])
    if args.json:
        print(json.dumps(issues, ensure_ascii=False, indent=2))
        return
    if not issues:
        print("（没有匹配的单）")
        return
    for i, it in enumerate(issues, 1):
        f = it.get("fields", {})
        print(f"{i:>2}. {it['key']:<10} [{(f.get('issuetype') or {}).get('name','?'):<7}] "
              f"{(f.get('status') or {}).get('name','?'):<12} "
              f"{(f.get('priority') or {}).get('name','-'):<8} {f.get('summary','')}")
    print(f"\n共 {len(issues)} 张（rank 顺序即上面的顺序）")


def cmd_get(args) -> None:
    out = call("GET", f"/rest/api/3/issue/{args.key}")
    print(json.dumps(out.get("fields", out), ensure_ascii=False, indent=2))


def cmd_create(args) -> None:
    fields: dict = {
        "project": {"key": args.project},
        "summary": args.summary,
        "issuetype": {"name": args.type},
        "description": adf(_read_body(args)),
    }
    if args.priority:
        fields["priority"] = {"name": args.priority}
    if args.parent:
        fields["parent"] = {"key": args.parent}
    out = call("POST", "/rest/api/3/issue", {"fields": fields})
    print(f"已建：{out.get('key')}  {_site()}/browse/{out.get('key')}")


def cmd_transitions(args) -> None:
    out = call("GET", f"/rest/api/3/issue/{args.key}/transitions")
    for t in out.get("transitions", []):
        print(f"{t['id']:<6} {t['name']:<18} → {(t.get('to') or {}).get('name','?')}")


def cmd_transition(args) -> None:
    out = call("GET", f"/rest/api/3/issue/{args.key}/transitions")
    want = args.status.strip().lower()
    hit = next((t for t in out.get("transitions", [])
                if t["name"].strip().lower() == want
                or (t.get("to") or {}).get("name", "").strip().lower() == want), None)
    if not hit:
        names = "、".join(f"{t['name']}→{(t.get('to') or {}).get('name','?')}"
                          for t in out.get("transitions", []))
        sys.exit(f"{args.key} 没有到「{args.status}」的流转。可用：{names or '（无）'}")
    call("POST", f"/rest/api/3/issue/{args.key}/transitions", {"transition": {"id": hit["id"]}})
    print(f"{args.key} → {(hit.get('to') or {}).get('name', args.status)}")


def cmd_comment(args) -> None:
    call("POST", f"/rest/api/3/issue/{args.key}/comment", {"body": adf(_read_body(args))})
    print(f"{args.key} 已加评论")


def cmd_link(args) -> None:
    name = LINK_TYPES.get(args.type.lower())
    if not name:
        sys.exit(f"关系只支持：{'、'.join(LINK_TYPES)}")
    call("POST", "/rest/api/3/issueLink", {
        "type": {"name": name},
        "inwardIssue": {"key": args.source},
        "outwardIssue": {"key": args.target},
    })
    print(f"{args.source} {args.type} {args.target} 已建立")


def main() -> None:
    p = argparse.ArgumentParser(description="JIRA Cloud REST v3 最小封装")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("search"); s.add_argument("jql"); s.add_argument("--max", type=int, default=20)
    s.add_argument("--json", action="store_true"); s.set_defaults(func=cmd_search)

    s = sub.add_parser("get"); s.add_argument("key"); s.set_defaults(func=cmd_get)

    s = sub.add_parser("create")
    s.add_argument("--project", default="KAN"); s.add_argument("--type", required=True)
    s.add_argument("--summary", required=True); s.add_argument("--file"); s.add_argument("--text")
    s.add_argument("--priority"); s.add_argument("--parent"); s.set_defaults(func=cmd_create)

    s = sub.add_parser("transitions"); s.add_argument("key"); s.set_defaults(func=cmd_transitions)

    s = sub.add_parser("transition"); s.add_argument("key"); s.add_argument("status")
    s.set_defaults(func=cmd_transition)

    s = sub.add_parser("comment"); s.add_argument("key"); s.add_argument("--file"); s.add_argument("--text")
    s.set_defaults(func=cmd_comment)

    s = sub.add_parser("link"); s.add_argument("source"); s.add_argument("type")
    s.add_argument("target"); s.set_defaults(func=cmd_link)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
