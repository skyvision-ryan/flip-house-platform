#!/bin/bash
# PostToolUse / Edit|Write|MultiEdit：改完立刻跑对应回归，失败把输出回灌
# 工具链缺失时静默跳过，不制造假失败。
source "$(dirname "$0")/common.sh"

PAYLOAD=$(cat)
FILE=$(json_get "$PAYLOAD" tool_input.file_path)
[ -z "$FILE" ] && exit 0
REL="${FILE#$PROJ/}"

case "$REL" in
  backend/*.py|backend/**/*.py)
    PY="$PROJ/backend/.venv/bin/python"
    [ -x "$PY" ] || exit 0
    [ -d "$PROJ/backend/tests" ] || exit 0
    # 本仓库用 unittest（见 AGENTS.md），不是 pytest
    OUT=$(cd "$PROJ/backend" && "$PY" -m unittest discover -s tests 2>&1)
    [ $? -eq 0 ] && exit 0
    printf '改完 %s 后后端回归失败，先修这个再继续：\n%s\n' "$REL" "$(printf '%s' "$OUT" | tail -40)" >&2
    exit 2
    ;;
  frontend/*.ts|frontend/*.tsx|frontend/**/*.ts|frontend/**/*.tsx)
    command -v npx >/dev/null 2>&1 || exit 0
    [ -d "$PROJ/frontend/node_modules" ] || exit 0
    OUT=$(cd "$PROJ/frontend" && npx --no-install tsc -b 2>&1)
    [ $? -eq 0 ] && exit 0
    printf '改完 %s 后 tsc -b 报错，先修这个再继续：\n%s\n' "$REL" "$(printf '%s' "$OUT" | tail -40)" >&2
    exit 2
    ;;
esac
exit 0
