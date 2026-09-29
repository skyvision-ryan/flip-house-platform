"""One existing purchase task per house; material rows provide live delivery evidence."""
from fastapi import HTTPException
from sqlalchemy import select
from . import models
from .procurement_orders import order_material_projection, procurement_attention


def purchase_progress(db, project_id):
    rows = list(db.scalars(select(models.ProcurementItem).where(models.ProcurementItem.project_id == project_id)))
    projected = order_material_projection(db, rows)
    groups = {}
    for row in rows:
        group = groups.setdefault(row.wave, {"wave": row.wave, "total": 0, "ready": 0})
        status = projected.get(row.id, {}).get("status", row.status)
        group["total"] += status != "na"
        group["ready"] += status == "received"
    ready = sum(g["ready"] for g in groups.values())
    return {"total": sum(g["total"] for g in groups.values()), "ready": ready, "complete": bool(rows) and ready == sum(g["total"] for g in groups.values()), "excluded": sum(projected.get(r.id, {}).get("status", r.status) == "na" for r in rows), "nodes": list(groups.values())}


def require_purchase_assigned(db, project_id):
    task = db.scalar(select(models.Task).where(models.Task.project_id == project_id, models.Task.step_key == "purchase"))
    owner = db.get(models.User, task.assignee_user_id) if task and task.assignee_user_id else None
    member = db.scalar(select(models.ProjectMember.id).where(models.ProjectMember.project_id == project_id,
        models.ProjectMember.user_id == owner.id, models.ProjectMember.active.is_(True))) if owner else None
    from .routers.common import allowed
    if not owner or not owner.active or not member or not allowed(owner.role_code, "procurement"):
        raise HTTPException(409, "请先由 Jessie 分派本房采购任务给有效项目成员，再录入购买。")
    return task


def purchase_overview(db, project_id):
    """One house summary, money counted once per merchant order."""
    from decimal import Decimal
    from .purchase_orders import OrderDocument, order_summary
    progress = purchase_progress(db, project_id)
    rows = list(db.scalars(select(models.ProcurementItem).where(models.ProcurementItem.project_id == project_id)))
    projected = order_material_projection(db, rows)
    attention = procurement_attention(rows, projected)
    problems = [{'id': row.id, 'name': row.name, 'note': '；'.join(attention[row.id])}
                for row in rows if attention[row.id]]
    docs = [OrderDocument.model_validate_json(o.document) for o in db.scalars(select(models.PurchaseOrder).where(models.PurchaseOrder.project_id == project_id))]
    paid = sum((d.total for d in docs if d.total is not None), Decimal(0))
    refunds = sum((order_summary(d)['refund'] for d in docs), Decimal(0))
    task = db.scalar(select(models.Task).where(models.Task.project_id == project_id, models.Task.step_key == 'purchase'))
    owner = db.get(models.User, task.assignee_user_id) if task and task.assignee_user_id else None
    return {**progress, 'owner': owner.display_name if owner else None, 'spent': str(paid - refunds),
            'missing_totals': sum(d.total is None for d in docs), 'order_count': len(docs), 'problems': problems}
