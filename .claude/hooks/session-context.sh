#!/bin/bash
# SessionStart（full）与 UserPromptSubmit（brief）：把当前 ticket 和流程红线注入上下文
# stdout 会成为模型的上下文，所以 brief 模式必须短。
source "$(dirname "$0")/common.sh"
MODE="${1:-brief}"
TICKET=$(active_ticket)
BRANCH=$(git_branch)

if [ -z "$TICKET" ]; then
  printf '【JIRA 流程】当前没有进行中的 ticket（分支 %s）。改 backend/ 或 frontend/ 会被拦；先 /jira:next 按 backlog rank 取单，或 /jira:start <KAN-n>。\n' "$BRANCH"
else
  printf '【JIRA 流程】当前 ticket：%s（分支 %s）。只做这张单范围内的事；范围外的发现用 /jira:bug（缺陷，自动建单）或 /jira:finding（需求/架构，出草稿待确认），不要就地做。\n' "$TICKET" "$BRANCH"
fi

[ "$MODE" != "full" ] && exit 0

cat <<'TXT'

【红线】一张 ticket = 一个分支 = 一个 PR，不混改；提交主题必须是 "KAN-<n> 一句话"；完成前逐条对验收标准附证据。
【本机命令】
  后端： cd backend && ./.venv/bin/uvicorn app.main:app --reload --port 8000
  后端回归： cd backend && ./.venv/bin/python -m unittest discover -s tests
  前端： export PATH="/opt/homebrew/opt/node@20/bin:$PATH" && cd frontend && npm run dev
  前端类型检查： cd frontend && npx tsc -b
【流程手册】docs/工程流程_JIRA驱动.md
TXT
exit 0
