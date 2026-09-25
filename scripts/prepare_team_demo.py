#!/usr/bin/env python3
"""Prepare three synthetic team projects against existing accounts.

Default is read-only. SQLite database, uploads, roster and admin identity must be
explicit. Apply backs up and restores a copy for verification before any writes.
No user is created, deleted, renamed, re-roled or given a new password.
"""
import argparse
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import sqlite3
import sys
import tempfile
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from sqlalchemy import create_engine, delete, select, text
from sqlalchemy.orm import Session

from app import models
from app.analysis import build_prefill, full_outputs
from app.auth import email_users
from app.dictionaries import FILE_TYPES, STAGE_CHECKLIST, STEP_BY_KEY
from app.routers.files import _can_download, _can_touch
from app.routers.procurement import ensure_procurement
from app.routers.tasks import ensure_tasks
from app.steps import compute_steps, sync_legacy_stage

SLOTS = {"jessie": "J", "david": "D", "kody": "项目助理", "tristin": "采购",
         "jeremy": "采购", "zoey": "Permit/设计", "sabrina": "财务"}
EXTRA_TITLES = {
    "jessie": ("核对当前房屋的协作安排", "汇总跨职责资料缺口"),
    "david": ("复核本房定价依据", "记录合同与节点核对意见"),
    "kody": ("核对水电燃气账户卡点", "核对保险文件与到期日"),
    "tristin": ("核对厨房材料规格与交期", "跟进厨房材料采购异常"),
    "jeremy": ("核对卫浴材料规格与交期", "跟进卫浴材料到货记录"),
    "zoey": ("核对设计与Permit资料版本", "整理本房检查与整改说明"),
    "sabrina": ("核对分类预算与费用归集", "核对本房费用凭证缺口"),
    "admin": ("记录本房现场资料核对意见", "整理经营风险与下一步说明"),
}
TEMPLATE_OWNER = {
    "screen": "jessie", "view": "admin", "analysis": "admin", "price": "david", "loan_insurance": "kody",
    "loan_doc": "david", "home_inspection": "jessie", "measure": "admin", "design": "zoey",
    "utilities_on": "kody", "design_final": "zoey", "permit_apply": "zoey", "prep_work": "admin",
    "permit_issued": "zoey", "purchase": "tristin", "progress": "admin", "inspections": "zoey",
    "staging": "jessie", "agent": "jessie", "mow": "admin", "sale_docs": "jessie",
    "disclosure": "admin", "sign": "david", "services_off": "kody",
}
FILE_STAGE = {row["value"]: row["stage"] for row in FILE_TYPES}
STEP_STAGE = {item["key"]: stage["key"] for stage in STAGE_CHECKLIST for item in stage["items"]}


def resolve_team(db: Session, roster: object, admin_user_id: int) -> dict[str, models.User]:
    if not isinstance(roster, list):
        raise ValueError("名单须为 name/email/role 的 JSON 数组")
    team = {}
    for row in roster:
        if not isinstance(row, dict) or not all(isinstance(row.get(key), str) for key in ("name", "email", "role")):
            raise ValueError("名单字段不完整")
        slot = row["name"].strip().casefold()
        if slot not in SLOTS:
            raise ValueError("名单含未指定的演示参与人；不会读取或修改该账号")
        if slot in team or row["role"] != SLOTS[slot]:
            raise ValueError("名单有重复参与人或角色不符")
        matches = email_users(db, row["email"])
        if len(matches) != 1 or not matches[0].active or matches[0].role_code != SLOTS[slot]:
            raise ValueError("参与账号不存在、停用、邮箱有歧义或实际角色不符")
        team[slot] = matches[0]
    if set(team) != set(SLOTS):
        raise ValueError("须提供全部七位员工，缺少参与人")
    admin = db.get(models.User, admin_user_id)
    if not admin or not admin.active or not admin.is_admin:
        raise ValueError("--admin-user-id 必须明确指定启用的管理员账号")
    if admin.id in {user.id for user in team.values()}:
        raise ValueError("T 管理员须与七位员工为不同账号")
    team["admin"] = admin
    if len({user.id for user in team.values()}) != 8:
        raise ValueError("参与账号 ID 必须互不重复")
    return team


