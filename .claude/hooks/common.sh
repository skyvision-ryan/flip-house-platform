#!/bin/bash
# JIRA 驱动流程 · hook 公用函数
# 本机没有 jq，hook 的 stdin JSON 一律用 python3 解析。
# node@20 是 keg-only，前端命令需要这个 PATH。
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"

PROJ="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
STATE_DIR="$PROJ/.claude/state"
TICKET_RE='KAN-[0-9]+'

# json_get <payload> <a.b.c> —— 取不到就返回空串，不报错
json_get() {
  python3 -c '
import json, sys
try:
    cur = json.loads(sys.argv[1] or "{}")
except Exception:
    print(""); raise SystemExit
for key in sys.argv[2].split("."):
    cur = cur.get(key) if isinstance(cur, dict) else None
    if cur is None:
        break
print(cur if isinstance(cur, str) else ("" if cur is None else json.dumps(cur, ensure_ascii=False)))
' "$1" "$2" 2>/dev/null
}

git_branch() { git -C "$PROJ" rev-parse --abbrev-ref HEAD 2>/dev/null; }

# 当前 ticket：state 文件优先，否则从分支名解析
active_ticket() {
  if [ -s "$STATE_DIR/active-ticket" ]; then
    head -n1 "$STATE_DIR/active-ticket" | tr -d '[:space:]'
    return
  fi
  git_branch | grep -oE "$TICKET_RE" | head -n1
}

on_protected_branch() {
  case "$(git_branch)" in main|master) return 0 ;; *) return 1 ;; esac
}

bypass_on() { [ "${KAN_BYPASS:-}" = "1" ]; }

# 逃生口一律留痕，避免变成常态
log_bypass() {
  mkdir -p "$STATE_DIR"
  printf '%s\t%s\t%s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$(git_branch)" "$1" >> "$STATE_DIR/bypass.log"
}

# exit 2 = 阻断动作，stderr 回灌给模型
deny() { printf '%s\n' "$1" >&2; exit 2; }
