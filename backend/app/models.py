from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


class ProjectCreation(Base):
    """创建请求凭据：相同账号与请求键只提交一次，和房屋、任务在同一事务。"""
    __tablename__ = "project_creations"
    __table_args__ = (UniqueConstraint("user_id", "request_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    request_key: Mapped[str] = mapped_column(String(36))
    fingerprint: Mapped[str] = mapped_column(String(64))
    # 保留请求凭据；项目被删除后重试不能悄悄新建第二套。
    project_id: Mapped[Optional[int]] = mapped_column(Integer)
    created_at: Mapped[str] = mapped_column(String, default=now_iso)


class Property(Base):
    __tablename__ = "properties"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    address_std: Mapped[str] = mapped_column(String, index=True)
    street: Mapped[Optional[str]] = mapped_column(String)
    city: Mapped[Optional[str]] = mapped_column(String)
    state: Mapped[Optional[str]] = mapped_column(String)
    zip: Mapped[Optional[str]] = mapped_column(String)
    lat: Mapped[Optional[float]] = mapped_column(Float)
    lng: Mapped[Optional[float]] = mapped_column(Float)
    apn: Mapped[Optional[str]] = mapped_column(String, index=True)
    property_type: Mapped[Optional[str]] = mapped_column(String)
    style: Mapped[Optional[str]] = mapped_column(String)
    year_built: Mapped[Optional[int]] = mapped_column(Integer)
    sqft: Mapped[Optional[int]] = mapped_column(Integer)
    beds: Mapped[Optional[int]] = mapped_column(Integer)
    baths_full: Mapped[Optional[int]] = mapped_column(Integer)
    baths_half: Mapped[Optional[int]] = mapped_column(Integer)
    stories: Mapped[Optional[int]] = mapped_column(Integer)
    garage_spaces: Mapped[Optional[int]] = mapped_column(Integer)
    basement: Mapped[Optional[str]] = mapped_column(String)
    lot_sqft: Mapped[Optional[int]] = mapped_column(Integer)
    land_use: Mapped[Optional[str]] = mapped_column(String)
    avm_value: Mapped[Optional[int]] = mapped_column(Integer)
    list_price: Mapped[Optional[int]] = mapped_column(Integer)
    annual_tax: Mapped[Optional[int]] = mapped_column(Integer)
    created_at: Mapped[str] = mapped_column(String, default=now_iso)

    field_sources: Mapped[list["PropertyFieldSource"]] = relationship(
        back_populates="property", cascade="all, delete-orphan"
    )
    owner: Mapped[Optional["Owner"]] = relationship(
        back_populates="property", cascade="all, delete-orphan", uselist=False
    )
    mortgages: Mapped[list["Mortgage"]] = relationship(cascade="all, delete-orphan")
    sales_history: Mapped[list["SalesHistory"]] = relationship(cascade="all, delete-orphan")
    projects: Mapped[list["Project"]] = relationship(back_populates="property")


class PropertyFieldSource(Base):
    __tablename__ = "property_field_sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    property_id: Mapped[int] = mapped_column(ForeignKey("properties.id"), index=True)
    field: Mapped[str] = mapped_column(String, index=True)
    value: Mapped[Optional[str]] = mapped_column(String)
    source: Mapped[str] = mapped_column(String)  # manual / public_record / lark / model / ai / demo / unverified（词表在 dictionaries.SOURCES）
    fetched_at: Mapped[str] = mapped_column(String, default=now_iso)
    confidence: Mapped[Optional[float]] = mapped_column(Float)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    note: Mapped[Optional[str]] = mapped_column(String)

    property: Mapped[Property] = relationship(back_populates="field_sources")


class Owner(Base):
    __tablename__ = "owners"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    property_id: Mapped[int] = mapped_column(ForeignKey("properties.id"), index=True)
    name: Mapped[Optional[str]] = mapped_column(String)
    mailing_address: Mapped[Optional[str]] = mapped_column(String)
    phone: Mapped[Optional[str]] = mapped_column(String)
    email: Mapped[Optional[str]] = mapped_column(String)
    owner_since: Mapped[Optional[str]] = mapped_column(String)

    property: Mapped[Property] = relationship(back_populates="owner")


class Mortgage(Base):
    __tablename__ = "mortgages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    property_id: Mapped[int] = mapped_column(ForeignKey("properties.id"), index=True)
    recording_date: Mapped[Optional[str]] = mapped_column(String)
    lender: Mapped[Optional[str]] = mapped_column(String)
    loan_type: Mapped[Optional[str]] = mapped_column(String)
    term_months: Mapped[Optional[int]] = mapped_column(Integer)
    original_balance: Mapped[Optional[float]] = mapped_column(Float)
    est_balance: Mapped[Optional[float]] = mapped_column(Float)
    rate: Mapped[Optional[float]] = mapped_column(Float)
    payment: Mapped[Optional[float]] = mapped_column(Float)


class SalesHistory(Base):
    __tablename__ = "sales_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    property_id: Mapped[int] = mapped_column(ForeignKey("properties.id"), index=True)
    recording_date: Mapped[Optional[str]] = mapped_column(String)
    seller: Mapped[Optional[str]] = mapped_column(String)
    buyer: Mapped[Optional[str]] = mapped_column(String)
    doc_type: Mapped[Optional[str]] = mapped_column(String)
    amount: Mapped[Optional[float]] = mapped_column(Float)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    property_id: Mapped[int] = mapped_column(ForeignKey("properties.id"), index=True)
    name: Mapped[str] = mapped_column(String)
    strategy: Mapped[str] = mapped_column(String, default="flip")
    stage: Mapped[str] = mapped_column(String, default="lead")
    substage: Mapped[Optional[str]] = mapped_column(String)
    lead_heat: Mapped[Optional[str]] = mapped_column(String)  # hot_lead / warm_lead
    # KAN-75 块 2：open_escrow 双确认成立那一刻的跟进档位快照。substage 列过门后会被 sync_legacy_stage
    # 覆盖成 construction（status.py / dashboard.py 还依赖它），所以历史档位另存一列，不改旧逻辑。
    lead_substage_at_escrow: Mapped[Optional[str]] = mapped_column(String)
    status_override: Mapped[Optional[str]] = mapped_column(String)
    status_override_reason: Mapped[Optional[str]] = mapped_column(String)
    purchase_price: Mapped[Optional[float]] = mapped_column(Float)
    target_arv: Mapped[Optional[float]] = mapped_column(Float)
    purchase_date: Mapped[Optional[str]] = mapped_column(String)
    construction_start: Mapped[Optional[str]] = mapped_column(String)
    construction_end: Mapped[Optional[str]] = mapped_column(String)
    list_date: Mapped[Optional[str]] = mapped_column(String)
    sale_date: Mapped[Optional[str]] = mapped_column(String)
    sale_price: Mapped[Optional[float]] = mapped_column(Float)
    risks: Mapped[Optional[str]] = mapped_column(Text)
    notes: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String, default=now_iso)
    updated_at: Mapped[str] = mapped_column(String, default=now_iso, onupdate=now_iso)

    property: Mapped[Property] = relationship(back_populates="projects")
    budget_lines: Mapped[list["BudgetLine"]] = relationship(cascade="all, delete-orphan")
    expenses: Mapped[list["Expense"]] = relationship(cascade="all, delete-orphan")
    files: Mapped[list["ProjectFile"]] = relationship(cascade="all, delete-orphan")
    utilities: Mapped[list["UtilityAccount"]] = relationship(cascade="all, delete-orphan")
    inspections: Mapped[list["Inspection"]] = relationship(cascade="all, delete-orphan")
    analyses: Mapped[list["DealAnalysis"]] = relationship(cascade="all, delete-orphan")
    procurement_items: Mapped[list["ProcurementItem"]] = relationship(cascade="all, delete-orphan")


class BudgetLine(Base):
    __tablename__ = "budget_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    category: Mapped[str] = mapped_column(String)
    planned_amount: Mapped[float] = mapped_column(Float, default=0)
    note: Mapped[Optional[str]] = mapped_column(String)


class Expense(Base):
    __tablename__ = "expenses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    budget_line_id: Mapped[Optional[int]] = mapped_column(ForeignKey("budget_lines.id"))
    category: Mapped[str] = mapped_column(String)
    date: Mapped[Optional[str]] = mapped_column(String)
    vendor: Mapped[Optional[str]] = mapped_column(String)
    amount: Mapped[float] = mapped_column(Float, default=0)
    note: Mapped[Optional[str]] = mapped_column(String)
    file_id: Mapped[Optional[int]] = mapped_column(ForeignKey("files.id"))


class ProjectFile(Base):
    __tablename__ = "files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    filename: Mapped[str] = mapped_column(String)
    stored_path: Mapped[str] = mapped_column(String)
    mime: Mapped[Optional[str]] = mapped_column(String)
    size: Mapped[int] = mapped_column(Integer, default=0)
    doc_type: Mapped[Optional[str]] = mapped_column(String)
    stage: Mapped[Optional[str]] = mapped_column(String)
    doc_date: Mapped[Optional[str]] = mapped_column(String)
    counterparty: Mapped[Optional[str]] = mapped_column(String)
    amount: Mapped[Optional[float]] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String, default="upload")
    uploaded_by: Mapped[Optional[str]] = mapped_column(String)  # 谁传的（人员代号）
    step_key: Mapped[Optional[str]] = mapped_column(String, index=True)  # 挂到清单的哪一步（照片靠这个打勾）
    expires_at: Mapped[Optional[str]] = mapped_column(String)  # 到期日（保险这类有时限的文件），工作台“未来 30 天”会提醒
    extracted_text: Mapped[Optional[str]] = mapped_column(Text)
    uploaded_at: Mapped[str] = mapped_column(String, default=now_iso)


