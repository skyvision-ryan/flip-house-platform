"""Ordinary task display follows the same evidence rules as the property roadmap.

No GET writes, no bulk history rewrite, no new notification system. Mutation routes
capture before changing evidence and commit the resulting TaskEvents atomically.
"""
import json
from sqlalchemy import select, update
from . import models
from .dictionaries import STEP_BY_KEY
from .steps import compute_steps

# These requirements prove a current record, not that continuing work has ended.
CONTINUING = frozenset({"prep_work", "progress", "mow", "inspections"})


def completion_mode(task):
    item = STEP_BY_KEY.get(task.step_key or "")
    if task.source != "template" or not item or item.get("gate") or task.step_key == "purchase":
        return "review"  # compatibility only; gates and procurement keep their own branches
    return "record" if task.step_key in CONTINUING else "evidence"


def execution_status(task, met):
    mode = completion_mode(task)
    if mode == "evidence" and met:
        return "done"
    if mode in {"record", "evidence"}:
        if task.exec_status in {"done", "pending_review"}:
            return "in_progress" if met else "not_started"
        if mode == "record" and met and task.exec_status == "not_started":
            return "in_progress"
    return task.exec_status


def capture_evidence(db, project_id):
    p = db.get(models.Project, project_id)
    if p is None:
        return {}
    steps = {item["key"]: item for stage in compute_steps(db, p, hide_money=True)["stages"] for item in stage["items"]}
    return {t.id: {"met": bool(steps[t.step_key]["done"]), "mode": completion_mode(t), "key": t.step_key}
            for t in db.scalars(select(models.Task).where(models.Task.project_id == project_id))
            if completion_mode(t) != "review" and t.step_key in steps}


def commit_evidence(db, project_id, before, actor=None):
    """Flush facts, refresh relationship evidence, deduplicate transitions, commit together."""
    db.flush()
    p = db.get(models.Project, project_id)
    if p is not None:
        db.expire(p, ["files", "utilities", "inspections", "analyses"])
        after = capture_evidence(db, project_id)
        dialect = db.bind.dialect.name
        if dialect == "sqlite":
            from sqlalchemy.dialects.sqlite import insert
        elif dialect == "postgresql":
            from sqlalchemy.dialects.postgresql import insert
        else:
            raise RuntimeError("Unsupported evidence-state database dialect")
        for tid, value in after.items():
            baseline = before.get(tid, value)["met"]
            # The unique task key and conditional UPDATE run in the same transaction as facts.
            # Competing identical transitions can produce only one event.
            db.execute(insert(models.TaskEvidenceState).values(task_id=tid, met=baseline).on_conflict_do_nothing(index_elements=["task_id"]))
            changed = db.execute(update(models.TaskEvidenceState).where(
                models.TaskEvidenceState.task_id == tid, models.TaskEvidenceState.met != value["met"]
            ).values(met=value["met"], observed_at=models.now_iso()))
            if changed.rowcount and before.get(tid, value)["met"] != value["met"]:
                db.add(models.TaskEvent(task_id=tid, project_id=project_id,
                       kind="evidence_satisfied" if value["met"] else "evidence_missing",
                       actor_user_id=db.info.get("actor_user_id"),
                       actor_role_snapshot=actor, before_json=json.dumps({"met": not value["met"]}),
                       after_json=json.dumps(value)))
    db.commit()
