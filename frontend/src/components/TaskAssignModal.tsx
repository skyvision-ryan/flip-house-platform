import { taskTitle } from '../i18n/templateNames.ts';
import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import DatePicker from '@cloudscape-design/components/date-picker';
import Modal from '@cloudscape-design/components/modal';
import Select, { SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';
import { useEffect, useMemo, useState } from 'react';
import { api, ProjectMembers, Task, UserBrief } from '../api/client';
import { useMeta } from '../lib/meta';
import { userCan } from '../lib/role';
import { useFlash } from '../lib/flash';
import FormField from './ui/FormField';
import HelpText from './HelpText';
import PersonAvatar from './PersonAvatar';

const UNASSIGN = '__none__';

/**
 * 分派 / 改派 / 改截止（KAN-75 块 1）。一个流程：选人 → 截止（可空）→ 原因（改派必填）→ 保存。
 *
 * 候选**默认只列项目成员**；「不在项目里」的账号也列出，但选中后会明确提示
 * 「保存时加入项目并留记录」——这就是 Ryan 定的「加入项目并分派」，不做成员管理页。
 * 保存成功才更新界面；409 说明别人刚改过，提示后由调用方刷新，不覆盖。
 */
export default function TaskAssignModal({ projectId, tasks, onDone, onConflict, onDismiss }: {
  projectId: number; tasks: Task[]; onDone: (t: Task) => void; onConflict: () => void; onDismiss: () => void;
}) {
  useLanguage();
  const flash = useFlash(); const meta = useMeta();
  // 单项：可改人、改截止；批量（勾选多行后「分派任务」）：同一个人、同一截止，逐项保存，哪一项失败就说哪一项
  const task = tasks[0];
  const bulk = tasks.length > 1;
  const [members, setMembers] = useState<ProjectMembers | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [who, setWho] = useState<string>(task.assignee ? String(task.assignee.id) : UNASSIGN);
  const [due, setDue] = useState<string>(task.due_at ?? '');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.projectMembers(projectId).then(setMembers).catch((e) => setLoadErr(e.message)); }, [projectId]);

  const byId = useMemo(() => {
    const m = new Map<string, UserBrief & { member: boolean }>();
    members?.members.forEach((u) => m.set(String(u.id), { ...u, member: true }));
    members?.others.forEach((u) => m.set(String(u.id), { ...u, member: false }));
    return m;
  }, [members]);

  const opt = (u: UserBrief): SelectProps.Option => ({ value: String(u.id), label: u.display_name, description: u.role_code, tags: [u.username] });
  const eligible = (u: UserBrief) => !tasks.some(t => t.step_key === 'purchase') || userCan(meta, u, 'procurement');
  const options: SelectProps.Options = [
    ...(task.assignee && !bulk ? [{ value: UNASSIGN, label: uiText("taskAssignModal.remove.assignment"), description: uiText("taskAssignModal.return.task.to.unassigned") }] : []),
    { label: uiText("taskAssignModal.project.members"), options: (members?.members ?? []).filter(eligible).map(opt) },
    { label: uiText("taskAssignModal.not.a.member.selecting.adds.them.to.the.project"), options: (members?.others ?? []).filter(eligible).map(opt) },
  ];
  const selected = who === UNASSIGN
    ? (task.assignee ? { value: UNASSIGN, label: uiText("taskAssignModal.remove.assignment") } : null)
    : (byId.get(who) ? opt(byId.get(who)!) : null);
  const target = who === UNASSIGN ? null : byId.get(who) ?? null;
  const changingPerson = (target?.id ?? null) !== (task.assignee?.id ?? null);
  const isReassign = bulk ? tasks.some((t) => t.assignee && t.assignee.id !== (target?.id ?? null)) : changingPerson && !!task.assignee;
  const needJoin = !!target && !target.member;
  const dueChanged = (due || '') !== (task.due_at ?? '');
  const nothing = bulk ? !target : (!changingPerson && !dueChanged);

  const save = async () => {
    if (who !== UNASSIGN && !target) { setErr(uiText("taskAssignModal.select.a.person.first")); return; }
    if (isReassign && !reason.trim()) { setErr(uiText("taskAssignModal.a.reason.is.required.for.reassignment.both.the.new")); return; }
    setSaving(true); setErr(null);
    if (bulk) {
      let last: Task | null = null; let okCount = 0; let joined = needJoin;
      for (const t of tasks) {
        const same = (t.assignee?.id ?? null) === (target?.id ?? null);
        try {
          last = await api.assignTask(projectId, t.id, {
            version: t.version,
            assignee_user_id: same ? undefined : (target ? target.id : null),
            due_at: due ? due : undefined,
            reason: reason.trim() || null,
            join_project: joined,
          });
          joined = false; okCount += 1;
        } catch (e: any) {
          setSaving(false);
          setErr(uiText("sentences.could.not.be.saved.the.preceding.tasks.were.saved", { value1: (taskTitle(t)), value2: (String(e.message ?? e)), value3: (okCount) }));
          if (okCount) onConflict();
          return;
        }
      }
      setSaving(false);
      flash({ type: 'success', content: uiText("sentences.assigned.tasks.to", { value1: (okCount), value2: (target!.display_name) }) });
      if (last) onDone(last);
      return;
    }
    try {
      const t = await api.assignTask(projectId, task.id, {
        version: task.version,
        assignee_user_id: changingPerson ? (target ? target.id : null) : undefined,
        due_at: dueChanged ? (due || null) : undefined,
        reason: reason.trim() || null,
        join_project: needJoin,
      });
      flash({ type: 'success', content: target ? uiText("sentences.assigned.to", { value1: (taskTitle(task)), value2: (target.display_name), value3: (needJoin ? uiText("taskAssignModal.and.add.to.project.members") : '') }) : changingPerson ? uiText("sentences.removed.assignment.for", { value1: (taskTitle(task)) }) : uiText("sentences.updated.the.due.date.for", { value1: (taskTitle(task)) }) });
      onDone(t);
    } catch (e: any) {
      const msg = String(e.message ?? e);
      if (e.status === 409) { flash({ type: 'warning', content: msg }); onConflict(); }
      else setErr(msg);
    } finally { setSaving(false); }
  };

  return (
    <Modal
      visible
      onDismiss={onDismiss}
      header={bulk ? uiText("sentences.assign.tasks", { value1: (tasks.length) }) : task.assignee ? uiText("sentences.update.assignment", { value1: (taskTitle(task)) }) : uiText("sentences.assign", { value1: (taskTitle(task)) })}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss} disabled={saving}>{uiText("fieldWithSource.cancel")}</Button>
            <Button variant="primary" loading={saving} disabled={nothing || !members} onClick={save}>{needJoin ? uiText("taskAssignModal.add.member.and.assign") : uiText("taskAssignModal.save.assignment")}</Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {loadErr && <Alert type="error">{uiText("taskAssignModal.cannot.load.project.members")}{loadErr}</Alert>}
        {bulk && <Box fontSize="body-s" color="text-body-secondary">{tasks.map((t) => taskTitle(t)).join('、')}{uiText("taskAssignModal.the.same.assignee.and.due.date.apply.reassigning.existing")}</Box>}
        <FormField label={uiText("projectPreplan.primary.assignee")} description={uiText("taskAssignModal.accounts.are.grouped.by.project.membership.selecting.another.account")}>
          <Select selectedOption={selected} options={options} onChange={({ detail }) => setWho(detail.selectedOption.value ?? UNASSIGN)} filteringType="auto" placeholder={uiText("taskAssignModal.select.an.account")} statusType={members ? 'finished' : 'loading'} />
        </FormField>
        {target && <PersonAvatar user={target} />}
        {task.assignee && !bulk && (
          <Box fontSize="body-s" color="text-body-secondary">{uiText("taskAssignModal.previous.assignee")}{task.assignee.display_name}（{systemText(task.assignee.role_code)}）{isReassign && (task.step_key === 'purchase' ? uiText("taskAssignModal.the.new.assignee.takes.over.existing.procurement.progress.previous") : uiText("taskAssignModal.reassignment.resets.progress.to.not.started.the.previous.assignee"))}</Box>
        )}
        {needJoin && <Alert type="info">{target!.display_name} {uiText("taskAssignModal.is.not.a.project.member.yet.saving.adds.them")}</Alert>}
        <FormField label={uiText("projectPreplan.due.date")} description={uiText("taskAssignModal.you.may.leave.this.blank.and.set.it.later")}>
          <DatePicker value={due} onChange={({ detail }) => setDue(detail.value)} placeholder="YYYY/MM/DD" />
        </FormField>
        <FormField label={isReassign ? uiText("taskAssignModal.reassignment.reason.required") : uiText("taskAssignModal.explanation.optional")} description={uiText("taskAssignModal.saved.in.the.activity.history")}>
          <Textarea value={reason} rows={2} onChange={({ detail }) => setReason(detail.value)} placeholder={isReassign ? uiText("taskAssignModal.for.example.employee.a.is.on.leave.a2.is") : ''} />
        </FormField>
        <>{task.step_key !== 'purchase' && <Box fontSize="body-s" color="text-body-secondary">{uiText("taskAssignModal.reviewer")}{task.reviewer?.display_name ?? uiText("taskAssignModal.you")}。</Box>}</>
        <HelpText>{uiText("taskAssignModal.assignment.changes.only.the.assignee.and.due.date.milestones")}</HelpText>
        {err && <Alert type="error">{systemText(err)}</Alert>}
      </SpaceBetween>
    </Modal>
  );
}