class DealAnalysis(Base):
    """买前的交易分析（可多版本）。inputs / outputs 以 JSON 文本存，公式见 analysis.py。"""
    __tablename__ = "deal_analyses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    name: Mapped[str] = mapped_column(String, default="分析 1")
    inputs_json: Mapped[str] = mapped_column(Text, default="{}")
    outputs_json: Mapped[str] = mapped_column(Text, default="{}")
    is_current: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[str] = mapped_column(String, default=now_iso)
    updated_at: Mapped[str] = mapped_column(String, default=now_iso, onupdate=now_iso)


class ProjectUpdate(Base):
    """谁改了什么：每次有人上传、改字段、记支出、勾清单，都记一条，供负责人看。"""
    __tablename__ = "project_updates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    actor: Mapped[str] = mapped_column(String, default="负责人")
    kind: Mapped[str] = mapped_column(String)  # file / data / expense / budget / analysis / step / project
    text: Mapped[str] = mapped_column(String)
    created_at: Mapped[str] = mapped_column(String, default=now_iso, index=True)


class ProjectStep(Base):
    """阶段清单里手动打的勾（自动证据不存，读时算）。"""
    __tablename__ = "project_steps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    key: Mapped[str] = mapped_column(String, index=True)
    done: Mapped[bool] = mapped_column(Boolean, default=True)
    done_by: Mapped[Optional[str]] = mapped_column(String)
    done_at: Mapped[Optional[str]] = mapped_column(String)
    note: Mapped[Optional[str]] = mapped_column(String)


