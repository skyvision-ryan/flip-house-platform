import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
import { userCan } from '../lib/role';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import DatePicker from '@cloudscape-design/components/date-picker';
import Modal from '@cloudscape-design/components/modal';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Tabs from '@cloudscape-design/components/tabs';
import { useState } from 'react';
import type { Meta, UserBrief } from '../api/client';
import { planByPerson, PlanStage, summarizePlan, TaskPlan } from '../lib/projectPlan';
import { stageKeyLabel } from '../lib/stageGroups';
import { initialsOf } from '../lib/taskGroups';
import css from './ui/CollaborationLayout.module.css';
import HelpText from './HelpText';
import PersonAvatar from './PersonAvatar';
import AssigneeButton from './AssigneeButton';
import FormField from './ui/FormField';
import Header from './ui/Header';
import Container from './ui/Surface';
import Table from './ui/Table';

type Props = { meta: Meta; plan: TaskPlan; onChange: (p: TaskPlan) => void; users: UserBrief[]; loading: boolean; creatorId: number; initialStage: string };

export default function ProjectPreplan({ meta, plan, onChange, users, loading, creatorId, initialStage }: Props) {
  useLanguage();
  const [group, setGroup] = useState(meta.stage_groups?.find((g) => g.stages.includes(initialStage))?.key ?? 'buying');
  const [editing, setEditing] = useState<{ key: string; title: string } | null>(null);
  const [who, setWho] = useState<number | null>(null);
  const [due, setDue] = useState('');
  const [invalidDate, setInvalidDate] = useState(false);
  const open = (item: { key: string; title: string }) => {
    setEditing(item); setWho(plan[item.key]?.assignee_user_id ?? null); setDue(plan[item.key]?.due_at ?? ''); setInvalidDate(false);
  };
  const options = [{ value: '', label: uiText("personAvatar.unassigned") }, ...users.filter(u => editing?.key !== 'purchase' || userCan(meta, u, 'procurement')).map((u) => ({ value: String(u.id), label: `${initialsOf(u)} · ${u.display_name}`, description: `${systemText(u.role_code)} · ${u.username}` }))];
  const renderStage = (stage: PlanStage) => {
    const ordinary = stage.items.filter((i) => !i.gate);
    const gates = stage.items.filter((i) => i.gate);
    const current = stage.key === initialStage;
    const title = systemText(stage.key === 's1' ? '买房 · 未购入' : stage.key === 's2' ? '买房 · escrow 中' : stage.short);
    return <Container cardId="plan-stage" cardContext={title} key={stage.key} header={<Header variant="h2" counter={`(${ordinary.length})`} help={current ? uiText("projectPreplan.start.here.you.can.assign.a.person.and.due") : uiText("projectPreplan.plan.ahead.tasks.start.as.not.started.after.creation")}>{title}</Header>}>
      <div className={`${css.draftRow} ${css.rowHeading}`}><span>{uiText("projectPreplan.task")}</span><span>{uiText("projectPreplan.primary.assignee")}</span><span>{uiText("projectPreplan.due.date")}</span></div>
      {ordinary.map((item) => {
        const user = users.find((u) => u.id === plan[item.key]?.assignee_user_id);
        return <div className={`${css.draftRow} ${css.draftItem}`} key={item.key}>
          <div><Box fontWeight="bold">{item.title}</Box><Box variant="small" color="text-body-secondary">{item.deliverable?.label ?? item.evidence}{!current && (stage.key < initialStage ? uiText("projectPreplan.earlier.history.needs.verification") : uiText("projectPreplan.prepare.ahead"))}</Box></div>
          <AssigneeButton user={user} label={uiText("sentences.assign.person", { value1: (item.title) })} disabled={loading} onClick={() => open(item)} />
          <Button variant="inline-link" iconName="calendar" ariaLabel={uiText("sentences.set.due.date", { value1: (item.title) })} onClick={() => open(item)}>{plan[item.key]?.due_at || uiText("projectPreplan.not.set")}</Button>
        </div>;
      })}
      {gates.length > 0 && <Box padding={{ top: 'm' }}><SpaceBetween size="xs"><Box fontWeight="bold">{uiText("projectPreplan.milestone.confirmation.requirements")}</Box>{gates.map((g) => <div key={g.key}><StatusIndicator type="not-started">{systemText(g.title)}</StatusIndicator><Box variant="small" color="text-body-secondary">{g.done_when ?? uiText("sentences.confirmation", { value1: ((g.confirm ?? []).join(' / ')) })}</Box></div>)}<HelpText inline>{uiText("projectPreplan.when.prerequisites.are.met.authorized.accounts.can.confirm.no")}</HelpText></SpaceBetween></Box>}
    </Container>;
  };
  return <>
    <Tabs activeTabId={group} onChange={({ detail }) => setGroup(detail.activeTabId)} tabs={(meta.stage_groups ?? []).map((g) => ({
      id: g.key, label: g.label, content: <SpaceBetween size="l">{meta.stage_checklist.filter((s) => g.stages.includes(s.key)).map(renderStage)}</SpaceBetween>,
    }))} />
    {editing && <Modal visible header={uiText("sentences.assignment", { value1: (editing.title) })} onDismiss={() => setEditing(null)} footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button variant="link" onClick={() => setEditing(null)}>{uiText("fieldWithSource.cancel")}</Button><Button variant="primary" onClick={() => {
      if (due && (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(Date.parse(due)) || new Date(due).toISOString().slice(0, 10) !== due)) { setInvalidDate(true); return; }
      onChange({ ...plan, [editing.key]: { assignee_user_id: who, due_at: due } }); setEditing(null);
    }}>{uiText("projectPreplan.save.assignment")}</Button></SpaceBetween></Box>}>
      <SpaceBetween size="l">
        <FormField label={uiText("projectPreplan.primary.assignee")} description={editing.key === 'purchase' ? uiText("projectPreplan.on.creation.the.selected.procurement.assignee.joins.this.property") : uiText("projectPreplan.this.new.project.has.no.members.yet.select.real")}><Select filteringType="auto" options={options} selectedOption={options.find((o) => o.value === (who == null ? '' : String(who))) ?? null} onChange={({ detail }) => setWho(detail.selectedOption.value ? Number(detail.selectedOption.value) : null)} /></FormField>
        {who != null && who !== creatorId && <Alert type="info">{uiText("projectPreplan.selected.assignees.join.the.project.on.creation.assignment.history")}</Alert>}
        <FormField label={uiText("projectPreplan.due.date.optional")} errorText={systemText(invalidDate ? uiText("projectPreplan.enter.a.valid.date.such.as.2026.09.25") : undefined)}><DatePicker value={due} onChange={({ detail }) => { setDue(detail.value); setInvalidDate(false); }} placeholder="YYYY/MM/DD" /></FormField>
        <HelpText>{uiText("projectPreplan.this.saves.a.draft.only.after.creation.tasks.start")}</HelpText>
      </SpaceBetween>
    </Modal>}
  </>;
}

