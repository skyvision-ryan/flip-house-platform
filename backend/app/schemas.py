from typing import Optional

from pydantic import BaseModel, ConfigDict, HttpUrl, field_validator


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- lookup ----------
class AddressCandidateOut(BaseModel):
    label: str
    street: str
    city: str
    state: str
    zip: str
    lat: Optional[float] = None
    lng: Optional[float] = None


class FieldValueOut(BaseModel):
    field: str
    label: str
    value: Optional[str]
    source: str
    confidence: Optional[float] = None
    note: Optional[str] = None


class DuplicateOut(BaseModel):
    project_id: int
    project_name: str
    property_id: int


class LookupOut(BaseModel):
    address: AddressCandidateOut
    apn: Optional[str]
    fields: list[FieldValueOut]
    owner: Optional[dict] = None
    mortgages: list[dict] = []
    sales_history: list[dict] = []
    provider: str
    valuation: Optional[dict] = None
    duplicate_of: Optional[DuplicateOut] = None


# ---------- projects ----------
class PropertyBrief(ORM):
    id: int
    address_std: str
    street: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    apn: Optional[str] = None
    property_type: Optional[str] = None
    style: Optional[str] = None
    year_built: Optional[int] = None
    sqft: Optional[int] = None
    beds: Optional[int] = None
    baths_full: Optional[int] = None
    baths_half: Optional[int] = None
    stories: Optional[int] = None
    garage_spaces: Optional[int] = None
    basement: Optional[str] = None
    lot_sqft: Optional[int] = None
    land_use: Optional[str] = None
    avm_value: Optional[int] = None
    list_price: Optional[int] = None
    annual_tax: Optional[int] = None


class ProjectOut(ORM):
    id: int
    name: str
    strategy: str
    stage: str
    substage: Optional[str] = None
    lead_heat: Optional[str] = None
    status: str
    status_reason: str
    status_override: Optional[str] = None
    status_override_reason: Optional[str] = None
    purchase_price: Optional[float] = None
    target_arv: Optional[float] = None
    purchase_date: Optional[str] = None
    construction_start: Optional[str] = None
    construction_end: Optional[str] = None
    list_date: Optional[str] = None
    sale_date: Optional[str] = None
    sale_price: Optional[float] = None
    risks: Optional[str] = None
    notes: Optional[str] = None
    created_at: str
    updated_at: str
    property: PropertyBrief
    budget_planned: Optional[float] = None   # 青灰看不到钱时为 None
    budget_spent: Optional[float] = None
    budget_used_pct: Optional[float] = None
    money_hidden: bool = False
    missing_fields: list[str] = []
    analysis_count: int = 0
    current_stage: Optional[dict] = None
    next_up: list[dict] = []
    stage_progress: list[dict] = []      # 五段各自 done/total 与大节点状态，工作台卡片用
    earlier_undone_count: int = 0


class FieldIn(BaseModel):
    field: str
    value: Optional[str]
    source: str = "manual"   # KAN-71：客户端不带 source 就按人工，不能默认冒充公共记录
    confidence: Optional[float] = None
    note: Optional[str] = None


class ProjectCreate(BaseModel):
    name: str
    strategy: str = "flip"
    stage: str = "lead"
    substage: Optional[str] = None
    lead_heat: Optional[str] = "warm_lead"
    address: AddressCandidateOut
    apn: Optional[str] = None
    fields: list[FieldIn] = []
    owner: Optional[dict] = None
    mortgages: list[dict] = []
    sales_history: list[dict] = []
    valuation: Optional[dict] = None
    reuse_property_id: Optional[int] = None
    purchase_price: Optional[float] = None
    target_arv: Optional[float] = None
    purchase_date: Optional[str] = None
    construction_start: Optional[str] = None
    construction_end: Optional[str] = None
    risks: Optional[str] = None
    notes: Optional[str] = None
    create_analysis: bool = True


