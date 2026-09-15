# <KAN-n> [BUG] <一句话现象>

## 环境
- 分支 / 提交：`<branch>` @ `<sha>`
- 运行方式：本机 `uvicorn app.main:app --port 8000` / 部署环境
- 发现时正在做：KAN-n

## 复现步骤
可以原样粘贴执行的命令，不要写「点一下那个按钮」。
```bash
1. cd backend && ./.venv/bin/uvicorn app.main:app --port 8000
2. curl -s "http://localhost:8000/api/projects/1/utilities"
```

## 期望
应该发生什么（引用流程文档或审计条目）。

## 实际
实际发生了什么，贴原始输出（去掉真实敏感值）。

## 证据
- 代码位置：`backend/app/routers/ops.py:27`
- 相关审计条目：P0-05
- 已核实方式：读代码 / 跑接口 / 跑测试（写明哪种，别把推断写成事实）

## 影响面
谁受影响、哪些数据、是否已经上线（`origin/main` 是 autoDeploy）。

## 疑似根因
一句话 + 置信度（高 / 中 / 低）。不确定就写不确定，不要猜成结论。

## 修复验收标准
1. 新增测试：`./.venv/bin/python -m unittest tests.test_xxx.XxxTests.test_yyy` → 通过
2. 回归：`python -m unittest discover -s tests` 全绿、`npx tsc -b` 零错
3. 手工核对：`curl ...` → 不再返回 `password` 字段

## 优先级
Highest（数据泄露 / 资金口径错误 / 演示撒谎）· High（阻塞当前单）· Medium（结构债）· Low（体验）
→ 选一个，并写一句理由。

## 依赖
- 是否阻塞当前单：是 / 否（决定就地修还是进 backlog）
- 关联：relates to KAN-n / blocks KAN-n
