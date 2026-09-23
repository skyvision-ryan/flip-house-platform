export type Option = { value: string; label: string };

export interface Meta {
  demo_mode: boolean;
  strategies: Option[];
  stages: Option[];
  substages: Record<string, Option[]>;
  statuses: (Option & { kind: string })[];
  budget_categories: string[];
  file_types: (Option & { stage: string })[];
  sources: Option[];
  property_fields: { key: string; label: string; type: string }[];
  people: { code: string; label: string; role: string }[];
  roles: { code: string; label: string; tier: string; duties: string }[];
  tiers: Record<string, { label: string; color: string; order: number }>;
  permissions: Record<string, string[]>;
  owner_map: Record<string, string[]>;
  file_default_owner: Record<string, string>;
  stage_checklist: { key: string; label: string; short: string; items: { key: string; title: string; owners: string[]; evidence: string; gate?: boolean; confirm?: string[]; deliverable?: Deliverable }[] }[];
  permit_rule: { need: string[]; no_need: string[] };
  utility_kinds: Option[];
  utility_statuses: Option[];
  inspection_results: Option[];
  dashboard_layouts: Record<string, string[]>;
  widget_access: Record<string, string[]>;
  procurement_waves: Option[];
  procurement_statuses: Option[];
  task_exec_statuses?: (Option & { kind: string })[];
  task_event_kinds?: Record<string, string>;
}

export interface Deliverable { kind: 'file' | 'photo' | 'field' | 'record' | 'confirm' | 'tick'; label: string; doc_type?: string | null; field?: string | null; record?: string | null }
export interface StepItem {
  key: string; title: string; owners: string[]; gate: boolean; confirm: string[]; confirmed: string[]; done: boolean; how: 'auto' | 'manual' | 'manual_override' | null;
  deliverable: Deliverable | null; evidence_hint: string | null;
  evidence: string | null; can_auto: boolean; done_by: string | null; done_at: string | null; note: string | null;
  /** 属于哪条工作线；这件事是干嘛的；后端认为怎样才算完成。由后端透传，没有就不显示。 */
  ws?: string; purpose?: string; done_when?: string;
}
export interface StageProgress {
  key: string; label: string; short: string; done: number; total: number; gate_title: string | null; gate_done: boolean; gate_confirmed: string[]; gate_at: string | null;
  gates?: { key: string; title: string; done: boolean; confirmed: string[]; at: string | null }[];
}
export interface Steps {
  stages: { key: string; label: string; short: string; desc?: string | null; items: StepItem[]; done_count: number; total: number; gate_title: string | null; gate_done: boolean; gate_confirmed: string[]; gate_at: string | null }[];
  current_stage: { key: string; label: string; index?: number };
  next_up: { key: string; title: string; owners: string[]; gate: boolean }[];
  earlier_undone: { key: string; title: string; owners: string[]; stage: string }[];
  stage_progress: StageProgress[];
}
export interface Update { id: number; project_id: number; project_name: string | null; actor: string; kind: string; text: string; created_at: string }

export interface AddressCandidate {
  label: string; street: string; city: string; state: string; zip: string; lat?: number | null; lng?: number | null;
}

export interface LookupField {
  field: string; label: string; value: string | null; source: string; confidence?: number | null; note?: string | null;
}

export interface LookupResult {
  address: AddressCandidate;
  apn: string | null;
  fields: LookupField[];
  owner: Record<string, any> | null;
  mortgages: Record<string, any>[];
  sales_history: Record<string, any>[];
  provider: string;
  valuation: { avm_value?: number | null; avm_low?: number | null; avm_high?: number | null; list_price?: number | null; annual_tax?: number | null } | null;
  duplicate_of: { project_id: number; project_name: string; property_id: number } | null;
}

export interface PropertyBrief {
  id: number; address_std: string; street?: string | null; city?: string | null; state?: string | null; zip?: string | null;
  lat?: number | null; lng?: number | null; apn?: string | null; property_type?: string | null; style?: string | null;
  year_built?: number | null; sqft?: number | null; beds?: number | null; baths_full?: number | null; baths_half?: number | null;
  stories?: number | null; garage_spaces?: number | null; basement?: string | null; lot_sqft?: number | null; land_use?: string | null;
  avm_value?: number | null; list_price?: number | null; annual_tax?: number | null;
}