class ProjectPatch(BaseModel):
    name: Optional[str] = None
    strategy: Optional[str] = None
    stage: Optional[str] = None
    substage: Optional[str] = None
    lead_heat: Optional[str] = None
    status_override: Optional[str] = None
    status_override_reason: Optional[str] = None
    purchase_price: Optional[float] = None
    target_arv: Optional[float] = None
    purchase_date: Optional[str] = None
    construction_start: Optional[str] = None
    construction_end: Optional[str] = None
    list_date: Optional[str] = None
    sale_date: Optional[str] = None
    sale_price: Optional[float] = None
    risks: Optional[str] = None
    notes: Optional[str] = None
    clear_status_override: bool = False


# ---------- property data ----------
class SourceOut(ORM):
    id: int
    field: str
    value: Optional[str]
    source: str
    fetched_at: str
    confidence: Optional[float] = None
    is_primary: bool
    note: Optional[str] = None


class PropertyFieldOut(BaseModel):
    key: str
    label: str
    type: str
    value: Optional[str]
    primary_source: Optional[str] = None
    sources: list[SourceOut]
    has_conflict: bool


class OwnerOut(ORM):
    name: Optional[str] = None
    mailing_address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    owner_since: Optional[str] = None


class MortgageOut(ORM):
    id: int
    recording_date: Optional[str] = None
    lender: Optional[str] = None
    loan_type: Optional[str] = None
    term_months: Optional[int] = None
    original_balance: Optional[float] = None
    est_balance: Optional[float] = None
    rate: Optional[float] = None
    payment: Optional[float] = None


class SalesHistoryOut(ORM):
    id: int
    recording_date: Optional[str] = None
    seller: Optional[str] = None
    buyer: Optional[str] = None
    doc_type: Optional[str] = None
    amount: Optional[float] = None


class PropertyDataOut(BaseModel):
    property: PropertyBrief
    fields: list[PropertyFieldOut]
    owner: Optional[OwnerOut] = None
    mortgages: list[MortgageOut]
    sales_history: list[SalesHistoryOut]


class FieldPatch(BaseModel):
    field: str
    value: Optional[str]


class PrimaryIn(BaseModel):
    source_id: int


# ---------- files ----------
class FileOut(ORM):
    id: int
    project_id: int
    filename: str
    mime: Optional[str] = None
    size: int
    doc_type: Optional[str] = None
    stage: Optional[str] = None
    doc_date: Optional[str] = None
    counterparty: Optional[str] = None
    amount: Optional[float] = None
    source: str
    uploaded_by: Optional[str] = None
    step_key: Optional[str] = None
    expires_at: Optional[str] = None
    uploaded_at: str


class FilePatch(BaseModel):
    uploaded_by: Optional[str] = None
    step_key: Optional[str] = None
    expires_at: Optional[str] = None
    doc_type: Optional[str] = None
    stage: Optional[str] = None
    doc_date: Optional[str] = None
    counterparty: Optional[str] = None
    amount: Optional[float] = None
    filename: Optional[str] = None


# ---------- budget ----------
class BudgetLineIn(BaseModel):
    category: str
    planned_amount: float
    note: Optional[str] = None


class BudgetLineOut(ORM):
    id: int
    project_id: int
    category: str
    planned_amount: float
    note: Optional[str] = None


class ExpenseIn(BaseModel):
    category: str
    amount: float
    date: Optional[str] = None
    vendor: Optional[str] = None
    note: Optional[str] = None
    file_id: Optional[int] = None


class ExpenseOut(ORM):
    id: int
    project_id: int
    category: str
    amount: float
    date: Optional[str] = None
    vendor: Optional[str] = None
    note: Optional[str] = None
    file_id: Optional[int] = None


class CategorySummary(BaseModel):
    category: str
    planned: float
    spent: float
    planned_pct: float
    spent_pct: float
    variance: float


class BudgetSummaryOut(BaseModel):
    planned_total: float
    spent_total: float
    remaining: float
    used_pct: Optional[float]
    categories: list[CategorySummary]


