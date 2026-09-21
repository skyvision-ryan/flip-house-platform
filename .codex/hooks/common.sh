#!/bin/bash
# Claude hooks shared helpers. These are guardrails, not a security boundary.

PROJ_RAW="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
PROJ="$(cd "$PROJ_RAW" 2>/dev/null && pwd -P)"
STATE_DIR="$PROJ/.claude/state"
TICKET_RE='KAN-[0-9]+'

json_get() {
  python3 -c '
import json, sys
try:
    cur = json.loads(sys.argv[1] or "{}")
except Exception:
    print(""); raise SystemExit
for key in sys.argv[2].split("."):
    cur = cur.get(key) if isinstance(cur, dict) else None
    if cur is None: break
print(cur if isinstance(cur, str) else ("" if cur is None else json.dumps(cur, ensure_ascii=False)))
' "$1" "$2" 2>/dev/null
}

git_branch() { git -C "$PROJ" branch --show-current 2>/dev/null; }

# The branch is authoritative. A state file may be stale after checkout.
active_ticket() {
  git_branch | grep -oE "$TICKET_RE" | head -n1
}

relative_path() {
  python3 -c '
from pathlib import Path
import sys
try:
    print(Path(sys.argv[2]).resolve().relative_to(Path(sys.argv[1]).resolve()))
except Exception:
    print("")
' "$PROJ" "$1"
}

on_protected_branch() {
  case "$(git_branch)" in main|master) return 0 ;; *) return 1 ;; esac
}

bypass_on() { [ "${KAN_BYPASS:-}" = "1" ]; }

log_bypass() {
  mkdir -p "$STATE_DIR"
  printf '%s\t%s\t%s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$(git_branch)" "$1" >> "$STATE_DIR/bypass.log"
}

deny() { printf '%s\n' "$1" >&2; exit 2; }
