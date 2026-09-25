from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..db import get_db
from ..dictionaries import SUBSTAGES, widget_allowed
from ..steps import compute_steps
from .common import budget_totals, can_read_money, get_actor

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def _bucket(steps: dict) -> str:
    """KAN-75 块 2：按分组位置分三桶——未购入 / 在建（escrow 中到卖房上市）/ 收尾。不再读旧 stage 列。"""
    gp = steps["group_position"]
    if gp["sub_key"] == "pre":
        return "leads"
    if gp["group_key"] == "closeout" or gp["complete"]:
        return "portfolio"
    return "active"


@router.get("/summary", response_model=schemas.DashboardSummary)
def summary(db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    projects = db.scalars(select(models.Project)).all()
    buckets = {p.id: _bucket(compute_steps(db, p, hide_money=True)) for p in projects}
    leads = sum(1 for b in buckets.values() if b == "leads")
    active = sum(1 for b in buckets.values() if b == "active")
    portfolio = sum(1 for b in buckets.values() if b == "portfolio")

    invested = 0.0
    budget = 0.0
    profit = 0.0
    over = 0
    incomplete = 0
    for p in projects:
        planned, spent = budget_totals(db, p.id)
        if buckets[p.id] == "active":
            invested += (p.purchase_price or 0) + spent
            budget += planned
            # KAN-71：买入价或目标售价缺任一项都不算这套房的利润。以前只看 ARV，
            # 买入价为空时 `or 0` 把成本当成 0，利润虚高。缺数的另计数，让界面说出来。
            if p.target_arv is not None and p.purchase_price is not None:
                profit += p.target_arv - p.purchase_price - max(planned, spent)
            else:
                incomplete += 1
            if planned > 0 and spent > planned * 1.05:
                over += 1
    if not can_read_money(actor):
        return schemas.DashboardSummary(leads=leads, active=active, portfolio=portfolio, total=len(projects), money_hidden=True)
    return schemas.DashboardSummary(
        leads=leads, active=active, portfolio=portfolio, total=len(projects),
        total_invested=invested, total_budget=budget, expected_profit=profit, over_budget_count=over,
        profit_incomplete_count=incomplete,
    )


DATE_KINDS = [("purchase_date", "买入"), ("construction_start", "开工"), ("construction_end", "计划完工"),
              ("list_date", "挂牌"), ("sale_date", "成交")]


@router.get("/widgets", response_model=schemas.DashboardWidgets)
def widgets(db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    """工作台小组件的数据：一次返回，全部来自现有表。看不到钱的身份，钱类块给空。"""
    today = date.today()
    projects = db.scalars(select(models.Project)).all()
    expenses = db.scalars(select(models.Expense)).all()

    spent_by: dict[int, float] = {}
    for e in expenses:
        spent_by[e.project_id] = spent_by.get(e.project_id, 0) + e.amount
    planned_by: dict[int, float] = {}
    for l in db.scalars(select(models.BudgetLine)).all():
        planned_by[l.project_id] = planned_by.get(l.project_id, 0) + l.planned_amount

    # 未来 30 天（含逾期 14 天内）的关键日期；已完成项目只看成交
    upcoming = []
    for p in projects:
        for field, label in DATE_KINDS:
            v = getattr(p, field)
            if not v:
                continue
            if p.stage == "portfolio" and field != "sale_date":
                continue
            try:
                d = date.fromisoformat(v)
            except ValueError:
                continue
            delta = (d - today).days
            if -14 <= delta <= 30:
                upcoming.append({"project_id": p.id, "project_name": p.name, "date": v, "kind": label, "days": delta,
                                 "overdue": delta < 0 and field in ("construction_end", "list_date")})
    # 有到期日的文件（保险）：到期前 30 天开始提醒，过期 14 天内还显示
    names = {p.id: p for p in projects}
    for f in db.scalars(select(models.ProjectFile).where(models.ProjectFile.expires_at.is_not(None))).all():
        p = names.get(f.project_id)
        if not p or p.stage == "portfolio":
            continue
        try:
            d = date.fromisoformat(f.expires_at)
        except ValueError:
            continue
        delta = (d - today).days
        if -14 <= delta <= 30:
            label = "保险到期" if f.doc_type == "insurance" else "文件到期"
            upcoming.append({"project_id": p.id, "project_name": p.name, "date": f.expires_at, "kind": label, "days": delta, "overdue": delta < 0})
    upcoming.sort(key=lambda x: x["date"])

    capital = [{"project_id": p.id, "project_name": p.name, "purchase_price": p.purchase_price or 0,
                "spent": round(spent_by.get(p.id, 0), 2), "total": round((p.purchase_price or 0) + spent_by.get(p.id, 0), 2)}
               for p in projects if p.stage == "active"]

    retrospectives = []
    for p in projects:
        if p.stage != "portfolio" or not p.sale_price:
            continue
        planned = planned_by.get(p.id, 0)
        spent = spent_by.get(p.id, 0)
        days = None
        if p.construction_start and p.construction_end:
            days = (date.fromisoformat(p.construction_end) - date.fromisoformat(p.construction_start)).days
        retrospectives.append({
            "project_id": p.id, "project_name": p.name,
            "target_arv": p.target_arv, "sale_price": p.sale_price,
            "arv_error_pct": round((p.sale_price - p.target_arv) / p.target_arv * 100, 1) if p.target_arv else None,
            "budget_planned": round(planned, 2), "spent": round(spent, 2),
            "budget_error_pct": round((spent - planned) / planned * 100, 1) if planned else None,
            "days": days,
            "profit": round(p.sale_price - (p.purchase_price or 0) - spent, 2),
        })

    # 近 12 周每周支出（周一归组）
    this_monday = today - timedelta(days=today.weekday())
    weeks = [this_monday - timedelta(weeks=i) for i in range(11, -1, -1)]
    buckets = {w.isoformat(): 0.0 for w in weeks}
    for e in expenses:
        if not e.date:
            continue
        try:
            d = date.fromisoformat(e.date)
        except ValueError:
            continue
        w = (d - timedelta(days=d.weekday())).isoformat()
        if w in buckets:
            buckets[w] += e.amount
    weekly_spend = [{"week_start": w, "amount": round(a, 2)} for w, a in buckets.items()]

    vend: dict[str, dict] = {}
    for e in expenses:
        if not e.vendor:
            continue
        v = vend.setdefault(e.vendor, {"vendor": e.vendor, "amount": 0.0, "count": 0, "projects": set()})
        v["amount"] += e.amount
        v["count"] += 1
        v["projects"].add(e.project_id)
    vendors = sorted(({**v, "amount": round(v["amount"], 2), "projects": len(v["projects"])} for v in vend.values()),
                     key=lambda x: -x["amount"])[:5]

    # 漏斗只数「买房 · 未购入」的房子，按人工档位分；判据是分组位置，不是旧 stage 列（KAN-75 块 2）
    counts: dict[str, int] = {}
    for p in projects:
        if compute_steps(db, p, hide_money=True)["group_position"]["sub_key"] == "pre":
            counts[p.substage or "new_lead"] = counts.get(p.substage or "new_lead", 0) + 1
    funnel = [{"substage": s["value"], "label": s["label"], "count": counts.get(s["value"], 0)} for s in SUBSTAGES["lead"]]

    if not can_read_money(actor):
        capital, retrospectives, weekly_spend, vendors = [], [], [], []
    return schemas.DashboardWidgets(upcoming=upcoming, capital=capital, retrospectives=retrospectives,
                                    weekly_spend=weekly_spend, vendors=vendors, funnel=funnel)


# ---------------- 按身份的专属块 ----------------
_STATUS_BAD = {"failed"}


def _brief(p: models.Project) -> dict:
    return {"project_id": p.id, "project_name": p.name, "address": p.property.address_std, "stage": p.stage}


@router.get("/role", response_model=schemas.DashboardRole)
def role_widgets(db: Session = Depends(get_db), actor: str = Depends(get_actor)):
    """一次返回这个身份能看的专属小组件数据。每块只在 widget_allowed 时计算。"""
    today = date.today()
    projects = db.scalars(select(models.Project).order_by(models.Project.updated_at.desc())).all()
    hide = not can_read_money(actor)
    out: dict = {}

    need_steps = any(widget_allowed(actor, w) for w in ("gates", "mytodo"))
    steps_by: dict[int, dict] = {}
    if need_steps:
        for p in projects:
            steps_by[p.id] = compute_steps(db, p, hide_money=hide)

    if widget_allowed(actor, "gates"):
        gates = []
        for p in projects:
            st = steps_by[p.id]
            cur_idx = len(st["stages"]) if st["current_stage"]["key"] == "done" else next((i for i, s in enumerate(st["stages"]) if s["key"] == st["current_stage"]["key"]), 0)
            for si, stage in enumerate(st["stages"]):
                if p.stage != "portfolio" and si > cur_idx:
                    continue
                for it in stage["items"]:
                    overseer = actor in ("老板", "负责人")   # 盯的人看所有等确认的门
                    if it["gate"] and not it["done"] and (overseer or (actor in it["confirm"] and actor not in it["confirmed"])):
                        gates.append({**_brief(p), "key": it["key"], "title": it["title"], "stage": stage["label"],
                                      "evidence_hint": it["evidence_hint"], "confirmed": it["confirmed"],
                                      "waiting": [c for c in it["confirm"] if c not in it["confirmed"]], "is_current": si == cur_idx})
        gates.sort(key=lambda g: (not g["is_current"], g["project_name"]))
        out["my_gates"] = gates

    if widget_allowed(actor, "mytodo"):
        todo = []
        for p in projects:
            st = steps_by[p.id]
            cur_idx = len(st["stages"]) if st["current_stage"]["key"] == "done" else next((i for i, s in enumerate(st["stages"]) if s["key"] == st["current_stage"]["key"]), 0)
            for si, stage in enumerate(st["stages"]):
                if p.stage != "portfolio" and si > cur_idx:
                    continue
                for it in stage["items"]:
                    if it["done"]:
                        continue
                    mine_tick = actor in it["owners"]
                    mine_confirm = actor in it["confirm"] and actor not in it["confirmed"]
                    if mine_tick or mine_confirm:
                        todo.append({"project": _brief(p), "stage": stage["label"], "item": it,
                                     "is_current": (p.stage != "portfolio") and si == cur_idx,
                                     "for_confirm": mine_confirm and (it["gate"] or not mine_tick)})
        todo.sort(key=lambda r: (not r["is_current"], r["project"]["project_name"]))
        out["my_todo"] = todo

    active = [p for p in projects if p.stage == "active"]

    if widget_allowed(actor, "procurement"):
        rows = []
        for p in active:
            items = p.procurement_items
            if not items:
                continue
            exc = [i.name for i in items if i.status == "exception"]
            po = [i.name for i in items if i.status == "pending_order"]
            spec = sum(1 for i in items if i.status == "pending_spec")
            if exc or po:
                rows.append({**_brief(p), "exception": exc, "pending_order": po, "pending_spec_count": spec})
        out["procurement_alerts"] = rows

    if widget_allowed(actor, "site"):
        rows = []
        for p in active:
            photos = sorted([f for f in p.files if f.step_key == "progress" and (f.mime or "").startswith("image/")], key=lambda f: f.uploaded_at, reverse=True)[:3]
            insp = sorted(p.inspections, key=lambda i: (i.date or "", i.id))
            last = insp[-1] if insp else None
            rows.append({**_brief(p), "photo_ids": [f.id for f in photos], "photo_count": len([f for f in p.files if f.step_key == "progress"]),
                         "last_inspection": ({"name": last.name, "result": last.result, "date": last.date} if last else None),
                         "failed": [i.name for i in insp if i.result == "failed"]})
        out["site"] = rows

    if widget_allowed(actor, "utilities"):
        rows = []
        for p in [x for x in projects if x.stage != "lead"]:
            by = {u.kind: u for u in p.utilities}
            ins = sorted([f for f in p.files if f.doc_type == "insurance"], key=lambda f: f.uploaded_at)
            exp = ins[-1].expires_at if ins else None
            days = None
            if exp:
                try:
                    days = (date.fromisoformat(exp) - today).days
                except ValueError:
                    days = None
            rows.append({**_brief(p), "water": by.get("water").status if by.get("water") else "not_started",
                         "electric": by.get("electric").status if by.get("electric") else "not_started",
                         "gas": by.get("gas").status if by.get("gas") else "not_started",
                         "blocker": next((u.blocker for u in p.utilities if u.blocker), None),
                         "insurance_expires": exp, "insurance_days": days})
        out["utilities_insurance"] = rows

    if widget_allowed(actor, "permits"):
        rows = []
        for p in active:
            issued = any(f.doc_type == "permit" for f in p.files)
            applied = sorted([f for f in p.files if f.doc_type == "permit_application"], key=lambda f: f.uploaded_at)
            applied_days = None
            if applied and not issued and applied[-1].doc_date:
                try:
                    applied_days = (today - date.fromisoformat(applied[-1].doc_date)).days
                except ValueError:
                    applied_days = None
            insp = sorted(p.inspections, key=lambda i: (i.date or "", i.id))
            nxt = next((i for i in insp if i.result == "scheduled"), None)
            rows.append({**_brief(p), "permit": "issued" if issued else ("applied" if applied else "none"), "applied_days": applied_days,
                         "next_inspection": ({"name": nxt.name, "date": nxt.date} if nxt else None),
                         "failed": [i.name for i in insp if i.result == "failed"],
                         "final_passed": any(i.is_final and i.result == "passed" for i in insp)})
        out["permits"] = rows

    if widget_allowed(actor, "design"):
        rows = []
        for p in [x for x in projects if x.stage != "portfolio"]:
            types = {f.doc_type for f in p.files}
            rows.append({**_brief(p), "drawing": "drawing" in types, "drawing_final": "drawing_final" in types, "measure_note": "measure_note" in types})
        out["design"] = rows

    if widget_allowed(actor, "saledocs"):
        rows = []
        for p in [x for x in projects if (steps_by.get(x.id) or compute_steps(db, x, hide_money=hide))["group_position"]["group_key"] in ("prelisting", "selling")]:
            types = {f.doc_type for f in p.files}
            rows.append({**_brief(p), "list_date": p.list_date, "offer": "offer" in types, "sale_docs": "sale_docs" in types,
                         "disclosure": "seller_disclosure" in types, "sale_signed": "sale_signed" in types, "sale_closing": "sale_closing" in types})
        out["sale_docs"] = rows

    if widget_allowed(actor, "boss") and not hide:
        invested = 0.0; expected = 0.0; realized = 0.0; over = 0; incomplete = 0
        for p in projects:
            planned, spent = budget_totals(db, p.id)
            if p.stage == "active":
                invested += (p.purchase_price or 0) + spent
                # 同 /summary：缺任一金额不算利润，另计数（KAN-71）
                if p.target_arv is not None and p.purchase_price is not None:
                    expected += p.target_arv - p.purchase_price - max(planned, spent)
                else:
                    incomplete += 1
                if planned > 0 and spent > planned * 1.05:
                    over += 1
            elif p.stage == "portfolio" and p.sale_price:
                realized += p.sale_price - (p.purchase_price or 0) - spent
        out["boss"] = {"active": len(active), "leads": sum(1 for p in projects if p.stage == "lead"),
                       "portfolio": sum(1 for p in projects if p.stage == "portfolio"),
                       "total_invested": round(invested, 2), "expected_profit": round(expected, 2), "realized_profit": round(realized, 2), "over_budget_count": over,
                       "profit_incomplete_count": incomplete}

    return schemas.DashboardRole(**out)