export interface Project {
  id: number; name: string; strategy: string; stage: string; substage: string | null; lead_heat: string | null;
  status: string; status_reason: string; status_override: string | null; status_override_reason: string | null;
  purchase_price: number | null; target_arv: number | null; purchase_date: string | null; construction_start: string | null;
  construction_end: string | null; list_date: string | null; sale_date: string | null; sale_price: number | null;
  risks: string | null; notes: string | null; created_at: string; updated_at: string; property: PropertyBrief;
  budget_planned: number | null; budget_spent: number | null; budget_used_pct: number | null; money_hidden: boolean; missing_fields: string[]; analysis_count: number;
  current_stage: { key: string; label: string } | null; next_up: { key: string; title: string; owners: string[]; gate: boolean }[];
  stage_progress: StageProgress[]; earlier_undone_count: number;
}

export interface SourceRec {
  id: number; field: string; value: string | null; source: string; fetched_at: string; confidence: number | null; is_primary: boolean; note: string | null;
}

export interface PropertyField {
  key: string; label: string; type: string; value: string | null; primary_source: string | null; sources: SourceRec[]; has_conflict: boolean;
}

export interface PropertyData {
  property: PropertyBrief;
  fields: PropertyField[];
  owner: { name?: string | null; mailing_address?: string | null; phone?: string | null; email?: string | null; owner_since?: string | null } | null;
  mortgages: { id: number; recording_date?: string | null; lender?: string | null; loan_type?: string | null; term_months?: number | null; original_balance?: number | null; est_balance?: number | null; rate?: number | null; payment?: number | null }[];
  sales_history: { id: number; recording_date?: string | null; seller?: string | null; buyer?: string | null; doc_type?: string | null; amount?: number | null }[];
}

export interface ProjectFile {
  id: number; project_id: number; filename: string; mime: string | null; size: number; doc_type: string | null; stage: string | null;
  doc_date: string | null; counterparty: string | null; amount: number | null; source: string; uploaded_by: string | null; step_key: string | null; expires_at: string | null; uploaded_at: string;
}
/** 文件列表行；和 ProjectFile 同一个东西，给按“附件”读它的地方用。 */
export type FileRow = ProjectFile;

export interface Utility {
  id: number; project_id: number; kind: string; company: string | null; account_no: string | null; login: string | null; password: string | null;
  website: string | null;
  opened_under: string | null; status: string; blocker: string | null; updated_by: string | null; updated_at: string;
}
export interface UtilityIn { company: string | null; website: string | null; account_no: string | null; login: string | null; password: string | null; opened_under: string | null; status: string; blocker: string | null }
export interface Inspection {
  id: number; project_id: number; name: string; date: string | null; result: string; is_final: boolean; fixer: string | null; note: string | null; recorded_by: string | null; created_at: string;
}

export interface ProcurementItem {
  id: number; project_id: number; wave: string; name: string; status: string; note: string | null; sort_order: number; updated_by: string | null; updated_at: string;
}
export interface ProcurementSummary {
  total: number; pending_spec: number; pending_order: number; ordered: number; received: number; exception: number; na: number;
}
export interface ProcurementList { items: ProcurementItem[]; summary: ProcurementSummary; template_missing?: boolean }

export interface BudgetLine { id: number; project_id: number; category: string; planned_amount: number; note: string | null }
export interface Expense { id: number; project_id: number; category: string; amount: number; date: string | null; vendor: string | null; note: string | null; file_id: number | null }
export interface BudgetSummary {
  planned_total: number; spent_total: number; remaining: number; used_pct: number | null;
  categories: { category: string; planned: number; spent: number; planned_pct: number; spent_pct: number; variance: number }[];
}
export interface Analysis {
  id: number; project_id: number; name: string; inputs: import('../lib/analysis').AnalysisInputs; outputs: import('../lib/analysis').AnalysisOutputs;
  is_current: boolean; created_at: string; updated_at: string;
}

export interface DashboardWidgets {
  upcoming: { project_id: number; project_name: string; date: string; kind: string; days: number; overdue: boolean }[];
  capital: { project_id: number; project_name: string; purchase_price: number; spent: number; total: number }[];
  retrospectives: { project_id: number; project_name: string; target_arv: number | null; sale_price: number; arv_error_pct: number | null; budget_planned: number; spent: number; budget_error_pct: number | null; days: number | null; profit: number }[];
  weekly_spend: { week_start: string; amount: number }[];
  vendors: { vendor: string; amount: number; count: number; projects: number }[];
  funnel: { substage: string; label: string; count: number }[];
}