def _sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def backup_and_verify(database: Path, uploads: Path, backup_dir: Path) -> Path:
    if backup_dir == uploads or uploads in backup_dir.parents:
        raise ValueError("备份目录不能放在附件目录内")
    backup_dir.mkdir(parents=True, exist_ok=True)
    bundle = backup_dir / f"team-demo-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid4().hex[:8]}"
    bundle.mkdir(mode=0o700)
    with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as source, sqlite3.connect(bundle / "database.sqlite3") as target:
        source.backup(target)
        if target.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("数据库备份完整性校验失败")
    (bundle / "database.sqlite3").chmod(0o600)
    if uploads.exists():
        if any(path.is_symlink() for path in uploads.rglob("*")):
            raise ValueError("附件目录含符号链接，需先核对备份范围")
        shutil.copytree(uploads, bundle / "uploads")
    else:
        (bundle / "uploads").mkdir()
    hashes = {str(path.relative_to(uploads)): _sha(path) for path in uploads.rglob("*") if path.is_file()} if uploads.exists() else {}
    if any(_sha(bundle / "uploads" / name) != digest for name, digest in hashes.items()):
        raise ValueError("附件备份与源文件不一致；可能仍有写入，请停止服务后重试")
    # Rehearse restore into a disposable directory, never onto the source DB.
    with tempfile.TemporaryDirectory(prefix="team-demo-restore-") as temporary:
        restored = Path(temporary)
        shutil.copy2(bundle / "database.sqlite3", restored / "app.db")
        shutil.copytree(bundle / "uploads", restored / "uploads")
        with sqlite3.connect(restored / "app.db") as check:
            if check.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("备份恢复演练失败")
        if _sha(restored / "app.db") != _sha(bundle / "database.sqlite3") or any(_sha(restored / "uploads" / name) != digest for name, digest in hashes.items()):
            raise ValueError("恢复副本校验不一致")
    (bundle / "manifest.json").write_text(json.dumps({"restore_verified": True, "database_sha256": _sha(bundle / "database.sqlite3"), "upload_sha256": hashes}, indent=2), encoding="utf-8")
    (bundle / "manifest.json").chmod(0o600)
    return bundle


def _owned(db: Session, scope: str) -> list[models.Project]:
    return list(db.scalars(select(models.Project).join(models.Property).where(models.Property.apn.in_([f"TEAM-DEMO:{scope}:{i}" for i in range(3)]))).all())


