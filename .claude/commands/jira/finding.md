---
description: 记录非缺陷的新发现（需求 / 范围变更 / 架构决策），只出草稿不建单
argument-hint: 一句话，例如「采购清单缺供应商与交期字段」
allowed-tools: Read, Glob, Grep, Bash
---

整理这个发现，**只出草稿，不要建单**：$ARGUMENTS

## 为什么不自动建
需求、范围变更和架构决策会改变产品方向，必须由人决定，不能由我单方面写进 backlog。缺陷才自动建单。

## 输出
按 @.claude/templates/ticket-story.md 出一份草稿，并额外回答 CLAUDE.md §18 的产品透镜里最关键的五问：
1. 用户是谁、要做什么决策
2. 处在翻房生命周期的哪一段
3. 需要什么数据、数据从哪来
4. 是否已有产品/API 解决（该 build / buy / integrate）
5. 最小有用版本是什么、怎么衡量它创造了价值

答不上来的标成「discovery 项」，不要伪装成已定义需求（CLAUDE.md §18 的要求）。

## 然后
把草稿给我，问我三个选项：
- 建成 story 进 backlog
- 只记进 `docs/` 的开放问题清单
- 丢掉

我确认后再动手。
