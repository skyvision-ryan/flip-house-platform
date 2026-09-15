# <KAN-n> <一句话标题>

## 背景
为什么现在要做。指向证据：审计条目编号（如 P0-05）、文件行号、客户评审备注日期。

## 范围
- 要做的第 1 件事
- 要做的第 2 件事

## 明确不做
- 本单不碰的东西（避免范围漂移；这些应另开单）

## 验收标准
每条必须是「命令 + 期望输出」或「接口 + 期望响应」，能被别人原样复跑。
1. `cd backend && ./.venv/bin/python -m unittest tests.test_xxx.XxxTests.test_yyy` → 通过
2. `curl -s localhost:8000/api/...` → 返回中 `字段` 为 `值`
3. `cd frontend && npx tsc -b` → 零错误

## 影响文件
- `backend/app/xxx.py:NN`
- `frontend/src/xxx.tsx:NN`

## 依赖
- 阻塞本单的：KAN-n
- 本单阻塞的：KAN-n
- 需要业务确认的：审计 §10 第 n 条

## 风险
做错会怎样、怎么回退。
