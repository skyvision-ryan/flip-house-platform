#!/bin/bash
# Run a relevant quick check after Claude edits business code.
source "$(dirname "$0")/common.sh"

PAYLOAD=$(cat)
FILE=$(json_get "$PAYLOAD" tool_input.file_path)
[ -z "$FILE" ] && exit 0
REL=$(relative_path "$FILE")

case "$REL" in
  backend/*.py|backend/**/*.py)
    PY="$PROJ/backend/.venv/bin/python"
    if [ ! -x "$PY" ]; then
      printf '未运行后端回归：backend/.venv 不存在。按 README 准备环境。\n' >&2
      exit 0
    fi
    OUT=$(cd "$PROJ/backend" && "$PY" -m unittest discover -s tests 2>&1)
    [ $? -eq 0 ] && exit 0
    printf '修改 %s 后后端回归失败：\n%s\n' "$REL" "$(printf '%s' "$OUT" | tail -40)" >&2
    exit 2
    ;;
  frontend/*.ts|frontend/*.tsx|frontend/**/*.ts|frontend/**/*.tsx)
    if [ ! -d "$PROJ/frontend/node_modules" ]; then
      printf '未运行前端检查：frontend/node_modules 不存在。按 README 运行 npm ci。\n' >&2
      exit 0
    fi
    NODE22="/opt/homebrew/opt/node@22/bin"
    [ -x "$NODE22/node" ] && PATH="$NODE22:$PATH"
    OUT=$(cd "$PROJ/frontend" && npm run build 2>&1)
    [ $? -eq 0 ] && exit 0
    printf '修改 %s 后前端构建失败：\n%s\n' "$REL" "$(printf '%s' "$OUT" | tail -40)" >&2
    exit 2
    ;;
esac
exit 0