class UtilityAccount(Base):
    """水、电、瓦斯三家账户：每套房各一条。各人自己填，负责人打开就能看，不用汇报。"""
    __tablename__ = "utility_accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    kind: Mapped[str] = mapped_column(String)  # water / electric / gas
    company: Mapped[Optional[str]] = mapped_column(String)
    website: Mapped[Optional[str]] = mapped_column(String)
    account_no: Mapped[Optional[str]] = mapped_column(String)
    login: Mapped[Optional[str]] = mapped_column(String)
    password: Mapped[Optional[str]] = mapped_column(String)
    opened_under: Mapped[Optional[str]] = mapped_column(String)  # 用谁的名字开的
    status: Mapped[str] = mapped_column(String, default="not_started")  # not_started / pending / on / off
    blocker: Mapped[Optional[str]] = mapped_column(String)  # 卡在什么地方
    updated_by: Mapped[Optional[str]] = mapped_column(String)
    updated_at: Mapped[str] = mapped_column(String, default=now_iso, onupdate=now_iso)


class Inspection(Base):
    """施工检查记录：一次检查一行，次数每套房不同。最后一次标 is_final，通过了就是 final。"""
    __tablename__ = "inspections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    name: Mapped[str] = mapped_column(String)  # 查什么：框架 / 水电 / 屋顶 / final
    date: Mapped[Optional[str]] = mapped_column(String)
    result: Mapped[str] = mapped_column(String, default="scheduled")  # scheduled / passed / failed
    is_final: Mapped[bool] = mapped_column(Boolean, default=False)
    fixer: Mapped[Optional[str]] = mapped_column(String)  # 没过谁整改
    note: Mapped[Optional[str]] = mapped_column(String)
    recorded_by: Mapped[Optional[str]] = mapped_column(String)
    created_at: Mapped[str] = mapped_column(String, default=now_iso)


class ProcurementItem(Base):
    """材料采购行：按节点波次管理选型 / 下单 / 到货 / 异常。"""
    __tablename__ = "procurement_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    wave: Mapped[str] = mapped_column(String, index=True)  # before_rough / long_lead / after_waterproof / yard / other
    name: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="pending_spec")  # pending_spec / pending_order / ordered / received / exception / na
    note: Mapped[Optional[str]] = mapped_column(String)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    updated_by: Mapped[Optional[str]] = mapped_column(String)
    updated_at: Mapped[str] = mapped_column(String, default=now_iso, onupdate=now_iso)


