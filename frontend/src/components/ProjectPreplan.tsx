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
import { colorBorderDividerDefault } from '@cloudscape-design/design-tokens';
import { useState } from 'react';
import type { Meta, UserBrief } from '../api/client';
import { planByPerson, PlanStage, summarizePlan, TaskPlan } from '../lib/projectPlan';
import { stageKeyLabel } from '../lib/stageGroups';
import { initialsOf } from '../lib/taskGroups';
import css from './CollaborationLayout.module.css';
import HelpText from './HelpText';
import PersonAvatar from './PersonAvatar';
import FormField from './ui/FormField';
import Header from './ui/Header';
import Container from './ui/Surface';
import Table from './ui/Table';

type Props = { meta: Meta; plan: TaskPlan; onChange: (p: TaskPlan) => void; users: UserBrief[]; loading: boolean; creatorId: number };

export default function ProjectPreplan({ meta, plan, onChange, users, loading, creatorId }: Props) {
  const [group, setGroup] = useState(meta.stage_groups?.[0]?.key ?? 'buying');
  const [editing, setEditing] = useState<{ key: string; title: string } | null>(null);
  const [who, setWho] = useState<number | null>(null);
  const [due, setDue] = useState('');
  const [invalidDate, setInvalidDate] = useState(false);
  const open = (item: { key: string; title: string }) => {
    setEditing(item); setWho(plan[item.key]?.assignee_user_id ?? null); setDue(plan[item.key]?.due_at ?? ''); setInvalidDate(false);
  };
  const options = [{ value: '', label: '待分派' }, ...users.map((u) => ({ value: String(u.id), label: `${initialsOf(u)} · ${u.display_name}`, description: `${u.role_code} · ${u.username}` }))];
  const renderStage = (stage: PlanStage) => {
    const ordinary = stage.items.filter((i) => !i.gate);
    const gates = stage.items.filter((i) => i.gate);
    const current = stage.key === meta.stage_checklist[0]?.key;
    const title = stage.key === 's1' ? '买房 · 未购入' : stage.key === 's2' ? '买房 · escrow 中' : stage.short;
    return <Container cardId="plan-stage" cardContext={title} key={stage.key} header={<Header variant="h2" counter={`(${ordinary.length})`} help={current ? '从这里开始；可先安排负责人和截止日期。' : '提前安排；创建后仍是未开始，关键节点按原规则推进。'}>{title}</Header>}>
      <div className={`${css.draftRow} ${css.rowHeading}`}><span>普通任务</span><span>主要负责人</span><span>截止日期</span></div>
      {ordinary.map((item) => {
        const user = users.find((u) => u.id === plan[item.key]?.assignee_user_id);
        return <div className={css.draftRow} key={item.key} style={{ borderTop: `1px solid ${colorBorderDividerDefault}` }}>
          <div><Box fontWeight="bold">{item.title}</Box><Box variant="small" color="text-body-secondary">{item.deliverable?.label ?? item.evidence}{!current && ' · 提前准备'}</Box></div>
          <div><PersonAvatar user={user} size="small" showRole={false} /><div><Button variant="inline-link" disabled={loading} iconName="edit" ariaLabel={`安排负责人：${item.title}`} onClick={() => open(item)}>{user ? '调整安排' : '选择负责人'}</Button></div></div>
          <Button variant="inline-link" iconName="calendar" ariaLabel={`安排截止：${item.title}`} onClick={() => open(item)}>{plan[item.key]?.due_at || '未设定'}</Button>
        </div>;
      })}
      {gates.length > 0 && <Box padding={{ top: 'm' }}><SpaceBetween size="xs"><Box fontWeight="bold">关键节点 · 单独确认</Box>{gates.map((g) => <div key={g.key}><StatusIndicator type="not-started">{g.title}</StatusIndicator><Box variant="small" color="text-body-secondary">{(g.confirm ?? []).join(' / ')} 确认 · 不计入人员分派数</Box></div>)}</SpaceBetween></Box>}
    </Container>;
  };
  return <>
    <Tabs activeTabId={group} onChange={({ detail }) => setGroup(detail.activeTabId)} tabs={(meta.stage_groups ?? []).map((g) => ({
      id: g.key, label: g.label, content: <SpaceBetween size="l">{meta.stage_checklist.filter((s) => g.stages.includes(s.key)).map(renderStage)}</SpaceBetween>,
    }))} />
    {editing && <Modal visible header={`安排：${editing.title}`} onDismiss={() => setEditing(null)} footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button variant="link" onClick={() => setEditing(null)}>取消</Button><Button variant="primary" onClick={() => {
      if (due && (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(Date.parse(due)) || new Date(due).toISOString().slice(0, 10) !== due)) { setInvalidDate(true); return; }
      onChange({ ...plan, [editing.key]: { assignee_user_id: who, due_at: due } }); setEditing(null);
    }}>保存到安排</Button></SpaceBetween></Box>}>
      <SpaceBetween size="l">
        <FormField label="主要负责人" description="新项目尚无成员，选择真实账号；创建前统一确认加入项目。"><Select filteringType="auto" options={options} selectedOption={options.find((o) => o.value === (who == null ? '' : String(who))) ?? null} onChange={({ detail }) => setWho(detail.selectedOption.value ? Number(detail.selectedOption.value) : null)} /></FormField>
        {who != null && who !== creatorId && <Alert type="info">创建时将所选负责人加入项目，保留分派记录。</Alert>}
        <FormField label="截止日期（可选）" errorText={invalidDate ? '请填写有效日期，例如 2026/09/25' : undefined}><DatePicker value={due} onChange={({ detail }) => { setDue(detail.value); setInvalidDate(false); }} placeholder="YYYY/MM/DD" /></FormField>
        <HelpText>这里只保存草稿。创建后任务为“未开始”，审核人沿用现有规则，默认为创建者。</HelpText>
      </SpaceBetween>
    </Modal>}
  </>;
}

