"""Versioned evidence receipts. Facts, current task completion and phase gates are separate.

Reads are pure. Only authorized fact mutations, mark and startup baseline write rows.
File IDs identify immutable uploads; metadata included here can change the evidence meaning.
"""
import hashlib
import json
from sqlalchemy import select, update
from . import models
from .dictionaries import STEP_BY_KEY
from .task_activity import utc_now


def dumps(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def analysis_facts(value):
    if isinstance(value,dict):
        return {k:analysis_facts(v) for k,v in value.items() if k not in {'note','sources','name_template'}}
    if isinstance(value,list):return [analysis_facts(v) for v in value]
    return value


def fact_snapshot(p, key):
    from .steps import _evidence
    rule = STEP_BY_KEY.get(key or "", {}).get("evidence", "")
    facts = {}
    for alt in rule.split("|"):
        kind, _, arg = alt.partition(":")
        if kind == "field":
            facts[alt] = getattr(p, arg, None)
        elif kind in {"file", "photo"}:
            files = [f for f in p.files if (f.doc_type == arg if kind == "file" else f.step_key == arg and (f.mime or "").startswith("image/"))]
            facts[alt] = [{"id": f.id, "path": f.stored_path, "size": f.size, "mime": f.mime,
                           "doc_type": f.doc_type, "step_key": f.step_key, "doc_date": f.doc_date,
                           "expires_at": f.expires_at, "amount": f.amount, "counterparty": f.counterparty}
                          for f in sorted(files, key=lambda f: f.id)]
        elif kind == "analysis":
            # A newer analysis or changed inputs/outputs are substantive; names and notes are not.
            current = [a for a in p.analyses if a.is_current] or list(p.analyses)
            a = max(current, key=lambda a: a.id, default=None)
            facts[alt] = {"id": a.id, "inputs": analysis_facts(json.loads(a.inputs_json)), "outputs": analysis_facts(json.loads(a.outputs_json))} if a else None
        elif kind == "utilities":
            facts[alt] = [{"id":u.id,"kind":u.kind,"status":u.status}
                          for u in sorted(p.utilities,key=lambda u:u.id)]
        elif kind == "inspections":
            facts[alt] = [{"id":i.id,"date":i.date,"result":i.result,"is_final":i.is_final}
                          for i in sorted(p.inspections,key=lambda i:i.id)]
    met = _evidence(rule, p)[0]
    snapshot = {"rule":rule,"met":met,"facts":facts}
    return {"met":met,"fingerprint":hashlib.sha256(dumps(snapshot).encode()).hexdigest(),"snapshot":snapshot}


def can_access(db, task, actor, snapshot=None):
    from .common_access import activity_allowed
    from .routers.files import _can_download
    from .routers.common import can_read_money
    if not activity_allowed(task, actor):
        return False
    p = db.get(models.Project, task.project_id)
    if p is None:
        return False
    facts = (snapshot or fact_snapshot(p, task.step_key))["snapshot"]["facts"]
    if not can_read_money(actor) and any(f.get('amount') is not None for key,value in facts.items() if key.startswith(('file:','photo:')) for f in value):
        return False
    ids = {f["id"] for key, value in facts.items() if key.startswith(("file:", "photo:")) for f in value}
    return all((file := db.get(models.ProjectFile, fid)) is not None and _can_download(actor,file) for fid in ids)


def current(db, task, p=None):
    """A returned/reopened task or an invalidated receipt can never reappear as complete."""
    p = p or db.get(models.Project, task.project_id)
    value = fact_snapshot(p, task.step_key)
    version = db.get(models.TaskEvidenceVersion, task.id)
    revision = version.revision if version and version.fingerprint == value["fingerprint"] else (version.revision + 1 if version else 0)
    receipt = db.scalar(select(models.TaskEvidenceReview).where(models.TaskEvidenceReview.task_id==task.id).order_by(models.TaskEvidenceReview.id.desc()))
    valid = bool(receipt and receipt.invalidated_at is None and receipt.fingerprint == value["fingerprint"] and receipt.revision == revision and value["met"])
    return {**value,"revision":revision,"receipt":receipt,"valid":valid,
            "state":"reviewed" if valid else "recheck" if receipt else "pending" if value["met"] else "missing"}


def initialize(db, dry_run=False):
    """Additive baseline: never stamp old auto-satisfaction as a new workflow event."""
    from .task_evidence import completion_mode
    report={"new_versions":0,"historical_reviews_verified":0,"historical_reviews_unverified":0,"evidence_met_pending":0,"old_rows_changed":0}
    for p in db.scalars(select(models.Project)):
        for t in db.scalars(select(models.Task).where(models.Task.project_id==p.id)):
            if completion_mode(t)!="evidence" or db.get(models.TaskEvidenceVersion,t.id):
                continue
            value=fact_snapshot(p,t.step_key)
            report["new_versions"]+=1
            if value["met"]:report["evidence_met_pending"]+=1
            if not dry_run:db.add(models.TaskEvidenceVersion(task_id=t.id,revision=0,fingerprint=value["fingerprint"],met=value["met"]))
            # Legacy file links prove identity, but not the metadata/facts seen by the reviewer.
            # Require an actual stored fact fingerprint; never infer it from today's files.
            sub=db.scalar(select(models.TaskSubmission).where(models.TaskSubmission.task_id==t.id).order_by(models.TaskSubmission.seq.desc(),models.TaskSubmission.id.desc()))
            file_ids={f["id"] for k,v in value["snapshot"]["facts"].items() if k.startswith(("file:","photo:")) for f in v}
            links=set(db.scalars(select(models.SubmissionFile.file_id).where(models.SubmissionFile.submission_id==sub.id))) if sub else set()
            event=db.scalar(select(models.TaskEvent).where(models.TaskEvent.task_id==t.id,models.TaskEvent.kind=='confirmed').order_by(models.TaskEvent.id.desc()))
            recorded=json.loads(event.after_json or '{}') if event else {}
            human=bool(t.exec_status=="done" and sub and sub.decision=="confirmed" and sub.decided_at and sub.decided_by_user_id and db.get(models.User,sub.decided_by_user_id))
            verified=bool(human and value['met'] and file_ids and file_ids==links and event and event.actor_user_id==sub.decided_by_user_id and recorded.get('evidence_fingerprint')==value['fingerprint'])
            if human and not verified:report['historical_reviews_unverified']+=1
            if verified:
                report["historical_reviews_verified"]+=1;report["evidence_met_pending"]-=1
                if not dry_run:db.add(models.TaskEvidenceReview(task_id=t.id,revision=0,fingerprint=value["fingerprint"],facts_json=dumps(value["snapshot"]),reviewer_user_id=sub.decided_by_user_id,reviewed_at=sub.decided_at,request_key=f'legacy-submission-{sub.id}',source='historical_submission'))
    if not dry_run:db.commit()
    return report


def ensure_version(db, tid, before):
    if db.bind.dialect.name=="sqlite":
        from sqlalchemy.dialects.sqlite import insert
    else:
        from sqlalchemy.dialects.postgresql import insert
    db.execute(insert(models.TaskEvidenceVersion).values(task_id=tid,revision=0,fingerprint=before['fingerprint'],met=before['met']).on_conflict_do_nothing(index_elements=['task_id']))


def observe_changes(db, project_id, before, after, actor):
    for tid,value in after.items():
        if value['mode']!='evidence':continue
        baseline=before.get(tid,value)
        ensure_version(db,tid,baseline)
        version=db.get(models.TaskEvidenceVersion,tid)
        if version.fingerprint==value['fingerprint']:continue
        # Conditional update both serializes concurrent marks and deduplicates identical facts.
        revision=version.revision
        previously_met=version.met
        changed=db.execute(update(models.TaskEvidenceVersion).where(models.TaskEvidenceVersion.task_id==tid,models.TaskEvidenceVersion.revision==revision,models.TaskEvidenceVersion.fingerprint==version.fingerprint).values(revision=revision+1,fingerprint=value['fingerprint'],met=value['met']))
        if not changed.rowcount:continue
        previous=db.scalar(select(models.TaskEvidenceReview).where(models.TaskEvidenceReview.task_id==tid,models.TaskEvidenceReview.invalidated_at.is_(None)))
        if previous:
            previous.invalidated_at=utc_now()
            db.add(models.TaskEvent(task_id=tid,project_id=project_id,kind='evidence_invalidated',actor_user_id=db.info.get('actor_user_id'),actor_role_snapshot=actor,before_json=dumps({'review_id':previous.id,'revision':revision}),after_json=dumps({'revision':revision+1,'met':value['met'],'mode':'evidence'}),created_at=utc_now()))
        elif baseline['fingerprint']!=value['fingerprint'] and baseline['met']!=value['met'] and previously_met!=value['met']:
            db.add(models.TaskEvent(task_id=tid,project_id=project_id,kind='evidence_satisfied' if value['met'] else 'evidence_missing',actor_user_id=db.info.get('actor_user_id'),actor_role_snapshot=actor,before_json=dumps({'met':baseline['met']}),after_json=dumps({'met':value['met'],'mode':'evidence'}),created_at=utc_now()))


def decorate_steps(db,p,stages,tasks):
    """Keep raw condition_met for phase logic; expose human completion consistently everywhere."""
    from .task_evidence import completion_mode
    for stage in stages:
        for item in stage['items']:
            item['condition_met']=item['done']
            t=tasks.get(item['key'])
            item['counts_as_task']=item['key'] not in {'prep_work','progress','mow','inspections'}
            if not t or item['gate']:continue
            mode=completion_mode(t)
            if mode=='record':
                item['done']=False
            elif mode=='evidence':
                review=current(db,t,p)
                item['condition_met']=review['met'];item['done']=review['valid'];item['review_state']=review['state']
                item['done_at']=review['receipt'].reviewed_at if review['valid'] else None
                reviewer=db.get(models.User,review['receipt'].reviewer_user_id) if review['valid'] else None
                item['done_by']=reviewer.display_name if reviewer else None
                item['how']='reviewed' if review['valid'] else 'auto' if review['met'] else None
            elif item['key']=='purchase':
                from .procurement_workflow import purchase_progress
                item['done']=purchase_progress(db,p.id)['complete']
            else:
                sub=db.scalar(select(models.TaskSubmission).where(models.TaskSubmission.task_id==t.id).order_by(models.TaskSubmission.seq.desc(),models.TaskSubmission.id.desc()))
                item['done']=bool(t.exec_status=='done' and sub and sub.decision=='confirmed' and sub.decided_by_user_id and sub.decided_at)
        applicable=[i for i in stage['items'] if i['counts_as_task']]
        stage['done_count']=sum(i['done'] for i in applicable);stage['total']=len(applicable)


def public_snapshot(snapshot):
    result=json.loads(dumps(snapshot))
    for key,value in result['facts'].items():
        if key.startswith(('file:','photo:')):
            for file in value:file.pop('path',None)
    return result
