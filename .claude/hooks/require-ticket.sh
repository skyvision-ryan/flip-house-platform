#!/bin/bash
# PreToolUse / Edit|Write|MultiEdit：无 ticket 不改业务代码
# 受保护：backend/ frontend/    白名单：docs/ .claude/ README.md .github/ .githooks/ scripts/
source "$(dirname "$0")/common.sh"

PAYLOAD=$(cat)
FILE=$(json_get "$PAYLOAD" tool_input.file_path)
[ -z "$FILE" ] && FILE=$(json_get "$PAYLOAD" tool_input.notebook_path)
[ -z "$FILE" ] && exit 0

REL="${FILE#$PROJ/}"
case "$REL" in
  backend/*|frontend/*) ;;                 # 受保护
  *) exit 0 ;;                             # 其余（含白名单）直接放行
esac

TICKET=$(active_ticket)

if bypass_on; then
  log_bypass "KAN_BYPASS 放行写入：${REL}"
  printf '%s\n' "⚠ KAN_BYPASS=1 已放行对 $REL 的写入，已记入 bypass.log。"
  exit 0
fi

on_protected_branch && deny "当前在 $(git_branch) 分支，不能改 ${REL}。先 /jira:next 取单（按 backlog rank）或 /jira:start <KAN-n>，会自动切到 ticket 分支。"
[ -z "$TICKET" ] && deny "当前没有进行中的 ticket（分支名里没有 KAN-<n>，.claude/state/active-ticket 也是空的），不能改业务代码 ${REL}。先 /jira:next 或 /jira:start <KAN-n>。文档、流程配置不受此限制。"
exit 0