export function PlanSummary({ meta, plan, users, review = false }: { meta: Meta; plan: TaskPlan; users: UserBrief[]; review?: boolean }) {
  const [preview, setPreview] = useState(false);
  const summary = summarizePlan(meta.stage_checklist, plan);
  const recipients = planByPerson(meta.stage_checklist, plan, users);
  return <SpaceBetween size="l">
    <Container cardId="plan-summary" header={<Header variant="h2">安排摘要</Header>}>
      <SpaceBetween size="m">
        <ColumnLayout columns={2} minColumnWidth={100} variant="text-grid"><div><Box color="text-body-secondary">已安排负责人</Box><Box fontSize="heading-xl" fontWeight="bold">{summary.assigned} / {summary.total}</Box></div><div><Box color="text-body-secondary">待分派</Box><Box fontSize="heading-xl" fontWeight="bold">{summary.unassigned}</Box></div></ColumnLayout>
        <div>当前已分派 <b>{summary.current}</b> 项 · 后续已分派 <b>{summary.future}</b> 项</div>
        <div>关键节点 <b>{summary.gates}</b> 个 · 单独确认</div>
        <HelpText>未分派任务也会创建，可在项目总览继续安排。</HelpText>
      </SpaceBetween>
    </Container>
    <Container cardId="plan-email" header={<Header variant="h2">邮件提醒</Header>}>
      <SpaceBetween size="m">
        <StatusIndicator type="stopped">邮件通道未接通</StatusIndicator>
        <Checkbox checked={false} disabled>创建后发送分派说明</Checkbox>
        <Box color="text-body-secondary">本次创建不会发送邮件。{summary.people.length} 位负责人，同一人的任务合并展示。</Box>
        <Button iconName="envelope" disabled={!summary.people.length} onClick={() => setPreview(true)}>预览安排说明</Button>
      </SpaceBetween>
    </Container>
    {preview && <Modal visible size="large" header="安排说明预览 · 尚未发送" onDismiss={() => setPreview(false)} footer={<Box float="right"><Button onClick={() => setPreview(false)}>关闭</Button></Box>}>
      <SpaceBetween size="l"><Alert type="info">这是按负责账号合并的内容预览。邮件接通后再提供实际收件地址、发送与回执。</Alert>{recipients.map((r, index) => <Container cardId="plan-recipient" cardContext={r.user?.display_name} key={r.user?.id ?? index} header={<Header variant="h3"><PersonAvatar user={r.user} /></Header>}><SpaceBetween size="s">{r.items.map((i) => <div key={`${i.stage}-${i.title}`}><Box fontWeight="bold">{i.title}</Box><Box color="text-body-secondary">{stageKeyLabel(meta.stage_groups, i.stage_key, i.stage)} · {i.future ? '提前准备' : '当前阶段'} · 截止 {i.due || '未设定'}</Box></div>)}</SpaceBetween></Container>)}</SpaceBetween>
    </Modal>}
    {review && <HelpText>创建前可返回修改，全部安排会保留。</HelpText>}
  </SpaceBetween>;
}

export function PlanReview({ meta, plan }: { meta: Meta; plan: TaskPlan }) {
  return <Table cardId="plan-review" variant="container" header={<Header variant="h2" help="全部模板任务都会创建；已分派和待分派都保留。">全流程安排</Header>} items={meta.stage_groups ?? []} trackBy="key" columnDefinitions={[
    { id: 'stage', header: '位置', cell: (g) => g.label },
    { id: 'assigned', header: '普通任务已分派', cell: (g) => { const s = summarizePlan(meta.stage_checklist.filter((st) => g.stages.includes(st.key)), plan); return `${s.assigned} / ${s.total}`; } },
    { id: 'gate', header: '关键节点', cell: (g) => summarizePlan(meta.stage_checklist.filter((st) => g.stages.includes(st.key)), plan).gates },
  ]} />;
}