export function PlanSummary({ meta, plan, users, initialStage, review = false }: { meta: Meta; plan: TaskPlan; users: UserBrief[]; initialStage: string; review?: boolean }) {
  useLanguage();
  const [preview, setPreview] = useState(false);
  const summary = summarizePlan(meta.stage_checklist, plan, initialStage);
  const recipients = planByPerson(meta.stage_checklist, plan, users, initialStage);
  return <SpaceBetween size="l">
    <Container cardId="plan-summary" header={<Header variant="h2">{uiText("projectPreplan.assignment.summary")}</Header>}>
      <SpaceBetween size="m">
        <ColumnLayout columns={2} minColumnWidth={100} variant="text-grid"><div><Box color="text-body-secondary">{uiText("projectPreplan.tasks.with.assignees")}</Box><Box fontSize="heading-xl" fontWeight="bold">{summary.assigned} / {summary.total}</Box></div><div><Box color="text-body-secondary">{uiText("personAvatar.unassigned")}</Box><Box fontSize="heading-xl" fontWeight="bold">{summary.unassigned}</Box></div></ColumnLayout>
        <div>{uiText("projectPreplan.current.tasks.assigned")} <b>{summary.current}</b> {uiText("projectPreplan.future.tasks.assigned")} <b>{summary.future}</b> {uiText("projectPreplan.items")}</div>
        <div>{uiText("projectPreplan.milestones")} <b>{summary.gates}</b> {uiText("projectPreplan.confirm.according.to.each.milestone.s.requirements")}</div>
        <HelpText>{uiText("projectPreplan.unassigned.tasks.are.also.created.assign.them.later.in")}</HelpText>
      </SpaceBetween>
    </Container>
    <Container cardId="plan-email" header={<Header variant="h2">{uiText("projectPreplan.email.reminders")}</Header>}>
      <SpaceBetween size="m">
        <StatusIndicator type="stopped">{uiText("projectPreplan.email.is.not.connected")}</StatusIndicator>
        <Checkbox checked={false} disabled>{uiText("projectPreplan.send.assignment.instructions.after.creation")}</Checkbox>
        <Box color="text-body-secondary">{uiText("projectPreplan.no.email.will.be.sent")} {summary.people.length} {uiText("projectPreplan.assignees")}</Box>
        <HelpText inline>{uiText("projectPreplan.tasks.for.the.same.assignee.are.combined.into.one")}</HelpText>
        <Button iconName="envelope" disabled={!summary.people.length} onClick={() => setPreview(true)}>{uiText("projectPreplan.preview.assignment.instructions")}</Button>
      </SpaceBetween>
    </Container>
    {preview && <Modal visible size="large" header={uiText("projectPreplan.assignment.preview.not.sent")} onDismiss={() => setPreview(false)} footer={<Box float="right"><Button onClick={() => setPreview(false)}>{uiText("myTodoTable.close")}</Button></Box>}>
      <SpaceBetween size="l"><Alert type="info">{uiText("projectPreplan.this.preview.groups.tasks.by.assignee.recipient.addresses.sending")}</Alert>{recipients.map((r, index) => <Container cardId="plan-recipient" cardContext={r.user?.display_name} key={r.user?.id ?? index} header={<Header variant="h3"><PersonAvatar user={r.user} /></Header>}><SpaceBetween size="s">{r.items.map((i) => <div key={`${i.stage}-${i.title}`}><Box fontWeight="bold">{i.title}</Box><Box color="text-body-secondary">{stageKeyLabel(meta.stage_groups, i.stage_key, i.stage)} · {i.future ? uiText("projectPreplan.prepare.ahead.2") : uiText("projectPreplan.current.stage")} {uiText("projectPreplan.due")} {i.due || uiText("projectPreplan.not.set")}</Box></div>)}</SpaceBetween></Container>)}</SpaceBetween>
    </Modal>}
    {review && <HelpText>{uiText("projectPreplan.you.can.go.back.and.edit.before.creation.all")}</HelpText>}
  </SpaceBetween>;
}

export function PlanReview({ meta, plan }: { meta: Meta; plan: TaskPlan }) {
  useLanguage();
  return <Table cardId="plan-review" variant="container" header={<Header variant="h2" help={uiText("projectPreplan.all.template.tasks.will.be.created.including.assigned.and")}>{uiText("projectPreplan.full.process.assignments")}</Header>} items={meta.stage_groups ?? []} trackBy="key" columnDefinitions={[
    { id: 'stage', header: uiText("projectPreplan.position"), cell: (g) => g.label },
    { id: 'assigned', header: uiText("projectPreplan.assigned.tasks"), cell: (g) => { const s = summarizePlan(meta.stage_checklist.filter((st) => g.stages.includes(st.key)), plan); return `${s.assigned} / ${s.total}`; } },
    { id: 'gate', header: uiText("projectPreplan.milestones"), cell: (g) => summarizePlan(meta.stage_checklist.filter((st) => g.stages.includes(st.key)), plan).gates },
  ]} />;
}
