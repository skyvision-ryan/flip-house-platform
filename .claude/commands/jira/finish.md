---
description: 收尾当前单：逐条验收 → 跑回归 → 提交 → 开 PR → 转 In Review
argument-hint: 无参数
allowed-tools: Bash, Read, Glob, Grep
---

收尾当前 ticket（读 `.claude/state/active-ticket`）。任何一步不过就停下，不要硬推到 PR。

## 1. 逐条对验收标准
把单里的验收标准一条条跑出来，每条记录：命令、实际输出摘录、✅/❌。
**有一条没有证据就不算完成**——不要用「应该没问题」代替执行。

## 2. 回归
```bash
cd backend && ./.venv/bin/python -m unittest discover -s tests
cd frontend && export PATH="/opt/homebrew/opt/node@20/bin:$PATH" && npx tsc -b
```
`xfail(strict=True)` 的用例如果因为本单修好了，必须同时取掉 xfail 标记——这是「修好了」的机械证据。

## 3. Definition of Done 自查
- [ ] 验收标准逐条有证据
- [ ] 回归通过
- [ ] 文档同步：README「当前实现」段；如果动了审计条目，更新对照状态
- [ ] 本单过程中的所有新发现都已开单（`/jira:bug` 或 `/jira:finding`），没有留在对话里
- [ ] 没有夹带单外改动（`git diff origin/main --stat` 自己看一遍）

## 4. 提交
```bash
git add -A
git commit -m "KAN-<n> <一句话说明>"
```
正文写：改了什么（按文件分组）、对应哪几条验收标准、顺手开了哪些新单。结尾带 `Co-Authored-By` 行。

## 5. PR
按 @.claude/templates/pr-body.md 生成 PR 正文，然后
```bash
git push -u origin HEAD
gh pr create --title "KAN-<n> <一句话>" --body-file <临时文件>
```
推送和开 PR 前先把 PR 正文给我看一眼。

## 6. 转 In Review 并回写证据
- 单转 In Review
- 在单上加评论：PR 链接 + 验收标准对照表（第 1 步的结果）
- **不要自己合 main**：合入由人做，合入后才转 Done
