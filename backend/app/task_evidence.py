"""Ordinary task evidence and completion: pure reads, transactional fact revisions."""
from sqlalchemy import select, update
from . import models
from .dictionaries import STEP_BY_KEY
CONTINUING=frozenset({'prep_work','progress','mow','inspections'})


def completion_mode(task):
    item=STEP_BY_KEY.get(task.step_key or '')
    if task.source!='template' or not item or item.get('gate') or task.step_key=='purchase' or item.get('evidence')=='manual':
        return 'review'
    return 'record' if task.step_key in CONTINUING else 'evidence'


def execution_status(task,met,review=None):
    mode=completion_mode(task)
    if mode=='evidence':
        if review and review['valid']:return 'done'
        if met or (review and review['state']=='recheck'):return 'pending_review'
    if mode in {'record','evidence'}:
        if task.exec_status in {'done','pending_review'}:return 'in_progress' if met else 'not_started'
        if mode=='record' and met and task.exec_status=='not_started':return 'in_progress'
    return task.exec_status


def capture_evidence(db,project_id):
    from .evidence_review import fact_snapshot
    p=db.get(models.Project,project_id)
    if p is None:return {}
    return {t.id:{**fact_snapshot(p,t.step_key),'mode':completion_mode(t),'key':t.step_key}
            for t in db.scalars(select(models.Task).where(models.Task.project_id==project_id)) if completion_mode(t)!='review'}


def commit_evidence(db,project_id,before,actor=None):
    from .evidence_review import observe_changes
    if actor is None and db.info.get('actor_user_id'):
        user=db.get(models.User,db.info['actor_user_id']);actor=user.role_code if user else None
    db.flush()
    p=db.get(models.Project,project_id)
    if p:
        db.expire(p,['files','utilities','inspections','analyses'])
        after=capture_evidence(db,project_id)
        observe_changes(db,project_id,before,after,actor)
        if db.bind.dialect.name=='sqlite':
            from sqlalchemy.dialects.sqlite import insert
        else:
            from sqlalchemy.dialects.postgresql import insert
        import json
        from .task_activity import utc_now
        for tid,value in after.items():
            if value['mode']!='record':continue
            baseline=before.get(tid,value)['met']
            db.execute(insert(models.TaskEvidenceState).values(task_id=tid,met=baseline).on_conflict_do_nothing(index_elements=['task_id']))
            changed=db.execute(update(models.TaskEvidenceState).where(models.TaskEvidenceState.task_id==tid,models.TaskEvidenceState.met!=value['met']).values(met=value['met'],observed_at=utc_now()))
            if changed.rowcount and baseline!=value['met']:
                db.add(models.TaskEvent(task_id=tid,project_id=project_id,kind='evidence_satisfied' if value['met'] else 'evidence_missing',actor_user_id=db.info.get('actor_user_id'),actor_role_snapshot=actor,after_json=json.dumps({'mode':'record','met':value['met']}),created_at=utc_now()))
    db.commit()
