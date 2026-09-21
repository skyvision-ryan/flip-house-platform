#!/bin/bash
# Block direct business-code edits on protected or ticket-less branches.
source "$(dirname "$0")/common.sh"

PAYLOAD=$(cat)
FILE=$(json_get "$PAYLOAD" tool_input.file_path)
[ -z "$FILE" ] && FILE=$(json_get "$PAYLOAD" tool_input.notebook_path)
[ -z "$FILE" ] && exit 0

REL=$(relative_path "$FILE")
case "$REL" in backend/*|frontend/*) ;; *) exit 0 ;; esac

if bypass_on; then
  log_bypass "write $REL"
  printf 'KAN_BYPASS=1：已放行 %s 并留痕。\n' "$REL"
  exit 0
fi

BRANCH=$(git_branch)
on_protected_branch && deny "当前在 $BRANCH，不能直接改 $REL。先从实际 Jira 执行单建立分支。"
[ -z "$(active_ticket)" ] && deny "分支 $BRANCH 没有 KAN-编号，不能改业务代码 $REL。文档和开发工具不受此限制。"
exit 0
