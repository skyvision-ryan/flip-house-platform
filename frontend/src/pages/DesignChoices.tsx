import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
import { useState } from 'react';
import Button from '@cloudscape-design/components/button';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '../components/ui/Header';
import EmployeeAvatar from '../components/ui/EmployeeAvatar';

const directions = [
  { id: 'linear', name: 'B · Linear', get label() { return uiText("designChoices.continuous.workspace"); }, idea: '列表与摘要共用一块连续平面，用留白和分隔线建立层次。', gain: '看任务、看背景时视线不中断。', cost: '区块边界更轻，需要明确选中状态。', source: 'https://linear.app/features', applied: true },
  { id: 'jira', name: 'Jira / Atlassian', get label() { return uiText("designChoices.group.by.status"); }, idea: '先看进行中、等待和待确认，再展开具体任务。', gain: '例会能很快找到卡在哪里。', cost: '跨状态比较负责人或截止日期要切换分组。', source: 'https://www.atlassian.com/software/jira/features' },
  { id: 'shadcn', name: 'shadcn/ui', get label() { return uiText("designChoices.simple.task.list"); }, idea: '压缩工具栏，把搜索、状态与每项任务放在同一条阅读线上。', gain: '个人每天处理少量任务更直接。', cost: '大批量项目对照时，信息比表格少。', source: 'https://ui.shadcn.com/examples/tasks' },
  { id: 'carbon', name: 'IBM Carbon', get label() { return uiText("designChoices.structured.table"); }, idea: '强调固定列、对齐和紧凑行距，把状态、证据、截止直接列出。', gain: '适合大量事项的核对与比较。', cost: '桌面更有效率，手机要逐项展开。', source: 'https://carbondesignsystem.com/components/data-table/usage/' },
  { id: 'fluent', name: 'Fluent 2', get label() { return uiText("designChoices.people.and.handoffs"); }, idea: '把负责人、等待对象和最近动态放在任务附近，用分区底色强调协作。', gain: '先知道找谁、等谁，便于接手工作。', cost: '每行更高，同屏能看到的任务较少。', source: 'https://fluent2.microsoft.design/' },
  { id: 'mantine', name: 'Mantine', get label() { return uiText("designChoices.compact.filtering.tools"); }, idea: '用清楚的筛选按钮和侧栏摘要组织任务，适合快速缩小范围。', gain: '筛选和选项容易发现。', cost: '控件更多，要克制页面上的操作数量。', source: 'https://mantine.dev/' },
];
const sample = [
  { id: 1, get title() { return uiText("designChoices.activate.water.electricity.and.gas"); }, status: '进行中', evidence: '未满足', due: '09/25', person: 'Alex', role: '项目助理', note: '水、电已开通；等待燃气公司确认到场时间。', event: '今天 10:20 · Alex 更新了办理进展', color: 1 },
  { id: 2, get title() { return uiText("designChoices.provide.complete.property.insurance.policy"); }, status: '等待中', evidence: '未满足', due: '09/25', person: 'Morgan', role: '项目助理', note: '等待保险经纪人补发带到期日的保险单。', event: '今天 09:45 · Morgan 记录等待回复', color: 2 },
  { id: 3, get title() { return uiText("designChoices.verify.permit.documents"); }, status: '待确认', evidence: '已满足', due: '09/26', person: 'Taylor', role: 'Permit/设计', note: 'Permit 资料已提交，等待审核人确认本次交付。', event: '昨天 16:30 · Taylor 提交了 Permit 资料', color: 3 },
  { id: 4, get title() { return uiText("designChoices.prepare.permit.application.documents"); }, status: '进行中', evidence: '未满足', due: '09/27', person: 'Jordan', role: 'Permit/设计', note: '设计定稿已备齐，正在整理申请文件。', event: '昨天 15:10 · Jordan 开始处理', color: 4 },
];
export default function DesignChoices() {
  useLanguage();
  const [direction, setDirection] = useState('linear');
  const [picked, setPicked] = useState(1);
  const [filter, setFilter] = useState('全部');
  const [query, setQuery] = useState('');
  const [choice, setChoice] = useState(() => { try { return localStorage.getItem('fh-design-preference') ?? ''; } catch { return ''; } });
  const [preferenceError, setPreferenceError] = useState('');
  const [detailTab, setDetailTab] = useState('详情');
  const [mobileDetail, setMobileDetail] = useState(false);
  const current = directions.find((d) => d.id === direction)!;
  const task = sample.find((t) => t.id === picked)!;
  const rows = sample.filter((t) => (filter === '全部' || t.status === filter) && `${t.title} ${t.person}`.toLowerCase().includes(query.toLowerCase()));
  const avatar = (t: typeof task) => <EmployeeAvatar size="small" user={{ id: t.color, display_name: t.person, role_code: t.role, username: t.person.toLowerCase(), active: true }} />;
  const row = (t: typeof task) => <button key={t.id} className="ui-design-row" aria-pressed={picked === t.id} onClick={() => { setPicked(t.id); setMobileDetail(true); }}>
    <span className="ui-design-task"><strong>{systemText(t.title)}</strong>{direction === 'fluent' && <small>{systemText(t.note)}</small>}</span>
    <span className="ui-design-person">{avatar(t)}<span>{t.person}</span></span>
    <span className="ui-design-state">{systemText(t.status)}</span><span className="ui-design-evidence">{systemText(t.evidence)}</span><span className="ui-design-due">{t.due}</span>
  </button>;
  return <ContentLayout maxContentWidth={1440} header={<Header variant="h1" description={uiText("designChoices.compare.layouts.using.the.same.sample.tasks.option.b")}>{uiText("designChoices.general.interface.references")}</Header>}>
    <div className="ui-design-chooser" role="group" aria-label={uiText("designChoices.select.design.direction")}>{directions.map((d) => <button key={d.id} aria-pressed={d.id === direction} onClick={() => { setDirection(d.id); setMobileDetail(false); }}><span>{d.name}</span><strong>{systemText(d.label)}</strong>{d.applied && <small>{uiText("designChoices.applied")}</small>}</button>)}</div>
    <div className="ui-design-caption"><div><h2>{systemText(current.label)}</h2><p>{systemText(current.idea)}</p><p><strong>{uiText("designChoices.suitable.for")}</strong>{systemText(current.gain)} <strong>{uiText("designChoices.tradeoff")}</strong>{systemText(current.cost)}</p></div><a href={current.source} target="_blank" rel="noreferrer">{uiText("designChoices.view.reference.source")}</a></div>
    <section className={`ui-design-preview ui-design-${direction}`} aria-label={uiText("sentences.interactive.sample", { value1: (current.name) })}>
      <header className="ui-design-project"><div><small>{uiText("designChoices.sample.property.renovation.stage")}</small><h2>Maple House</h2></div><span>{uiText("designChoices.4.tasks.1.awaiting.confirmation")}</span></header>
      <div className="ui-design-toolbar"><label><span className="ui-sr-only">{uiText("designChoices.search.sample.tasks")}</span><input placeholder={uiText("designChoices.search.tasks.or.assignees")} value={query} onChange={(e) => setQuery(e.target.value)} /></label><div role="group" aria-label={uiText("designChoices.filter.sample.statuses")}>{['全部', '进行中', '等待中', '待确认'].map((s) => <button key={s} aria-pressed={filter === s} onClick={() => setFilter(s)}>{systemText(s)}</button>)}</div></div>
      <div className="ui-design-body" data-detail-open={mobileDetail}>
        <div className="ui-design-list"><div className="ui-design-columns"><span>{uiText("taskTable.task")}</span><span>{uiText('task.assignee')}</span><span>{uiText("taskSummaryPanel.status")}</span><span>{uiText("designChoices.evidence")}</span><span>{uiText("taskTable.due")}</span></div>
          {direction === 'jira' ? ['进行中', '等待中', '待确认'].map((s) => <section key={s}><h3>{systemText(s)} <small>{rows.filter((t) => t.status === s).length}</small></h3>{rows.filter((t) => t.status === s).map(row)}</section>) : rows.map(row)}
          {!rows.length && <p className="ui-design-empty">{uiText("designChoices.no.matching.tasks.try.another.search.or.select.all")}</p>}
        </div>
        <aside className="ui-design-detail"><div className="ui-design-mobile-back"><Button iconName="arrow-left" onClick={() => setMobileDetail(false)}>{uiText("designChoices.back.to.sample.list")}</Button></div><small>{uiText("taskSummaryPanel.task.summary")}</small><h2>{systemText(task.title)}</h2><div className="ui-design-person">{avatar(task)}<strong>{task.person}</strong><span>{task.role}</span></div>
          <div className="ui-design-detail-tabs" role="group" aria-label={uiText("designChoices.sample.summary")}>{['详情', '活动记录'].map((s) => <button key={s} aria-pressed={detailTab === s} onClick={() => setDetailTab(s)}>{systemText(s)}</button>)}</div>
          {detailTab === '详情' ? <><dl><div><dt>{uiText("designChoices.work.status")}</dt><dd>{systemText(task.status)}</dd></div><div><dt>{uiText("taskSummaryPanel.evidence.assessment")}</dt><dd>{systemText(task.evidence)}</dd></div><div><dt>{uiText("projectPreplan.due.date")}</dt><dd>{task.due}</dd></div></dl><p>{systemText(task.note)}</p><p className="ui-muted">{uiText("designChoices.evidence.satisfaction.and.task.confirmation.are.recorded.separately")}</p></> : <p>{systemText(task.event)}</p>}
          <Button variant="primary" onClick={() => setDetailTab(detailTab === '详情' ? '活动记录' : '详情')}>{detailTab === '详情' ? uiText("designChoices.view.latest.progress") : uiText("designChoices.back.to.task.details")}</Button>
        </aside>
      </div>
    </section>
    {preferenceError && <p role="alert">{systemText(preferenceError)}</p>}<div className="ui-design-decision"><div><strong>{choice ? uiText("sentences.preference.recorded", { value1: (directions.find((d) => d.id === choice)?.name ?? choice) }) : uiText("designChoices.try.filters.and.open.tasks.before.choosing")}</strong><p>{uiText("designChoices.adapted.reference.sketches.retain.the.project.font.and.avatars")}</p></div><Button onClick={() => { try { localStorage.setItem('fh-design-preference', direction); setChoice(direction); setPreferenceError(''); } catch { setPreferenceError(uiText("designChoices.browser.storage.is.unavailable.record.and.share.your.choice")); } }}>{uiText("designChoices.save.device.preference")} {current.name}</Button></div>
  </ContentLayout>;
}
