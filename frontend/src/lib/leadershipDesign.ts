import type { RoleDesign } from './roleDesigns';
import type { UserBrief } from '../api/client';
export type LeadershipPersona = 'david' | 'admin';
export interface LeadershipAnalysis {
  id: string; label: string; recorded_at: string; current: boolean; missing: string[];
  assumptions: { label: string; value: string; source: string }[];
  outputs: { total_profit: number; purchase_total: number; rehab_total: number; holding_total: number; selling_total: number; total_costs: number; cash_invested: number; roi_pct: number | null; sale_price: number } | null;
}
export interface LeadershipTask {
  id: string; title: string; owner: string; status: 'todo' | 'doing' | 'waiting' | 'review' | 'done' | 'na';
  due_date: string | null; submitted_at: string | null; wait_reason: string | null; waiting_for: string | null;
}
export interface LeadershipProject {
  id: string; name: string; stage: string; lifecycle: 'lead' | 'active' | 'closed';
  purchase_price: number | null; target_arv: number | null; budget: number | null; expenses: number | null;
  purchase_date: string | null; sale_date: string | null; sale_price: number | null; planned_end: string | null;
  financial_updated_at: string; coordinator: string; concern: string; next_action: string;
  issues: ('data' | 'progress' | 'settlement')[];
  gate: { title: string; prerequisite_met: boolean; d: boolean; j: boolean; detail: string };
  tasks: LeadershipTask[]; analyses: LeadershipAnalysis[];
  documents: { id: string; name: string; detail: string; source: string }[];
  updates: { date: string; title: string; detail: string }[];
}
export interface LeadershipPreview {
  kind: 'leadership'; person: UserBrief; role_title: string; role_description: string;
  designs: RoleDesign[]; default_design: 'A' | 'B' | 'C'; as_of: string; projects: LeadershipProject[];
}
export const leadershipMoney = (value: number | null) => value == null ? '资料未齐' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
export function currentAnalysis(p: LeadershipProject) { const current = p.analyses.filter(a => a.current); return current.length === 1 ? current[0] : null; }
export function investedScale(p: LeadershipProject): number | null {
  return p.lifecycle === 'lead' || p.purchase_price == null || p.expenses == null ? null : Math.round((p.purchase_price + p.expenses) * 100) / 100;
}
function dayStamp(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const stamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value ? stamp : null;
}
export function dayDifference(start: string | null, end: string | null): number | null {
  const a = dayStamp(start), b = dayStamp(end);
  return a == null || b == null || b < a ? null : Math.floor((b - a) / 86400000);
}
export function holdingDays(p: LeadershipProject, asOf: string) {
  return p.lifecycle === 'lead' ? null : dayDifference(p.purchase_date, p.lifecycle === 'closed' ? p.sale_date : asOf);
}
export function overdueTasks(p: LeadershipProject, asOf: string) {
  if (dayStamp(asOf) == null) return [];
  return p.tasks.filter(t => !['done', 'na'].includes(t.status) && t.due_date != null && dayStamp(t.due_date) != null && t.due_date < asOf);
}
export function reviewAge(t: LeadershipTask, asOf: string) {
  return t.status === 'review' ? dayDifference(t.submitted_at?.slice(0, 10) ?? null, asOf) : null;
}
export function leadershipTotals(projects: LeadershipProject[], asOf: string) {
  const unique = [...new Map(projects.map(p => [p.id, p])).values()];
  const active = unique.filter(p => p.lifecycle === 'active');
  const modeled = active.filter(p => currentAnalysis(p)?.outputs && !currentAnalysis(p)!.missing.length);
  const invested = active.filter(p => investedScale(p) != null);
  return {
    active: active.length, modeled: modeled.length, investedKnown: invested.length,
    modelProfit: modeled.reduce((sum,p) => sum + currentAnalysis(p)!.outputs!.total_profit,0),
    invested: invested.reduce((sum,p) => sum + investedScale(p)!,0),
    overdue: active.reduce((sum,p) => sum + overdueTasks(p,asOf).length,0),
    review: active.reduce((sum,p) => sum + p.tasks.filter(t=>t.status==='review').length,0),
    closed: unique.filter(p=>p.lifecycle==='closed').length,
  };
}