# ---------- dashboard ----------
class DashboardSummary(BaseModel):
    leads: int
    active: int
    portfolio: int
    total: int
    total_invested: Optional[float] = None    # 看不到钱的身份为 None
    total_budget: Optional[float] = None
    expected_profit: Optional[float] = None
    over_budget_count: Optional[int] = None
    profit_incomplete_count: Optional[int] = None   # KAN-71：买入价或目标售价缺一项、没算进预计利润的在建项目数
    money_hidden: bool = False


class DashboardRole(BaseModel):
    """按身份给的专属小组件数据；没权限的块不返回（None）。"""
    my_gates: Optional[list[dict]] = None
    my_todo: Optional[list[dict]] = None
    procurement_alerts: Optional[list[dict]] = None
    site: Optional[list[dict]] = None
    utilities_insurance: Optional[list[dict]] = None
    permits: Optional[list[dict]] = None
    design: Optional[list[dict]] = None
    sale_docs: Optional[list[dict]] = None
    boss: Optional[dict] = None


# ---------- deal analysis ----------
class AnalysisOut(BaseModel):
    id: int
    project_id: int
    name: str
    inputs: dict
    outputs: dict
    is_current: bool
    created_at: str
    updated_at: str


class AnalysisCreate(BaseModel):
    name: Optional[str] = None
    inputs: Optional[dict] = None
    tier: str = "medium"


class AnalysisPatch(BaseModel):
    name: Optional[str] = None
    inputs: Optional[dict] = None
    is_current: Optional[bool] = None


class AnalysisApplyIn(BaseModel):
    mode: str = "replace"  # replace | append
    apply_prices: bool = True


class PrefillOut(BaseModel):
    inputs: dict
    outputs: dict


class DashboardWidgets(BaseModel):
    upcoming: list[dict]  # 关键日期 + 保险到期
    capital: list[dict]
    retrospectives: list[dict]
    weekly_spend: list[dict]
    vendors: list[dict]
    funnel: list[dict]


# ---------- 更新记录与阶段清单 ----------
class UpdateOut(ORM):
    id: int
    project_id: int
    project_name: Optional[str] = None
    actor: str
    kind: str
    text: str
    created_at: str


class StepToggleIn(BaseModel):
    done: bool = True
    note: Optional[str] = None
    confirm_as: Optional[str] = None  # 大节点：以 D 或 J 的身份确认；不传则用当前身份


# ---------- 水电瓦斯与检查记录 ----------
class UtilityIn(BaseModel):
    company: Optional[str] = None
    website: Optional[str] = None
    account_no: Optional[str] = None
    login: Optional[str] = None
    password: Optional[str] = None
    opened_under: Optional[str] = None
    status: str = "not_started"
    blocker: Optional[str] = None

    @field_validator("website")
    @classmethod
    def validate_website(cls, value: Optional[str]) -> Optional[str]:
        if not value or not value.strip():
            return None
        value = value.strip()
        if ":" not in value and not value.startswith("//"):
            value = "https://" + value
        try:
            url = HttpUrl(value)
            if url.username or url.password:
                raise ValueError()
        except ValueError:
            raise ValueError("请输入有效的 http:// 或 https:// 网址，且不要包含账号密码")
        return str(url)


class UtilityOut(ORM):
    id: int
    project_id: int
    kind: str
    company: Optional[str] = None
    website: Optional[str] = None
    account_no: Optional[str] = None
    login: Optional[str] = None
    password: Optional[str] = None
    opened_under: Optional[str] = None
    status: str
    blocker: Optional[str] = None
    updated_by: Optional[str] = None
    updated_at: str


class InspectionIn(BaseModel):
    name: str
    date: Optional[str] = None
    result: str = "scheduled"
    is_final: bool = False
    fixer: Optional[str] = None
    note: Optional[str] = None


