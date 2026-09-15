---
description: 按 backlog rank 取下一张未完成的单并开工（检查 DoR → 建分支 → 转 In Progress）
argument-hint: 无参数
allowed-tools: Bash, Read, Glob, Grep
---

按 backlog rank 取下一张单开工。严格按下面顺序，不要自选顺序、不要跳单。

## 1. 取单
顺序**不是**纯 backlog rank。按下面的优先级判断（依据 @docs/Jira执行清单_2026-09-15.md）：

1. 只取**执行单**（issuetype 为 故事 或 任务，且挂在 Epic 之下），不取 Epic（KAN-35/36/37 是交付目标，整体验收，不直接开发；KAN-10 是历史归档 Epic）
2. 跳过被阻塞的票（`is blocked by` 里还有未完成的）、已在 In Review 的票、别人经办的进行中票
3. 在可执行的票里，按执行清单给出的交付顺序与目标日期取最靠前的一张（当前安排：KAN-20 → KAN-21 → KAN-27 → 28 → 29/30/31 → 32/33 → 34）
4. 执行清单与 Jira 实际状态不一致时，**以 Jira 实际状态为准**，并在回复里指出不一致

查询用 atlassian MCP（工具名以 `/mcp` 实际列出的为准）；MCP 不可用时 `python3 scripts/jira.py search "<JQL>"`。
参考 JQL：`project = KAN AND issuetype in (故事, 任务) AND parent in (KAN-35, KAN-36, KAN-37) AND statusCategory != Done ORDER BY key ASC`

阻塞关系已经是 Jira 原生 `is blocked by` 链接，直接查 `issuelinks`，不要再去读文档里的前置表。

## 2. 检查 Definition of Ready
对照 @.claude/templates/ticket-story.md，确认这张单有：背景 / 范围 / 明确不做 / 可验证的验收标准 / 影响文件 / 依赖 / 风险。

- **齐了** → 进第 3 步
- **缺项** → 不要开工。把缺什么列出来，按模板补出建议内容，问我是否写回 JIRA；我确认后用 MCP 更新描述，再继续
- **验收标准不可验证**（例如写着「优化一下体验」）→ 同样当作缺项处理，先改成命令 + 期望输出

## 3. 检查依赖
看这张单的 `is blocked by` 关系。有未 Done 的阻塞单 → 停下，报告阻塞链，并问我是否改做那张阻塞单。不要绕过阻塞硬做。

## 4. 开工
```bash
git fetch origin --quiet
git checkout -b KAN-<n>-<英文短横线小结> origin/main
git branch --unset-upstream
printf 'KAN-<n>\n' > .claude/state/active-ticket
```
分支名里的 slug 用 3-4 个英文词概括这张单，不要用中文。

## 5. 转状态并回写
- 把单转成 In Progress（MCP transition）
- 在单上加一条评论：开工时间、分支名、实施计划要点（3-5 条）

## 6. 输出实施计划
按这张单的验收标准倒推要改哪些文件，列出计划让我确认后再动手。计划里必须写明「本单不做什么」，防止范围漂移。
