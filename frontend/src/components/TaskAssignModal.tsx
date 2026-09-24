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
import { useFlash } from '../lib/flash';
import FormField from './ui/FormField';

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
  const flash = useFlash();
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
  const options: SelectProps.Options = [
    ...(task.assignee && !bulk ? [{ value: UNASSIGN, label: '取消分派', description: '任务回到待分派' }] : []),
    { label: '项目成员', options: (members?.members ?? []).map(opt) },
    { label: '不在项目里 · 选中即加入项目并分派', options: (members?.others ?? []).map(opt) },
  ];
  const selected = who === UNASSIGN
    ? (task.assignee ? { value: UNASSIGN, label: '取消分派' } : null)
    : (byId.get(who) ? opt(byId.get(who)!) : null);
  const target = who === UNASSIGN ? null : byId.get(who) ?? null;
  const changingPerson = (target?.id ?? null) !== (task.assignee?.id ?? null);
  const isReassign = bulk ? tasks.some((t) => t.assignee && t.assignee.id !== (target?.id ?? null)) : changingPerson && !!task.assignee;
  const needJoin = !!target && !target.member;
  const dueChanged = (due || '') !== (task.due_at ?? '');
  const nothing = bulk ? !target : (!changingPerson && !dueChanged);

  const save = async () => {
    if (who !== UNASSIGN && !target) { setErr('先选一个人'); return; }
    if (isReassign && !reason.trim()) { setErr('改派要写原因，接手的人和原负责人都会看到'); return; }
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
          setErr(`「${t.title}」没保存成功：${String(e.message ?? e)}。前面 ${okCount} 项已保存。`);
          if (okCount) onConflict();
          return;
        }
      }
      setSaving(false);
      flash({ type: 'success', content: `已把 ${okCount} 项任务分派给 ${target!.display_name}` });
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
      flash({ type: 'success', content: target ? `已把「${task.title}」分派给 ${target.display_name}${needJoin ? '，并加入项目成员' : ''}` : changingPerson ? `已取消「${task.title}」的分派` : `已更新「${task.title}」的截止日期` });
      onDone(t);
    } catch (e: any) {
      const msg = String(e.message ?? e);
      if (msg.startsWith('409') || msg.includes('刚被别人改过')) { flash({ type: 'warning', content: msg }); onConflict(); }
      else setErr(msg);
    } finally { setSaving(false); }
  };

  return (
    <Modal
      visible
      onDismiss={onDismiss}
      header={bulk ? `分派 ${tasks.length} 项任务` : task.assignee ? `调整安排：${task.title}` : `分派：${task.title}`}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss} disabled={saving}>取消</Button>
            <Button variant="primary" loading={saving} disabled={nothing || !members} onClick={save}>{needJoin ? '加入项目并分派' : '保存分派'}</Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {loadErr && <Alert type="error">读不到项目成员：{loadErr}</Alert>}
        {bulk && <Box fontSize="body-s" color="text-body-secondary">{tasks.map((t) => t.title).join('、')}。同一个负责人、同一截止日期；已有负责人的项会改派，要写原因。</Box>}
        <FormField label="主要负责人" description="默认只列项目成员。选了不在项目里的人，保存时会把他加入项目并留记录。">
          <Select selectedOption={selected} options={options} onChange={({ detail }) => setWho(detail.selectedOption.value ?? UNASSIGN)} filteringType="auto" placeholder="选一个账号" statusType={members ? 'finished' : 'loading'} />
        </FormField>
        {task.assignee && !bulk && (
          <Box fontSize="body-s" color="text-body-secondary">原负责人：{task.assignee.display_name}（{task.assignee.role_code}）{isReassign && '。换人后进度回到「未开始」，原负责人的记录保留在活动记录里。'}</Box>
        )}
        {needJoin && <Alert type="info">{target!.display_name} 还不是本项目成员。保存时会加入项目，活动记录里会记一条「加入项目」。</Alert>}
        <FormField label="截止日期" description="可以先空着，之后在任务摘要里补。">
          <DatePicker value={due} onChange={({ detail }) => setDue(detail.value)} placeholder="YYYY/MM/DD" />
        </FormField>
        <FormField label={isReassign ? '改派原因（必填）' : '说明（可选）'} description="会写进活动记录。">
          <Textarea value={reason} rows={2} onChange={({ detail }) => setReason(detail.value)} placeholder={isReassign ? '例如：员工 A 休假，由 A2 接手' : ''} />
        </FormField>
        <Box fontSize="body-s" color="text-body-secondary">审核人{task.reviewer ? `仍是 ${task.reviewer.display_name}` : '为空时默认记为你自己'}；关键节点规则不变。</Box>
        {err && <Alert type="error">{err}</Alert>}
      </SpaceBetween>
    </Modal>
  );
}
