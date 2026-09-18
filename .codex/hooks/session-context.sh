#!/bin/bash
source "$(dirname "$0")/common.sh"
MODE="${1:-brief}"
BRANCH=$(git_branch)
TICKET=$(active_ticket)
STATE=""
[ -s "$STATE_DIR/active-ticket" ] && STATE=$(head -n1 "$STATE_DIR/active-ticket" | tr -d '[:space:]')

if [ -z "$TICKET" ]; then
  printf '【开发上下文】分支 %s 没有关联执行单；backend/frontend 写入会被拦。用户授权的文档或开发工具整理可继续。\n' "$BRANCH"
else
  printf '【开发上下文】当前 %s（分支 %s）。按票内范围和实际依赖交付。\n' "$TICKET" "$BRANCH"
fi
[ -n "$STATE" ] && [ "$STATE" != "$TICKET" ] && printf '【提示】state 文件中的 %s 已过期，本轮忽略；分支是权威来源。\n' "$STATE"
[ "$MODE" != "full" ] && exit 0

cat <<'TXT'

共同规则：先读 AGENTS.md；一张执行单一个分支/PR；不要从旧审计批量开单。
本地完整检查：python3 scripts/check_local.py
后端：cd backend && ./.venv/bin/python -m unittest discover -s tests
前端：npm --prefix frontend run build
TXT
