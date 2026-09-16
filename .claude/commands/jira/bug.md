---
description: 核实、查重并记录当前发现的缺陷
argument-hint: 一句话现象
---

处理缺陷：$ARGUMENTS

先用代码位置、可复现操作或测试确认事实，推测放在“疑似原因”。在项目全部未完成票中按关键词查重，不假定 Jira 一定配置了 Bug 类型。

命中已有票就补充证据，不建重复票。未命中时使用项目实际支持的缺陷类型；若无 Bug，则建“任务”并加 bug 标签。按 .claude/templates/ticket-bug.md 保持简洁，并关联当前票。只有确实阻止当前验收时才建 blocks，否则 relates to 后继续当前工作。
