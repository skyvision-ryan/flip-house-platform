import type { Meta, UserBrief } from '../api/client';

export type TaskPlan = Record<string, { assignee_user_id: number | null; due_at: string }>;
export type PlanStage = Meta['stage_checklist'][number];

export function summarizePlan(stages: PlanStage[], plan: TaskPlan) {
  const ordinary = stages.flatMap((s) => s.items.filter((i) => !i.gate).map((i) => ({ ...i, stage: s.key })));
  const assigned = ordinary.filter((i) => plan[i.key]?.assignee_user_id != null);
  return {
    total: ordinary.length, assigned: assigned.length, unassigned: ordinary.length - assigned.length,
    current: assigned.filter((i) => i.stage === stages[0]?.key).length,
    future: assigned.filter((i) => i.stage !== stages[0]?.key).length,
    gates: stages.flatMap((s) => s.items.filter((i) => i.gate)).length,
    people: [...new Set(assigned.map((i) => plan[i.key].assignee_user_id!))],
  };
}

/** 按真实账号合并安排说明；这是预览，不是发送回执。 */
export function planByPerson(stages: PlanStage[], plan: TaskPlan, users: UserBrief[]) {
  return summarizePlan(stages, plan).people.map((id) => ({
    user: users.find((u) => u.id === id),
    items: stages.flatMap((s, index) => s.items.filter((i) => !i.gate && plan[i.key]?.assignee_user_id === id)
      .map((i) => ({ title: i.title, stage: s.short, stage_key: s.key, future: index > 0, due: plan[i.key].due_at }))),
  }));
}

export function planPayload(stages: PlanStage[], plan: TaskPlan) {
  return stages.flatMap((s) => s.items.filter((i) => !i.gate && (plan[i.key]?.assignee_user_id != null || plan[i.key]?.due_at))
    .map((i) => ({ step_key: i.key, assignee_user_id: plan[i.key].assignee_user_id, due_at: plan[i.key].due_at || null })));
}