def _delete_projects(db: Session, ids: list[int], uploads: Path) -> list[Path]:
    """Delete exactly approved IDs; refuse references crossing that boundary."""
    projects = list(db.scalars(select(models.Project).where(models.Project.id.in_(ids))).all())
    if len(projects) != len(set(ids)):
        raise ValueError("待替换项目 ID 不存在或重复")
    task_ids = list(db.scalars(select(models.Task.id).where(models.Task.project_id.in_(ids))).all())
    file_rows = list(db.scalars(select(models.ProjectFile).where(models.ProjectFile.project_id.in_(ids))).all())
    file_ids = [row.id for row in file_rows]
    sub_ids = list(db.scalars(select(models.TaskSubmission.id).where(models.TaskSubmission.project_id.in_(ids))).all())
    budget_ids = list(db.scalars(select(models.BudgetLine.id).where(models.BudgetLine.project_id.in_(ids))).all())
    if db.scalar(select(models.Task.id).where(models.Task.project_id.not_in(ids), models.Task.linked_task_id.in_(task_ids)).limit(1)):
        raise ValueError("有范围外任务引用待替换任务，拒绝删除")
    if db.scalar(select(models.Expense.id).where(models.Expense.project_id.not_in(ids), models.Expense.file_id.in_(file_ids)).limit(1)):
        raise ValueError("有范围外费用引用待替换文件，拒绝删除")
    if db.scalar(select(models.Expense.id).where(models.Expense.project_id.not_in(ids), models.Expense.budget_line_id.in_(budget_ids)).limit(1)):
        raise ValueError("有范围外费用引用待替换预算，拒绝删除")
    for model in (models.TaskEvent, models.TaskSubmission):
        if db.scalar(select(model.id).where(model.project_id.not_in(ids), model.task_id.in_(task_ids)).limit(1)):
            raise ValueError("有范围外历史引用待替换任务，拒绝删除")
    if db.scalar(select(models.SubmissionFile.id).where(models.SubmissionFile.submission_id.not_in(sub_ids), models.SubmissionFile.file_id.in_(file_ids)).limit(1)):
        raise ValueError("有范围外提交引用待替换文件，拒绝删除")
    paths = [Path(row.stored_path).resolve() for row in file_rows if row.stored_path]
    if any(uploads not in path.parents for path in paths):
        raise ValueError("待替换附件路径不在显式 uploads 目录内，拒绝删除")
    other_paths = {Path(value).resolve() for value in db.scalars(select(models.ProjectFile.stored_path).where(models.ProjectFile.project_id.not_in(ids))).all() if value}
    if set(paths).intersection(other_paths):
        raise ValueError("范围外项目仍引用同一物理附件，拒绝删除")
    db.execute(delete(models.SubmissionFile).where(models.SubmissionFile.submission_id.in_(sub_ids)))
    db.execute(models.Task.__table__.update().where(models.Task.id.in_(task_ids)).values(linked_task_id=None))
    # Metadata order accounts for expenses -> budgets/files and submissions -> tasks.
    for table in reversed(models.Base.metadata.sorted_tables):
        if table.name != "projects" and "project_id" in table.c:
            db.execute(table.delete().where(table.c.project_id.in_(ids)))
    property_ids = [project.property_id for project in projects]
    db.execute(delete(models.Project).where(models.Project.id.in_(ids)))
    for property_id in property_ids:
        if db.scalar(select(models.Project.id).where(models.Project.property_id == property_id).limit(1)):
            continue
        for table in reversed(models.Base.metadata.sorted_tables):
            if table.name != "projects" and "property_id" in table.c:
                db.execute(table.delete().where(table.c.property_id == property_id))
        db.execute(delete(models.Property).where(models.Property.id == property_id))
    db.expire_all()
    return paths


