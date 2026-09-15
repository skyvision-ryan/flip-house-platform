---
description: 把当前发现的缺陷整理成带复现步骤和验收标准的 bug 单并建到 JIRA（自动建，不打断当前单）
argument-hint: 一句话现象，例如「水电接口明文返回密码且无鉴权」
allowed-tools: Bash, Read, Glob, Grep
---

把这个发现整理成 bug 单：$ARGUMENTS

## 1. 先核实，再写单
不要把推断写成事实。必须区分并在单里写明核实方式：
- 读代码看到的（给出 `文件:行号`）
- 跑接口/测试看到的（给出命令与输出）
- 只是怀疑的（标明「疑似」+ 置信度）

不能核实的部分写进「疑似根因」，不要写进「实际」。

## 2. 查重（必做）
建单前用 JQL 查同类单，避免刷垃圾单：

`project = KAN AND issuetype = Bug AND statusCategory != Done AND (summary ~ "<关键词>" OR description ~ "<关键词>")`

命中已有单 → **不建新单**，改为在那张单上加一条评论（补充这次的证据与复现），然后告诉我单号。

## 3. 按模板写
用 @.claude/templates/ticket-bug.md 的全部字段。重点两项：
- **复现步骤**：可原样粘贴执行的命令
- **修复验收标准**：命令 + 期望输出。能落成 unittest 用例的，直接写出用例名（如 `tests.test_utilities_auth.UtilitiesAuthTests.test_password_hidden_without_permission`）

优先级按 @docs/工程流程_JIRA驱动.md 的定义选，并写一句理由。

## 4. 建单 + 建关系
- 用 atlassian MCP 建 Bug（工具名以 `/mcp` 实际列出的为准；不可用时 `python3 scripts/jira.py create ...`）
- 建完立刻建 issue link：默认 `relates to` 当前单；**只有在它确实挡住当前单时**才用 `blocks`
- 新单默认落 backlog 末尾（Jira REST 不能写 rank，排序由人在看板上拖）

建单前把将要提交的标题、优先级、验收标准打印给我看——自动建单不等于不给我看。

## 5. 按打断规则处置（关键）
- **不阻塞当前单** → 建完就回到当前单继续做，**不要就地修**。明确告诉我：已建 KAN-n，进 backlog，继续 KAN-m
- **阻塞当前单** → 停下来，说明阻塞关系，问我是「先修新单」还是「当前单挂 Blocked」

这条规则就是「严格按 ticket 顺序」的实际含义：发现不丢，但顺序不乱。
