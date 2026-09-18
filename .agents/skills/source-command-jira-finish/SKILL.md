---
name: "source-command-jira-finish"
description: "验收、提交并把当前执行单送入评审"
---

# source-command-jira-finish

Use this skill when the user asks to run the migrated source command `jira-finish`.

## Command Template

从当前 Git 分支解析 KAN-编号，并读取 Jira 验收标准。

1. 逐条运行可执行证据；记录实际命令、关键输出和未验证项。设备或云环境没有实测时必须标明。
2. 运行相关测试，业务代码默认执行 `python3 scripts/check_local.py`。检查 `git diff --check` 和改动范围。
3. 只暂存本票文件，禁止 `git add -A` 混入他人内容。提交标题以当前 KAN-编号开头。
4. 使用 .Codex/templates/pr-body.md 创建 PR，显式指定 `skyvision-ryan/flip-house-platform`。
5. PR 创建成功后转 In Review，并将 PR、逐条证据与未验证项评论到 Jira。默认不自行合入 main；合入且票内验收完成后才转 Done。