def _pdf(label: str) -> bytes:
    content = f"BT /F1 16 Tf 40 740 Td (SYNTHETIC TEAM DEMO) Tj 0 -28 Td /F1 11 Tf ({label}) Tj 0 -24 Td (Not a real contract, receipt, approval or payment.) Tj ET".encode("ascii")
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
               b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
               b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"\nendstream"]
    out = bytearray(b"%PDF-1.4\n"); offsets = [0]
    for number, obj in enumerate(objects, 1):
        offsets.append(len(out)); out.extend(f"{number} 0 obj\n".encode() + obj + b"\nendobj\n")
    start = len(out)
    out.extend(f"xref\n0 {len(objects)+1}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]: out.extend(f"{offset:010d} 00000 n \n".encode())
    out.extend(f"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n".encode())
    return bytes(out)


def _make_project(db: Session, index: int, scope: str, team: dict, as_of: date, folder: Path) -> models.Project:
    day = lambda offset: (as_of + timedelta(days=offset)).isoformat()
    timestamp = lambda offset: f"{day(offset)}T10:00:00+00:00"
    current_stage = ("s1", "s3", "s5")[index]
    purchase_offset, start_offset = -130 - index * 20, -90 - index * 10
    final_offset = -3 if index == 1 else -35
    def previous_completion(key):
        stage_key = STEP_STAGE[key]
        if int(stage_key[1:]) >= int(current_stage[1:]): return None
        if stage_key == "s1": return purchase_offset - 10
        if stage_key == "s2": return purchase_offset - 2
        if stage_key == "s3":
            return start_offset - 2 if key in {"design_final", "permit_apply", "prep_work", "permit_issued"} else final_offset - 1
        return -29  # Staging/agent records precede listing at -28.
    names = ("Cedar · 买房与过户", "Oak · 装修与 Final 复检", "Pine · 卖房与服务收尾")
    prop = models.Property(address_std=f"SYNTHETIC DEMO ONLY — {101 + index} Team Demo Way", city="Demo City", state="MO", zip="00000",
                           apn=f"TEAM-DEMO:{scope}:{index}", sqft=1600 + index * 180, lot_sqft=7400 + index * 900,
                           beds=3, baths_full=2, year_built=1988 + index, created_at=timestamp(-240))
    db.add(prop); db.flush()
    db.add(models.PropertyFieldSource(property_id=prop.id, field="lot_sqft", value=str(prop.lot_sqft),
                                      source="demo", fetched_at=timestamp(-240), is_primary=True,
                                      note="合成演示地块面积，非真实房产资料"))
    project = models.Project(property_id=prop.id, name=f"[团队演示] {names[index]}", stage="active", substage="construction",
        purchase_price=240000 + index * 30000, target_arv=390000 + index * 30000,
        purchase_date=day(purchase_offset) if index else None,
        construction_start=day(start_offset) if index else None, construction_end=day(35 if index == 0 else -3 if index == 1 else -33),
        list_date=day(-28) if index == 2 else None, sale_date=None,
        sale_price=None, risks="合成演示：核对资料、现场与工期；不代表真实房产风险。",
        notes=f"TEAM-DEMO:{scope}:v1 — 全部房屋、金额、附件与历史为合成；历史回填绑定当前账号，不声称这些账号曾真实执行。", created_at=timestamp(-240), updated_at=timestamp(-1))
    db.add(project); db.flush()
    for user in team.values():
        db.add(models.ProjectMember(project_id=project.id, user_id=user.id, role_snapshot=user.role_code,
                                    added_by_user_id=team["jessie"].id, added_at=timestamp(-230)))
    files_by_step = {}
    def file(doc_type, slot="admin", key=None, amount=None):
        actor = team[slot].role_code
        if not _can_touch(actor, doc_type, key):
            raise ValueError("生成计划包含角色无权上传的资料")
        image = doc_type == "photo"
        completed = previous_completion(key) if key else None
        file_offset = completed - 5 if completed is not None else -5
        label = f"Demo project {index+1} / {doc_type} / {key or 'general'}"
        body = (f'<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 960 600"><rect width="960" height="600" fill="#edf1f5"/><path d="M180 300L480 100L780 300V510H180Z" fill="none" stroke="#233448" stroke-width="8"/><text x="40" y="560" font-size="26">SYNTHETIC DEMO EVIDENCE — {key}</text></svg>').encode() if image else _pdf(label)
        record = models.ProjectFile(project_id=project.id, filename=f"合成_{doc_type}_{key or '资料'}.{'svg' if image else 'pdf'}", stored_path="",
            mime="image/svg+xml" if image else "application/pdf", size=len(body), doc_type=doc_type, stage=FILE_STAGE.get(doc_type, "通用"),
            doc_date=day(file_offset), amount=amount, source="demo", uploaded_by=actor, step_key=key,
            expires_at=day(12 if index == 1 else 300) if doc_type == "insurance" else None,
            extracted_text=f"合成资料。{label}。仅用于核对路径，不是真实现场、合同、发票或银行付款。", uploaded_at=timestamp(file_offset))
        db.add(record); db.flush()
        target = folder / str(project.id) / f"{record.id}.{'svg' if image else 'pdf'}"
        target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(body)
        record.stored_path = str(target)
        if key: files_by_step[key] = record
        db.add(models.ProjectUpdate(project_id=project.id, actor=actor, kind="file", text=f"合成演示：上传 {record.filename}", created_at=timestamp(file_offset)))
        return record
    for key, slot in TEMPLATE_OWNER.items():
        item = STEP_BY_KEY[key]
        dv = item.get("deliverable", {})
        if dv.get("kind") in {"file", "photo"}:
            # Late-stage material is still available for browsing; progression is governed by gates.
            file(dv.get("doc_type", "photo"), slot, key)
    for doc_type in ("purchase_contract", "closing_statement", "offer", "sale_closing"):
        file(doc_type, "david")
    invoice = file("invoice", "sabrina", amount=1250)
    budgets = [("厨房", 18000), ("卫浴", 12000), ("许可与设计", 5000), ("持有成本", 6500), ("施工人工", 30000)]
    for category, planned in budgets:
        budget = models.BudgetLine(project_id=project.id, category=category, planned_amount=planned, note="合成分类预算")
        db.add(budget); db.flush()
        for part in range(2):
            db.add(models.Expense(project_id=project.id, budget_line_id=budget.id, category=category, amount=round(planned * (0.12 + index * 0.09 + part * 0.04), 2),
                date=day(-9 + part * 3), vendor=f"Demo {category} vendor", note="合成支出登记；不代表付款台账", file_id=invoice.id if part == 0 else None))
    for item_index, item in enumerate(ensure_procurement(db, project.id, commit=False)):
        item.status = "received" if index == 2 or (index == 1 and item.wave == "before_rough") else ("pending_spec", "ordered", "exception", "pending_order")[item_index % 4]
        item.updated_by = team["tristin" if item_index % 2 == 0 else "jeremy"].role_code
        item.note = "合成：尺寸/交期需跟进；实际到货不以预计日期替代" if item.status == "exception" else "合成采购记录"
    for kind in ("water", "electric", "gas"):
        state = "pending" if index == 0 and kind == "gas" else "off" if index == 2 and kind != "gas" else "on"
        db.add(models.UtilityAccount(project_id=project.id, kind=kind, company=f"Demo {kind} services", account_no=f"DEMO-{index+1}-{kind}",
            status=state, blocker="等待燃气服务公司回复" if kind == "gas" and index != 1 else None, updated_by=team["kody"].role_code,
            updated_at=timestamp(-1), opened_under="Synthetic Demo Company"))
    inspection_examples = (("买入前现场检查预约", "scheduled", 2, False),) if index == 0 else (
        ("框架检查", "passed", -50, False), ("City Final 首次记录", "passed", -10 if index == 1 else -40, True),
        ("City Final 最近记录", "failed" if index == 1 else "passed", final_offset, True))
    for name, result, offset, final in inspection_examples:
        db.add(models.Inspection(project_id=project.id, name=f"合成 {name}", result=result, date=day(offset), is_final=final,
            fixer="现场承包商（合成）" if result == "failed" else None, note="合成检查；最近 Final 失败时即使 D/J 曾确认仍不得过门", recorded_by=team["zoey"].role_code, created_at=timestamp(offset)))
    inputs = build_prefill(sqft=prop.sqft, avm_value=None, list_price=None, annual_tax=None,
                          purchase_price=project.purchase_price, target_arv=project.target_arv)
    analysis_completion = previous_completion("analysis")
    analysis_offset = analysis_completion - 5 if analysis_completion is not None else -8
    db.add(models.DealAnalysis(project_id=project.id, name="合成当前测算", inputs_json=json.dumps(inputs), outputs_json=json.dumps(full_outputs(inputs)), created_at=timestamp(analysis_offset), updated_at=timestamp(analysis_offset)))
    gates = [] if index == 0 else ["open_escrow", "close_escrow", "start", "final"]
    if index == 2: gates += ["offer"]
    for key in gates:
        gate_offset = {"open_escrow": purchase_offset - 7, "close_escrow": purchase_offset,
                       "start": start_offset, "final": -4 if index == 1 else -34, "offer": -7}[key]
        for slot, code in (("david", "D"), ("jessie", "J")):
            db.add(models.ProjectStep(project_id=project.id, key=f"{key}:{code}", done=True, done_by=code, done_at=timestamp(gate_offset),
                note=f"合成历史；真实账号 ID {team[slot].id} 对应 {code}"))
    if index == 2:
        db.add(models.ProjectStep(project_id=project.id, key="agent", done=True, done_by="J", done_at=timestamp(-30), note="合成 listing agent 已选定"))
    db.flush(); db.expire(project)
    steps = compute_steps(db, project)
    if steps["current_stage"]["key"] != current_stage:
        raise ValueError("演示节点与既有阶段规则不一致")
    sync_legacy_stage(db, project, steps)
    tasks = ensure_tasks(db, project.id, commit=False)
    for task in tasks:
        slot = TEMPLATE_OWNER.get(task.step_key, "jessie")
        if task.step_key == "purchase" and index == 1: slot = "jeremy"
        task.assignee_user_id = team[slot].id
        task.reviewer_user_id = team["david" if slot == "jessie" else "jessie"].id
        task.created_by_user_id = team["jessie"].id
        task.due_at = day(7)
        task.description = "合成演示的模板任务；按现有交付要求提交，不替代关键节点或证据判定。"
        task.deliverable_note = "查看本项目已准备的合成资料，补充本次说明。"
    for slot, user in team.items():
        for part, title in enumerate(EXTRA_TITLES[slot]):
            task = models.Task(project_id=project.id, source="adhoc", stage_key=current_stage, title=title,
                description="合成的当前阶段职责事项。核对现有资料，说明结果、缺口与下一动作。", deliverable_note="提交文字说明；如引用文件，只能选择本项目中你有权读取的资料。",
                assignee_user_id=user.id, reviewer_user_id=team["admin" if slot == "jessie" else "jessie"].id,
                created_by_user_id=team["jessie"].id, due_at=day(-1 if part else 3), created_at=timestamp(-12))
            db.add(task); db.flush(); tasks.append(task)
    # All eight people have a current-stage active item, a waiting item, a review and a returned example across the three houses.
    for task_index, task in enumerate(tasks):
        owner = db.get(models.User, task.assignee_user_id)
        reviewer = db.get(models.User, task.reviewer_user_id)
        completion = previous_completion(task.step_key) if task.source == "template" else None
        assigned_offset = completion - 12 if completion is not None else -12
        started_offset = completion - 8 if completion is not None else -8
        submitted_offset = completion - 3 if completion is not None else -3
        decided_offset = completion if completion is not None else -1
        task.created_at = timestamp(assigned_offset)
        if completion is not None: task.due_at = day(completion + 1)
        def event(kind, actor, offset, before=None, after=None, reason=None):
            db.add(models.TaskEvent(task_id=task.id, project_id=project.id, kind=kind, actor_user_id=actor.id, actor_role_snapshot=actor.role_code,
                before_json=json.dumps(before) if before else None, after_json=json.dumps(after) if after else None, reason=reason, created_at=timestamp(offset)))
        event("assigned", team["jessie"], assigned_offset, after={"assignee_user_id": owner.id, "reviewer_user_id": reviewer.id, "due_at": task.due_at})
        state = ("not_started", "in_progress", "waiting", "pending_review", "returned", "done")[task_index % 6]
        if task.source == "template" and int(task.stage_key[1:]) > int(current_stage[1:]):
            state = "not_started"
        if completion is not None: state = "done"
        if task.source == "adhoc":
            part = (task_index - 24) % 2
            state = (("in_progress", "pending_review"), ("waiting", "returned"), ("not_started", "pending_review"))[index][part]
        task.exec_status = "in_progress" if state == "returned" else state
        task.version = 1 if state == "not_started" else 2
        if state != "not_started": event("started", owner, started_offset, after={"exec_status": "in_progress"})
        if state == "waiting":
            task.wait_for = "外部服务商（合成）"; task.wait_reason = "等待对方核对资料和回复时间"; task.wait_until = day(2)
            task.version = 3
            event("waiting", owner, -2, after={"exec_status": "waiting", "wait_for": task.wait_for, "wait_reason": task.wait_reason, "wait_until": task.wait_until})
        if state in {"pending_review", "returned", "done"}:
            evidence = files_by_step.get(task.step_key)
            if evidence and not _can_download(owner.role_code, evidence):
                raise ValueError("生成计划中负责人无法访问交付文件")
            if (STEP_BY_KEY.get(task.step_key or "", {}).get("deliverable") or {}).get("kind") in {"file", "photo"} and not evidence:
                raise ValueError("文件型提交缺少合成附件")
            decision = "pending" if state == "pending_review" else "returned" if state == "returned" else "confirmed"
            sub = models.TaskSubmission(task_id=task.id, project_id=project.id, seq=1, note="合成交付：已核对附件与记录，请审核；不代表真实业务已完成。",
                submitted_by_user_id=owner.id, submitted_at=timestamp(submitted_offset), decision=decision,
                decided_by_user_id=reviewer.id if decision != "pending" else None, decided_at=timestamp(decided_offset) if decision != "pending" else None,
                decision_reason="合成退回：请补充日期与对应资料来源" if decision == "returned" else None)
            db.add(sub); db.flush()
            if evidence: db.add(models.SubmissionFile(submission_id=sub.id, file_id=evidence.id))
            event("submitted", owner, submitted_offset, before={"exec_status": "in_progress"},
                  after={"exec_status": "pending_review", "submission_id": sub.id, "seq": sub.seq, "files": int(evidence is not None)})
            if decision != "pending":
                event("returned" if decision == "returned" else "confirmed", reviewer, decided_offset, before={"exec_status": "pending_review"},
                      after={"exec_status": task.exec_status, "submission_id": sub.id, "seq": sub.seq}, reason=sub.decision_reason)
            task.version = 3 if decision == "pending" else 4
            if decision == "confirmed": task.done_at = timestamp(decided_offset)
        latest_offset = assigned_offset if state == "not_started" else -2 if state == "waiting" else submitted_offset if state == "pending_review" else decided_offset if state in {"returned", "done"} else started_offset
        task.updated_at = timestamp(latest_offset)
    db.add(models.ProjectUpdate(project_id=project.id, actor=team["admin"].role_code, kind="project", text="创建合成全员演示项目，含真实账号分派与可核验交付历史。", created_at=timestamp(-1)))
    return project


def prepare_demo(database: Path, uploads: Path, roster: object, admin_user_id: int, as_of: date, *, apply=False,
                 backup_dir: Path | None = None, replace_project_ids=(), scope="team-v1") -> dict:
    database, uploads = Path(database).resolve(), Path(uploads).resolve()
    if not database.is_file() or not re.fullmatch(r"[a-z0-9-]{1,40}", scope):
        raise ValueError("必须提供已初始化的 SQLite 数据库及合法 scope")
    ids = list(replace_project_ids)
    if any(type(value) is not int or value <= 0 for value in ids) or len(ids) != len(set(ids)):
        raise ValueError("替换范围必须为互不重复的正整数项目 ID")
    engine = create_engine(f"sqlite:///{database}", connect_args={"timeout": 30})
    run_folder = uploads / "team-demo" / scope / uuid4().hex
    old_paths = []
    try:
        with Session(engine) as db:
            team = resolve_team(db, roster, admin_user_id)
            existing = _owned(db, scope)
            existing_ids = {project.id for project in existing}
            if existing and (len(existing) != 3 or (existing_ids.intersection(ids) and not existing_ids.issubset(ids))):
                raise ValueError("已有演示范围不完整；只允许保留三套或显式同时替换三套")
            found = set(db.scalars(select(models.Project.id).where(models.Project.id.in_(ids))).all())
            if found != set(ids): raise ValueError("指定的替换项目不存在")
            if existing and not ids:
                expected_users = {user.id for user in team.values()}
                for project in existing:
                    members = set(db.scalars(select(models.ProjectMember.user_id).where(models.ProjectMember.project_id == project.id)).all())
                    if not expected_users.issubset(members):
                        raise ValueError("已有演示绑定的账号与当前名单不一致，需显式核对后替换")
                return {"mode": "unchanged", "project_ids": sorted(existing_ids), "users_changed": 0, "reason": "已有演示保留用户后续操作"}
            if existing and not existing_ids.issubset(ids):
                raise ValueError("已有本scope演示，替换其他项目时也须明确三套旧演示ID")
            plan = {"mode": "dry-run", "create_projects": 3, "template_tasks": 72, "current_role_tasks": 48,
                    "replace_project_ids": ids, "users_changed": 0, "assignee_ids": {slot: user.id for slot, user in team.items()}}
            if not apply: return plan
        if backup_dir is None: raise ValueError("--apply 必须提供 --backup-dir")
        backup = backup_and_verify(database, uploads, Path(backup_dir).resolve())
        with Session(engine) as db:
            db.execute(text("BEGIN IMMEDIATE"))
            team = resolve_team(db, roster, admin_user_id)
            # Serialize writers and re-check idempotency after the backup interval.
            current = {project.id for project in _owned(db, scope)}
            if current != existing_ids: raise ValueError("备份期间演示范围已变化，请重新核对")
            if ids: old_paths = _delete_projects(db, ids, uploads)
            projects = [_make_project(db, index, scope, team, as_of, run_folder) for index in range(3)]
            db.flush()
            project_ids = [project.id for project in projects]
            db.commit()
        removed = 0
        cleanup_failures = 0
        for path in set(old_paths):
            try:
                if path.is_file(): path.unlink(); removed += 1
            except OSError:
                cleanup_failures += 1
        return {**plan, "mode": "applied", "project_ids": project_ids, "backup": str(backup), "restore_verified": True,
                "removed_old_files": removed, "old_file_cleanup_failures": cleanup_failures}
    except Exception:
        # Only this attempt's fresh generated files; never remove existing uploads.
        if run_folder.exists(): shutil.rmtree(run_folder)
        raise
    finally:
        engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--uploads-dir", required=True, type=Path)
    parser.add_argument("--users-file", required=True, type=Path)
    parser.add_argument("--admin-user-id", required=True, type=int)
    parser.add_argument("--as-of", required=True, type=date.fromisoformat)
    parser.add_argument("--scope", default="team-v1")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--backup-dir", type=Path)
    parser.add_argument("--replace-project-ids", default="", help="仅填写已确认属于合成演示的项目ID，逗号分隔；不自动选择旧项目")
    args = parser.parse_args()
    try:
        roster = json.loads(args.users_file.read_text(encoding="utf-8"))
        ids = [int(value) for value in args.replace_project_ids.split(",") if value]
        result = prepare_demo(args.database, args.uploads_dir, roster, args.admin_user_id, args.as_of,
            apply=args.apply, backup_dir=args.backup_dir, replace_project_ids=ids, scope=args.scope)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except Exception:
        # Do not expose SQL parameters, roster values, credentials or hashes.
        print("演示准备未完成。请核对显式路径、账号/角色、替换ID和备份条件；未输出名单或数据库参数。", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
