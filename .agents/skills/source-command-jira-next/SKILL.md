---
name: "source-command-jira-next"
description: "从 Jira 选择下一张可执行单并开始工作"
---

# source-command-jira-next

Use this skill when the user asks to run the source command `jira-next`.

这是薄入口，不复制流程。执行时：

1. 读取并按 `.claude/commands/jira/next.md` 的步骤执行（相对仓库根目录）。
2. 规则来源是 `docs/仓库与协作约定.md`「执行单边界与需求变更」一节：开工前写范围基线、实施中按四类分类、影响范围/行为/迁移/权限/验收/成本/排期的先问用户。
3. 票面模板 `.claude/templates/ticket-story.md`、缺陷模板 `.claude/templates/ticket-bug.md`。

以上路径若不存在，停止并报告，不凭记忆复述旧流程。