export interface DashboardSummary {
  leads: number; active: number; portfolio: number; total: number; total_invested: number | null; total_budget: number | null; expected_profit: number | null; over_budget_count: number | null; money_hidden: boolean;
  /** KAN-71：买入价或目标售价缺一项、没算进预计利润的在建项目数。 */
  profit_incomplete_count?: number | null;
}

export interface ProjectBrief { project_id: number; project_name: string; address: string; stage: string }
export interface TodoRow { project: ProjectBrief; stage: string; item: StepItem; is_current: boolean; for_confirm: boolean }
export interface DashboardRole {
  my_gates?: (ProjectBrief & { key: string; title: string; stage: string; evidence_hint: string | null; confirmed: string[]; waiting: string[]; is_current: boolean })[] | null;
  my_todo?: TodoRow[] | null;
  procurement_alerts?: (ProjectBrief & { exception: string[]; pending_order: string[]; pending_spec_count: number })[] | null;
  site?: (ProjectBrief & { photo_ids: number[]; photo_count: number; last_inspection: { name: string; result: string; date: string | null } | null; failed: string[] })[] | null;
  utilities_insurance?: (ProjectBrief & { water: string; electric: string; gas: string; blocker: string | null; insurance_expires: string | null; insurance_days: number | null })[] | null;
  permits?: (ProjectBrief & { permit: 'none' | 'applied' | 'issued'; applied_days: number | null; next_inspection: { name: string; date: string | null } | null; failed: string[]; final_passed: boolean })[] | null;
  design?: (ProjectBrief & { drawing: boolean; drawing_final: boolean; measure_note: boolean })[] | null;
  sale_docs?: (ProjectBrief & { list_date: string | null; offer: boolean; sale_docs: boolean; disclosure: boolean; sale_signed: boolean; sale_closing: boolean })[] | null;
  boss?: { active: number; leads: number; portfolio: number; total_invested: number; expected_profit: number; realized_profit: number; over_budget_count: number; profit_incomplete_count?: number | null } | null;
}

export interface Me { id: number; username: string; display_name: string; role_code: string; role_label: string; tier: string; tier_label: string; is_admin: boolean; active: boolean; email: string | null; created_at: string; last_login_at: string | null; demo_mode: boolean }

// ---------- KAN-75：任务实例、成员、事件 ----------
export interface UserBrief { id: number; username: string; display_name: string; role_code: string; active: boolean }
export interface TaskEvent {
  id: number; task_id: number | null; project_id: number; kind: string; kind_label: string;
  actor: UserBrief | null; actor_role_snapshot: string | null; before: Record<string, any> | null; after: Record<string, any> | null;
  reason: string | null; created_at: string; text: string;
}
export type TaskExecStatus = 'not_started' | 'in_progress' | 'waiting' | 'pending_review' | 'done';
export interface Task {
  id: number; project_id: number; project_name: string; project_address: string;
  step_key: string | null; source: string; stage_key: string; stage_label: string; stage_short: string; stage_index: number;
  project_current_stage_index: number; project_current_stage_label: string;
  title: string; ws: string | null; purpose: string | null; done_when: string | null; owners: string[]; deliverable: Deliverable | null;
  description: string | null; deliverable_note: string | null;
  assignee: UserBrief | null; reviewer: UserBrief | null;
  exec_status: TaskExecStatus; exec_status_label: string;
  due_at: string | null; wait_for: string | null; wait_reason: string | null; wait_until: string | null;
  version: number;
  /** 证据派生的「满足」，与执行状态并列，不互相替代 */
  satisfied: boolean; satisfied_how: string | null; satisfied_evidence: string | null; evidence_hint: string | null;
  last_event: TaskEvent | null; created_at: string; updated_at: string;
}
export interface TaskList { tasks: Task[]; stages: { key: string; label: string; short: string; index: number }[]; current_stage_index: number; template_missing: boolean; can_assign: boolean }
export interface ProjectMember extends UserBrief { role_snapshot: string | null; added_at: string | null }
export interface ProjectMembers { members: ProjectMember[]; others: UserBrief[]; can_assign: boolean; can_add_member: boolean }
export interface MyTasks { assigned: Task[]; reviewing: Task[] }
export interface TaskAssignIn { version: number; assignee_user_id?: number | null; due_at?: string | null; reason?: string | null; join_project?: boolean }
export interface TaskStatusIn { version: number; action: 'start' | 'wait' | 'resume'; wait_for?: string | null; wait_reason?: string | null; wait_until?: string | null }
export type UserRow = Omit<Me, 'demo_mode'>;

