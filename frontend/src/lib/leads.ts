import type { Meta, Project } from '../api/client';

/**
 * 线索房的分组规则（KAN-50）。纯函数、不碰 DOM，所以能单测。
 *
 * 「线索房」= **清单当前段停在 s1（① 预买房）**，也就是 `open escrow` 还没被 D+J 双确认。
 * KAN-75 块 2 起界面上叫「买房 · 未购入」：独立线索入口并入项目列表的筛选，判据不变。
 *
 * **判据只认 `current_stage`，不认旧的 `stage` 列。** 理由是一个实测过的陷阱：
 * `Project.stage` 是派生缓存，`sync_legacy_stage`（`backend/app/steps.py:206-212`）
 * 只在 `project_out` 里被调用（`routers/common.py:80-81`），于是
 * `GET /api/projects?stage=lead` 会先按裸列过滤、再走 `project_out`，
 * **可能返回一个自身 payload 已经是 active 的项目**。
 *
 * `current_stage` 是当场算出来的权威值，KAN-65 已经把界面展示统一到它。
 * 线索页和「项目列表移出线索」两侧用同一个判据，才不会两处口径打架。
 *
 * 拿不到 `current_stage` 时回落旧列——和 `stepDisplay.ts` 的 `stageText()` 保持同一套兜底。
 * 在走过 `project_out` 的 payload 里两者等价：`STAGE_TO_LEGACY`（`dictionaries.py:281`）
 * 只有 `s1` 映射到 `lead`。
 */
export const LEAD_STAGE_KEY = 's1';

export function isLead(p: Pick<Project, 'current_stage' | 'stage'>): boolean {
  if (p.current_stage) return p.current_stage.key === LEAD_STAGE_KEY;
  return p.stage === 'lead';
}

export interface LeadGroup {
  /** substage 值，例 'contacting' */
  value: string;
  /** 中文标签，例 '联系卖家' */
  label: string;
  projects: Project[];
}

/** 认不出的子阶段单独一组。**不并进「新线索」**——那会把「不知道在哪一档」说成「刚进来」。 */
export const UNKNOWN_GROUP = { value: '__unknown__', label: '待核实' };

/**
 * 按六个子阶段分组，顺序跟着 `meta.substages.lead` 走。
 *
 * **空组也返回**——管线缺口要看得见（「约看 0 条」本身就是信息）。界面上空组用紧凑标题，
 * 不占一整张卡。
 *
 * 子阶段为空或不在字典里的，进**「待核实」组，且该组只在真有条目时才出现**。
 */
export function groupBySubstage(projects: Project[], meta: Meta | null | undefined): LeadGroup[] {
  const defs = meta?.substages?.lead ?? [];
  if (defs.length === 0) return [];

  const groups: LeadGroup[] = defs.map((d) => ({ value: d.value, label: d.label, projects: [] }));
  const byValue = new Map(groups.map((g) => [g.value, g]));
  const unknown: LeadGroup = { ...UNKNOWN_GROUP, projects: [] };

  for (const p of projects) {
    (byValue.get(p.substage ?? '') ?? unknown).projects.push(p);
  }
  return unknown.projects.length ? [...groups, unknown] : groups;
}

/**
 * **「待办参考」，不是「轮到谁」。** 这个区别要紧。
 *
 * `next_up[0]` 是后端按**模板顺序**取的当前段第一条未完成项（`backend/app/steps.py:188-191`），
 * 判定依据是证据规则——例如「看房」要有照片才算完成。所以一套**已经出价**的房子仍可能
 * 显示「看房」，原因只是照片没上传，**不是业务还没发生**。
 *
 * 把它叫「轮到谁」会把「资料没补齐」说成「事情没做」。这里只说「待办参考」+「负责角色」，
 * 并且明确是**角色**不是具体的人——真正的人员分派要等 KAN-21/KAN-28。
 */
export function nextUpText(p: Pick<Project, 'next_up'>): { task: string; roles: string | null } | null {
  const n = p.next_up?.[0];
  if (!n) return null;
  return { task: n.title, roles: n.owners.length ? n.owners.join('、') : null };
}

/** 热度标签。取值只有 hot_lead / warm_lead（`backend/app/dictionaries.py:38-39`），认不出就不显示。 */
export function heatLabel(p: Pick<Project, 'lead_heat'>): string | null {
  if (p.lead_heat === 'hot_lead') return '热线索';
  if (p.lead_heat === 'warm_lead') return '温线索';
  return null;
}
