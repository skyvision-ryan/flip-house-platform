## 关联 ticket
KAN-n

## 改了什么
- 一句话一条，按文件分组

## 验收标准对照
| # | 验收标准 | 结果 | 证据 |
|---|---|---|---|
| 1 | | ✅ / ❌ | 命令 + 输出摘录 |
| 2 | | | |

## 回归
- `cd backend && ./.venv/bin/python -m unittest discover -s tests` → <结果>
- `cd frontend && npx tsc -b` → <结果>

## 顺手发现（已开单，未在本 PR 处理）
- KAN-n <一句话>

## 风险与回退
怎么回退、上线后要观察什么。

## 文档同步
- [ ] README「当前实现」段
- [ ] 审计对照（哪条 P0/P1 从「半改」变成「已改」）

🤖 Generated with [Claude Code](https://claude.com/claude-code)
