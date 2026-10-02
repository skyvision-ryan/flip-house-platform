import { m, systemText } from './core.ts';
import { taskTitle } from './templateNames.ts';
import type { TaskEvent, FocusFact } from '../api/client.ts';
/** Render facts, preserving arbitrary names, reasons and the original audit text. */
export function eventText(event: TaskEvent): string {
  const before = event.before ?? {}, after = event.after ?? {};
  const person = (id: unknown) => id == null ? systemText('待分派') : event.participant_names?.[String(id)] ?? m('server.account', { value1: String(id) });
  let text: string;
  switch (event.kind) {
    case 'node_reopened': text=m('review.nodeReopened'); break;
    case 'node_partial_confirmed': text=m('review.nodePartial'); break;
    case 'evidence_reviewed': text=m('review.evidenceReviewed'); break;
    case 'evidence_invalidated': text=m('review.evidenceInvalidated'); break;
    case 'reviewer_set': text = m('event.reviewerSet'); break;
    case 'procurement_completed': text = m('event.procurementCompleted'); break;
    case 'procurement_reopened': text = m('event.procurementReopened'); break;
    case 'assistant_changed': text = m('event.assistantChanged', { before: person(before.assistant_user_id), after: person(after.assistant_user_id) }); break;
    case 'evidence_satisfied': text = m(after.mode === 'record' ? 'taskWorkflow.eventRecord' : after.mode==='evidence'?'workbench.change.evidence_satisfied':'taskWorkflow.eventMet'); break;
    case 'evidence_missing': text = m('taskWorkflow.eventMissing'); break;
    case 'assigned': text = m('event.assigned', { person: person(after.assignee_user_id) }); break;
    case 'reassigned': text = m('event.reassigned', { before: person(before.assignee_user_id), after: person(after.assignee_user_id) }); break;
    case 'unassigned': text = m('event.unassigned', { person: person(before.assignee_user_id) }); break;
    case 'rescheduled': text = m('event.rescheduled', { before: before.due_at || systemText('未设定'), after: after.due_at || systemText('未设定') }); break;
    case 'started': text = m('event.started'); break;
    case 'resumed': text = m('event.resumed'); break;
    case 'waiting': text = m(after.wait_for ? (after.wait_until ? 'event.waitingBoth' : 'event.waitingPerson') : (after.wait_until ? 'event.waitingDate' : 'event.waiting'), { person: after.wait_for, date: after.wait_until }); break;
    case 'member_added': text = m('event.joined', { person: person(after.user_id) }); break;
    case 'submitted': text = m(after.files ? 'event.submitted' : 'event.submittedNote', { seq: after.seq, count: Number(after.files ?? 0) }); break;
    case 'returned': text = after.mode==='evidence'?m('review.evidenceReturned'):m('event.returned', { seq: after.seq }); break;
    case 'confirmed': text = m('event.confirmed', { seq: after.seq }); break;
    case 'node_confirmed': text = m('event.nodeConfirmed', { person: after.name ?? systemText('确认人') }); break;
    case 'stage_intake': text = m('event.stageIntake'); break;
    case 'procurement_requirement_added': text = m('event.requirementAdded'); break;
    case 'procurement_requirement_removed': text = m('event.requirementRemoved'); break;
    default: return event.text;
  }
  return event.reason ? `${text}: ${event.reason}` : text;
}
export function focusValue(fact: FocusFact): string {
  if (fact.task_display) {
    const title = taskTitle(fact.task_display);
    return fact.task_state ? `${title} · ${systemText(fact.task_state === 'pending_review' ? '待审核' : '进行中')}` : title;
  }
  return systemText(fact.value);
}

/** Legacy server-owned procurement update envelopes. Captured identities/order references stay raw. */
export function projectUpdateText(update: {kind: string; text: string; changes?: {before?: string | null; after?: string | null} | null}): string {
  if (update.kind === 'project_company' && update.changes) return m('company.changed', {before: update.changes.before || m('company.empty'), after: update.changes.after || m('company.empty')});
  if (update.kind !== 'procurement') return update.text;
  const match = /^(.*?) (建立订单|更新订单|确认收货)：([\s\S]*)$/.exec(update.text);
  if (!match) return update.text;
  const code = { '建立订单': 'update.orderCreated', '更新订单': 'update.orderUpdated', '确认收货': 'update.receiptConfirmed' } as const;
  return m(code[match[2] as keyof typeof code], {person: match[1], order: match[3]});
}
