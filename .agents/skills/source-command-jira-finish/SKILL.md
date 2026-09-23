---
name: "source-command-jira-finish"
description: "验收、提交并把当前执行单送入评审"
---

# source-command-jira-finish

Use this skill when the user asks to run the source command `jira-finish`.

这是薄入口，不复制流程。执行时：

1. 读取并按 `.claude/commands/jira/finish.md` 的步骤执行（相对仓库根目录）。
2. 规则来源是 `docs/仓库与协作约定.md`「执行单边界与需求变更」一节：提 PR 前做范围核对，没有依据的改动标「待确认」。
3. PR 正文模板是 `.claude/templates/pr-body.md`（含范围核对表与本票关闭 / 后续集成两张验收表）。

以上路径若不存在，停止并报告，不凭记忆复述旧流程。