class InspectionPatch(BaseModel):
    name: Optional[str] = None
    date: Optional[str] = None
    result: Optional[str] = None
    is_final: Optional[bool] = None
    fixer: Optional[str] = None
    note: Optional[str] = None


class InspectionOut(ORM):
    id: int
    project_id: int
    name: str
    date: Optional[str] = None
    result: str
    is_final: bool
    fixer: Optional[str] = None
    note: Optional[str] = None
    recorded_by: Optional[str] = None
    created_at: str


class ProcurementItemOut(ORM):
    id: int
    project_id: int
    wave: str
    name: str
    status: str
    note: Optional[str] = None
    sort_order: int = 0
    updated_by: Optional[str] = None
    updated_at: str


class ProcurementPatchIn(BaseModel):
    status: Optional[str] = None
    note: Optional[str] = None


class ProcurementSummary(BaseModel):
    total: int
    pending_spec: int
    pending_order: int
    ordered: int
    received: int
    exception: int
    na: int


class ProcurementListOut(BaseModel):
    items: list[ProcurementItemOut]
    summary: ProcurementSummary
    template_missing: bool = False   # 老项目没灌过模板


class StepsOut(BaseModel):
    stages: list[dict]
    current_stage: dict
    next_up: list[dict]
    earlier_undone: list[dict] = []
    stage_progress: list[dict] = []


# ---------- KAN-75：任务实例、成员、事件 ----------
class UserBrief(BaseModel):
    id: int
    username: str
    display_name: str
    role_code: str
    active: bool = True


class TaskEventOut(BaseModel):
    id: int
    task_id: Optional[int] = None
    project_id: int
    kind: str
    kind_label: str
    actor: Optional[UserBrief] = None
    actor_role_snapshot: Optional[str] = None
    before: Optional[dict] = None
    after: Optional[dict] = None
    reason: Optional[str] = None
    created_at: str
    text: str


class TaskOut(BaseModel):
    id: int
    project_id: int
    project_name: str
    project_address: str
    step_key: Optional[str] = None
    source: str
    stage_key: str
    stage_label: str
    stage_short: str
    stage_index: int
    project_current_stage_index: int
    project_current_stage_label: str
    title: str
    ws: Optional[str] = None
    purpose: Optional[str] = None
    done_when: Optional[str] = None
    owners: list[str] = []
    deliverable: Optional[dict] = None
    description: Optional[str] = None
    deliverable_note: Optional[str] = None
    assignee: Optional[UserBrief] = None
    reviewer: Optional[UserBrief] = None
    exec_status: str
    exec_status_label: str
    due_at: Optional[str] = None
    wait_for: Optional[str] = None
    wait_reason: Optional[str] = None
    wait_until: Optional[str] = None
    version: int
    satisfied: bool = False          # 证据派生的「满足」，与执行状态并列，不互相替代
    satisfied_how: Optional[str] = None
    satisfied_evidence: Optional[str] = None
    evidence_hint: Optional[str] = None
    last_event: Optional[TaskEventOut] = None
    created_at: str
    updated_at: str


class TaskListOut(BaseModel):
    tasks: list[TaskOut]
    stages: list[dict]
    current_stage_index: int
    template_missing: bool = False
    can_assign: bool = False


class MemberOut(UserBrief):
    role_snapshot: Optional[str] = None
    added_at: Optional[str] = None


class MembersOut(BaseModel):
    members: list[MemberOut]
    others: list[UserBrief]
    can_assign: bool
    can_add_member: bool


class MyTasksOut(BaseModel):
    assigned: list[TaskOut]
    reviewing: list[TaskOut]


class TaskAssignIn(BaseModel):
    version: int
    assignee_user_id: Optional[int] = None
    due_at: Optional[str] = None
    reason: Optional[str] = None
    join_project: bool = False


class TaskStatusIn(BaseModel):
    version: int
    action: str  # start / wait / resume
    wait_for: Optional[str] = None
    wait_reason: Optional[str] = None
    wait_until: Optional[str] = None