/** 演示模式下顶栏“我是”选的身份；登录后只有管理员的选择才会被后端采纳。 */
function actorHeader(): Record<string, string> {
  try { const a = localStorage.getItem('actor'); return a ? { 'X-Actor': encodeURIComponent(a) } : {}; } catch { return {}; }
}

/** 会话过期或未登录时通知 App（App 决定跳登录页还是留在演示模式）。 */
export const AUTH_EVENT = 'auth:401';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', headers: { ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...actorHeader() }, ...init });
  if (res.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event(AUTH_EVENT));
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j.detail) msg = typeof j.detail === 'string' ? j.detail : (typeof j.detail?.message === 'string' ? j.detail.message : JSON.stringify(j.detail));
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  meta: () => req<Meta>('/api/meta'),
  me: () => req<Me>('/api/auth/me'),
  authMode: () => req<{ demo_mode: boolean; has_users: boolean }>('/api/auth/mode'),
  login: (username: string, password: string) => req<Me>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => req<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  users: () => req<UserRow[]>('/api/users'),
  createUser: (body: { username: string; display_name: string; role_code: string; password: string; is_admin: boolean; email?: string | null }) => req<UserRow>('/api/users', { method: 'POST', body: JSON.stringify(body) }),
  patchUser: (id: number, body: Partial<{ display_name: string; role_code: string; is_admin: boolean; active: boolean; password: string; email: string | null }>) => req<UserRow>(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  // KAN-75：任务实例
  projectTasks: (id: number) => req<TaskList>(`/api/projects/${id}/tasks`),
  projectMembers: (id: number) => req<ProjectMembers>(`/api/projects/${id}/members`),
  taskEvents: (id: number, taskId: number) => req<TaskEvent[]>(`/api/projects/${id}/tasks/${taskId}/events`),
  assignTask: (id: number, taskId: number, body: TaskAssignIn) => req<Task>(`/api/projects/${id}/tasks/${taskId}/assign`, { method: 'POST', body: JSON.stringify(body) }),
  taskStatus: (id: number, taskId: number, body: TaskStatusIn) => req<Task>(`/api/projects/${id}/tasks/${taskId}/status`, { method: 'POST', body: JSON.stringify(body) }),
  myTasks: () => req<MyTasks>('/api/me/tasks'),
  dashboard: () => req<DashboardSummary>('/api/dashboard/summary'),
  widgets: () => req<DashboardWidgets>('/api/dashboard/widgets'),
  dashboardRole: () => req<DashboardRole>('/api/dashboard/role'),
  lookupAddress: (q: string) => req<AddressCandidate[]>(`/api/lookup/address?q=${encodeURIComponent(q)}`),
  lookupProperty: (address: string) => req<LookupResult>('/api/lookup/property', { method: 'POST', body: JSON.stringify({ address }) }),
  projects: (params?: { stage?: string; q?: string }) => {
    const s = new URLSearchParams();
    if (params?.stage) s.set('stage', params.stage);
    if (params?.q) s.set('q', params.q);
    return req<Project[]>(`/api/projects${s.toString() ? `?${s}` : ''}`);
  },
  project: (id: number) => req<Project>(`/api/projects/${id}`),
  createProject: (body: any) => req<Project>('/api/projects', { method: 'POST', body: JSON.stringify(body) }),
  patchProject: (id: number, body: any) => req<Project>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteProject: (id: number) => req<void>(`/api/projects/${id}`, { method: 'DELETE' }),
  propertyData: (id: number) => req<PropertyData>(`/api/projects/${id}/property`),
  patchField: (id: number, field: string, value: string | null) => req<PropertyData>(`/api/projects/${id}/property`, { method: 'PATCH', body: JSON.stringify({ field, value }) }),
  setPrimary: (id: number, field: string, source_id: number) => req<PropertyData>(`/api/projects/${id}/property/fields/${field}/primary`, { method: 'POST', body: JSON.stringify({ source_id }) }),
  files: (id: number) => req<ProjectFile[]>(`/api/projects/${id}/files`),
  upload: (id: number, form: FormData) => req<ProjectFile>(`/api/projects/${id}/files`, { method: 'POST', body: form }),
  patchFile: (fileId: number, body: any) => req<ProjectFile>(`/api/files/${fileId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteFile: (fileId: number) => req<void>(`/api/files/${fileId}`, { method: 'DELETE' }),
  budgetLines: (id: number) => req<BudgetLine[]>(`/api/projects/${id}/budget-lines`),
  addBudgetLine: (id: number, body: any) => req<BudgetLine>(`/api/projects/${id}/budget-lines`, { method: 'POST', body: JSON.stringify(body) }),
  deleteBudgetLine: (lineId: number) => req<void>(`/api/budget-lines/${lineId}`, { method: 'DELETE' }),
  expenses: (id: number) => req<Expense[]>(`/api/projects/${id}/expenses`),
  addExpense: (id: number, body: any) => req<Expense>(`/api/projects/${id}/expenses`, { method: 'POST', body: JSON.stringify(body) }),
  deleteExpense: (expenseId: number) => req<void>(`/api/expenses/${expenseId}`, { method: 'DELETE' }),
  budgetSummary: (id: number) => req<BudgetSummary>(`/api/projects/${id}/budget-summary`),
  analyses: (id: number) => req<Analysis[]>(`/api/projects/${id}/analyses`),
  analysisPrefill: (id: number, tier = 'medium') => req<{ inputs: Analysis['inputs']; outputs: Analysis['outputs'] }>(`/api/projects/${id}/analyses/prefill?tier=${tier}`),
  createAnalysis: (id: number, body: { name?: string; inputs?: Analysis['inputs']; tier?: string }) => req<Analysis>(`/api/projects/${id}/analyses`, { method: 'POST', body: JSON.stringify(body) }),
  patchAnalysis: (aid: number, body: { name?: string; inputs?: Analysis['inputs']; is_current?: boolean }) => req<Analysis>(`/api/analyses/${aid}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteAnalysis: (aid: number) => req<void>(`/api/analyses/${aid}`, { method: 'DELETE' }),
  applyAnalysis: (aid: number, body: { mode: 'replace' | 'append'; apply_prices: boolean }) => req<Project>(`/api/analyses/${aid}/apply`, { method: 'POST', body: JSON.stringify(body) }),
  steps: (id: number) => req<Steps>(`/api/projects/${id}/steps`),
  toggleStep: (id: number, key: string, body: { done: boolean; note?: string | null; confirm_as?: string | null }) => req<Steps>(`/api/projects/${id}/steps/${key}`, { method: 'POST', body: JSON.stringify(body) }),
  utilities: (id: number) => req<Utility[]>(`/api/projects/${id}/utilities`),
  saveUtility: (id: number, kind: string, body: UtilityIn) => req<Utility[]>(`/api/projects/${id}/utilities/${kind}`, { method: 'PUT', body: JSON.stringify(body) }),
  inspections: (id: number) => req<Inspection[]>(`/api/projects/${id}/inspections`),
  addInspection: (id: number, body: Partial<Inspection>) => req<Inspection[]>(`/api/projects/${id}/inspections`, { method: 'POST', body: JSON.stringify(body) }),
  patchInspection: (iid: number, body: Partial<Inspection>) => req<Inspection[]>(`/api/inspections/${iid}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteInspection: (iid: number) => req<Inspection[]>(`/api/inspections/${iid}`, { method: 'DELETE' }),
  procurement: (id: number) => req<ProcurementList>(`/api/projects/${id}/procurement`),
  initProcurement: (id: number) => req<ProcurementList>(`/api/projects/${id}/procurement/init`, { method: 'POST' }),
  patchProcurement: (itemId: number, body: { status?: string; note?: string | null }) => req<ProcurementList>(`/api/procurement/${itemId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  updates: (limit = 30) => req<Update[]>(`/api/updates?limit=${limit}`),
  projectUpdates: (id: number, limit = 30) => req<Update[]>(`/api/projects/${id}/updates?limit=${limit}`),
};