class User(Base):
    """登录账号：一个人一个账号，账号绑定一个角色代号（决定权限）。"""
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String, unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String)
    role_code: Mapped[str] = mapped_column(String)  # 对应 ROLES 里的代号：老板 / 负责人 / D / J / K ...
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    password_hash: Mapped[str] = mapped_column(String)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    email: Mapped[Optional[str]] = mapped_column(String)  # KAN-75：邮件提醒的收件地址；管理员在用户页维护，可空
    created_at: Mapped[str] = mapped_column(String, default=now_iso)
    last_login_at: Mapped[Optional[str]] = mapped_column(String)


# ---------------- KAN-75：任务实例、项目成员、任务事件 ----------------
# 这三张表是 KAN-21（成员）/ KAN-27（实例）/ KAN-28（事件）的最小切片，列名按那三张票的字段清单起，
# 以后只搬不改。分派层只描述「人在做什么」，不拥有「完成」：满足仍由 steps.compute_steps 按证据派生，
# 关键节点仍走 project_steps 的 D/J 确认。


class ProjectMember(Base):
    """项目成员：谁参与这套房。建项目时创建者自动加入；「加入项目并分派」时再加。"""
    __tablename__ = "project_members"
    __table_args__ = (UniqueConstraint("project_id", "user_id", name="uq_project_member"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    role_snapshot: Mapped[Optional[str]] = mapped_column(String)  # 加入时的角色代号，只用于解释当时分工
    added_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))
    added_at: Mapped[str] = mapped_column(String, default=now_iso)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Task(Base):
    """任务实例：每套房每个普通清单项一条（step_key 唯一）；临时事项 step_key 为空（块 7）。"""
    __tablename__ = "tasks"
    __table_args__ = (UniqueConstraint("project_id", "step_key", name="uq_task_step"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    step_key: Mapped[Optional[str]] = mapped_column(String, index=True)  # 模板项的稳定 key；临时事项为空
    source: Mapped[str] = mapped_column(String, default="template")  # template / adhoc / change
    stage_key: Mapped[str] = mapped_column(String)  # s1…s6，展示分组由前端按 meta 映射
    title: Mapped[str] = mapped_column(String)
    description: Mapped[Optional[str]] = mapped_column(Text)
    deliverable_note: Mapped[Optional[str]] = mapped_column(Text)
    assignee_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), index=True)
    reviewer_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), index=True)
    exec_status: Mapped[str] = mapped_column(String, default="not_started")  # not_started / in_progress / waiting / pending_review / done
    due_at: Mapped[Optional[str]] = mapped_column(String)  # YYYY-MM-DD，可空
    wait_for: Mapped[Optional[str]] = mapped_column(String)
    wait_reason: Mapped[Optional[str]] = mapped_column(Text)
    wait_until: Mapped[Optional[str]] = mapped_column(String)
    version: Mapped[int] = mapped_column(Integer, default=1)  # 每次写递增；客户端带旧值就 409
    requirement_version: Mapped[int] = mapped_column(Integer, default=1)
    linked_task_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tasks.id"))
    created_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))
    done_at: Mapped[Optional[str]] = mapped_column(String)  # 审核人确认本次交付的时间；只有确认才写
    created_at: Mapped[str] = mapped_column(String, default=now_iso)
    updated_at: Mapped[str] = mapped_column(String, default=now_iso, onupdate=now_iso)


class TaskSubmission(Base):
    """一次提交 = 一个批次（第 n 次）。文件只引用 files 表的行，不复制；退回、确认都记在批次上，旧批次不改。"""
    __tablename__ = "task_submissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"), index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    seq: Mapped[int] = mapped_column(Integer, default=1)
    note: Mapped[Optional[str]] = mapped_column(Text)
    submitted_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))
    submitted_at: Mapped[str] = mapped_column(String, default=now_iso)
    decision: Mapped[str] = mapped_column(String, default="pending")  # pending / confirmed / returned
    decided_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))
    decided_at: Mapped[Optional[str]] = mapped_column(String)
    decision_reason: Mapped[Optional[str]] = mapped_column(Text)


class SubmissionFile(Base):
    __tablename__ = "submission_files"
    __table_args__ = (UniqueConstraint("submission_id", "file_id", name="uq_submission_file"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    submission_id: Mapped[int] = mapped_column(ForeignKey("task_submissions.id"), index=True)
    file_id: Mapped[int] = mapped_column(ForeignKey("files.id"), index=True)


class TaskEvent(Base):
    """任务事件：分派 / 改派 / 改期 / 开始 / 等待 / 恢复 / 加入成员……与业务写同一事务，GET 不写。"""
    __tablename__ = "task_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tasks.id"), index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    kind: Mapped[str] = mapped_column(String, index=True)
    actor_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))
    actor_role_snapshot: Mapped[Optional[str]] = mapped_column(String)
    before_json: Mapped[Optional[str]] = mapped_column(Text)
    after_json: Mapped[Optional[str]] = mapped_column(Text)
    reason: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String, default=now_iso, index=True)
