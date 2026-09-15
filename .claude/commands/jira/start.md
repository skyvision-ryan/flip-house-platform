---
description: 指定 ticket 开工（跳过取单，其余同 /jira:next）
argument-hint: KAN-16
allowed-tools: Bash, Read, Glob, Grep
---

对 $1 开工。流程与 @.claude/commands/jira/next.md 的第 2–6 步完全一致：先读单、查 DoR、查依赖，再建分支、转 In Progress、写 `.claude/state/active-ticket`、输出实施计划。

额外检查：$1 如果不在 backlog rank 的最前面，先说明它排在第几、前面还有哪些未完成的单，并问我为什么要插队（口头确认即可，但要留在对话里）。这是「严格按顺序」的唯一例外入口。
