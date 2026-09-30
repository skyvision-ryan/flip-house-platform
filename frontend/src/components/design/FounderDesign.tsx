import { systemText } from '../../i18n/core.ts';
import { useLanguage } from '../../i18n/LanguageProvider';
import { m as uiText } from '../../i18n/core.ts';
import { useState } from 'react';
import Button from '@cloudscape-design/components/button';
import CollaborationWorkspace from '../ui/CollaborationWorkspace';
import LeadershipProjectDetail from './LeadershipProjectDetail';
import type { RoleDesign } from '../../lib/roleDesigns';
import { currentAnalysis, holdingDays, investedScale, leadershipMoney as money, leadershipTotals, overdueTasks, reviewAge,
  type LeadershipPreview, type LeadershipProject } from '../../lib/leadershipDesign';

const issueLabels = { data: '收益资料缺口', progress: '推进卡点', settlement: '结算待核' } as const;
type Issue = keyof typeof issueLabels;
const lifecycleLabels = { lead: '线索', active: '进行中', closed: '已售收尾' } as const;
const modelLabel = (project: LeadershipProject) => {
  if (project.lifecycle !== 'active') return project.lifecycle === 'lead' ? uiText("founderDesign.leads.excluded") : uiText("founderDesign.sold.reconciliation.pending");
  const analysis = currentAnalysis(project);
  return analysis?.outputs && !analysis.missing.length ? money(analysis.outputs.total_profit) : uiText("founderDesign.incomplete.records");
};
const daysLabel = (project: LeadershipProject, asOf: string) => {
  const days = holdingDays(project, asOf);
  return days == null ? (project.lifecycle === 'lead' ? '未买入' : '日期未齐') : uiText("sentences.days.2", { value1: (days), value2: (project.lifecycle === 'closed' ? uiText("founderDesign.through.sale.date") : '') });
};

/** Founder reads the same projects through money, common issues, or current flow. */
export default function FounderDesign({ preview, design }: { preview: LeadershipPreview; design: RoleDesign }) {
  useLanguage();
  const [sectionRequestId, setSectionRequestId] = useState(0);
  const [query, setQuery] = useState('');
  const [lifecycle, setLifecycle] = useState('all');
  const [issue, setIssue] = useState<Issue | 'all'>('all');
  const [stage, setStage] = useState('all');
  const [sort, setSort] = useState('default');
  const [distribution, setDistribution] = useState<'count' | 'invested'>('count');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailSection, setDetailSection] = useState<'经营依据' | '推进与节点'>('经营依据');
  const [metric, setMetric] = useState<'invested' | 'model' | 'attention' | null>(null);
  const base = preview.projects.filter(project => (lifecycle === 'all' || project.lifecycle === lifecycle)
    && (issue === 'all' || project.issues.includes(issue))
    && `${project.name} ${project.stage} ${project.coordinator} ${project.concern}`.toLowerCase().includes(query.trim().toLowerCase()));
  const filtered = base.filter(project => stage === 'all' || project.stage === stage);
  const rows = [...filtered].sort((a, b) => sort === 'invested'
    ? (b.lifecycle === 'active' ? investedScale(b) ?? -1 : -1) - (a.lifecycle === 'active' ? investedScale(a) ?? -1 : -1)
    : sort === 'days' ? (holdingDays(b, preview.as_of) ?? -1) - (holdingDays(a, preview.as_of) ?? -1) : 0);
  const totals = leadershipTotals(filtered, preview.as_of);
  const selected = filtered.find(project => project.id === selectedId);
  const stages = [...new Set(preview.projects.map(project => project.stage))];
  const stageRows = stages.map(label => {
    const projects = base.filter(project => project.stage === label);
    const groupTotals = leadershipTotals(projects, preview.as_of);
    return { label, projects, totals: groupTotals, value: distribution === 'count' ? projects.length : groupTotals.invested };
  });
  const maxValue = Math.max(1, ...stageRows.map(group => group.value));
  const baseTotals = leadershipTotals(base, preview.as_of);
  const choose = (project: LeadershipProject, section: '经营依据' | '推进与节点' = '经营依据') => {
    setSectionRequestId(n => n + 1); setSelectedId(project.id); setDetailSection(section); setDetailOpen(true);
  };
  const clear = () => { setQuery(''); setLifecycle('all'); setIssue('all'); setStage('all'); setSort('default'); setMetric(null); setDetailOpen(false); };
  const toolbar = <div className="ui-rd-toolbar">
    <label>{uiText("founderDesign.find.property")}<input aria-label={uiText("founderDesign.t.find.project")} value={query} onChange={event => { setQuery(event.target.value); setDetailOpen(false); }} placeholder={uiText("founderDesign.property.lead.or.issue")} /></label>
    <label>{uiText("founderDesign.project.scope")}<select aria-label={uiText("founderDesign.t.project.scope")} value={lifecycle} onChange={event => { setLifecycle(event.target.value); setDetailOpen(false); }}><option value="all">{uiText("founderDesign.all.projects")}</option><option value="active">{uiText("directorDesign.in.progress")}</option><option value="closed">{uiText("myTodoTable.sold.closeout")}</option><option value="lead">{uiText("founderDesign.lead")}</option></select></label>
    <label>{uiText("founderDesign.issue.scope")}<select aria-label={uiText("founderDesign.t.issue.filter")} value={issue} onChange={event => { setIssue(event.target.value as Issue | 'all'); setDetailOpen(false); }}><option value="all">{uiText("founderDesign.all.issues.and.on.track.projects")}</option>{Object.entries(issueLabels).map(([value, label]) => <option key={value} value={value}>{systemText(label)}</option>)}</select></label>
    <label>{uiText("founderDesign.sort")}<select aria-label={uiText("founderDesign.t.project.sort")} value={sort} onChange={event => setSort(event.target.value)}><option value="default">{uiText("founderDesign.default.order")}</option><option value="invested">{uiText("founderDesign.recorded.investment.high.to.low")}</option><option value="days">{uiText("founderDesign.holding.days.longest.first")}</option></select></label>
  </div>;
  const activeRows = [...new Map(rows.filter(project => project.lifecycle === 'active').map(project => [project.id, project])).values()];
  const attentionRows = activeRows.filter(project => overdueTasks(project, preview.as_of).length || project.tasks.some(task => task.status === 'review'));
  const metricPanel = metric && <section className="ui-rd-task-group" aria-label={uiText("founderDesign.operating.metric.breakdown")}>
    <div className="ui-rd-section-heading"><h3>{metric === 'invested' ? uiText("founderDesign.recorded.investment.breakdown") : metric === 'model' ? uiText("founderDesign.estimate.coverage.and.missing.data") : uiText("founderDesign.overdue.tasks.and.pending.submissions")}</h3><Button onClick={() => setMetric(null)}>{uiText("founderDesign.collapse.metric.details")}</Button></div>
    <p className="ui-rd-caption">{uiText("founderDesign.scope.remains.the.selected")} {filtered.length} {uiText("founderDesign.of")} {totals.active} {uiText("founderDesign.active.projects.expanding.explains.the.metric.without.changing.filters")}</p>
    {(metric === 'attention' ? attentionRows : activeRows).map(project => {
      const analysis = currentAnalysis(project);
      const overdue = overdueTasks(project, preview.as_of);
      const review = project.tasks.filter(task => task.status === 'review');
      return <button className="ui-rd-task" key={project.id} onClick={() => choose(project, metric === 'attention' ? '推进与节点' : '经营依据')}>
        <span><strong>{project.name}</strong>{metric === 'invested' ? <>
          <span>{uiText("founderDesign.purchase.price")} {money(project.purchase_price)} {uiText("founderDesign.recorded.expenses")} {money(project.expenses)}</span>
          <small>{investedScale(project) == null ? uiText("sentences.excluded.missing", { value1: ([project.purchase_price == null ? uiText("founderDesign.purchase.price") : '', project.expenses == null ? uiText("founderDesign.recorded.expenses.2") : ''].filter(Boolean).join('、')) }) : uiText("founderDesign.included.select.to.view.the.original.value.and.record")}</small>
        </> : metric === 'model' ? <>
          <span>{analysis ? `${analysis.label} · ${analysis.recorded_at}` : uiText("founderDesign.no.unique.current.analysis.version.found")}</span>
          <small>{analysis?.missing.length ? uiText("sentences.excluded.missing.2", { value1: (analysis.missing.join('、')) }) : analysis?.outputs ? uiText("founderDesign.complete.current.version.included.select.to.view.formulas.assumptions") : uiText("founderDesign.complete.current.outputs.are.missing.excluded.from.estimate.totals")}</small>
        </> : <>
          <span>{uiText("founderDesign.overdue.and.unfinished")} {overdue.length} {uiText("founderDesign.current.pending.submissions")} {review.length} {uiText("projectPreplan.items")}</span>
          <small>{overdue.length ? uiText("sentences.overdue", { value1: (overdue.map(task => uiText("sentences.due.2", { value1: (task.title), value2: (task.due_date) })).join('；')) }) : uiText("founderDesign.no.overdue.unfinished.tasks")}</small>
          <small>{review.length ? uiText("sentences.awaiting.review", { value1: (review.map(task => `${task.title}（${reviewAge(task, preview.as_of) == null ? uiText("founderDesign.submission.date.missing") : uiText("sentences.current.submission.days", { value1: (reviewAge(task, preview.as_of)) })}）`).join('；')) }) : uiText("founderDesign.no.current.submissions.awaiting.review")}</small>
        </>}</span>
        <span className="ui-rd-task-meta"><strong>{metric === 'invested' ? money(investedScale(project)) : metric === 'model' ? modelLabel(project) : uiText("founderDesign.view.progress.evidence")}</strong></span>
      </button>;
    })}
    {!(metric === 'attention' ? attentionRows : activeRows).length && <p className="ui-rd-empty">{metric === 'attention' ? uiText("founderDesign.no.overdue.unfinished.tasks.or.pending.submissions.in.this") : uiText("founderDesign.no.active.projects.in.this.scope.no.amount.breakdown")}</p>}
  </section>;
  const summary = <>
    <div className="ui-rd-section-heading"><h3>{uiText("founderDesign.selected")} {filtered.length} {uiText("founderDesign.properties")}</h3><span>{uiText("founderDesign.including.active")} {totals.active} {uiText("founderDesign.properties.sold.closeout")} {totals.closed} {uiText("directorDesign.properties")}</span></div>
    <dl className="ui-ld-summary"><div><dt>{uiText("founderDesign.active.recorded.project.investment")}</dt><dd>{totals.investedKnown ? money(totals.invested) : uiText("founderDesign.no.amounts.to.aggregate")}</dd><small>{uiText("founderDesign.coverage")} {totals.investedKnown}/{totals.active} {uiText("founderDesign.properties.purchase.price.recorded.expenses")}</small><Button onClick={() => setMetric(metric === 'invested' ? null : 'invested')}>{uiText("founderDesign.view.investment.breakdown")}</Button></div>
      <div><dt>{uiText("founderDesign.active.current.modeled.returns")}</dt><dd>{totals.modeled ? money(totals.modelProfit) : uiText("founderDesign.no.complete.estimates")}</dd><small>{uiText("founderDesign.coverage")} {totals.modeled}/{totals.active} {uiText("founderDesign.properties.incomplete.projects.excluded")}</small><Button onClick={() => setMetric(metric === 'model' ? null : 'model')}>{uiText("founderDesign.view.estimate.coverage")}</Button></div>
      <div><dt>{uiText("founderDesign.active.items.needing.review")}</dt><dd>{uiText("founderDesign.overdue.and.unfinished.2")} {totals.overdue} {uiText("founderDesign.awaiting.review")} {totals.review} {uiText("projectPreplan.items")}</dd><small>{uiText("founderDesign.a.task.may.be.both.overdue.and.awaiting.review")}</small><Button onClick={() => setMetric(metric === 'attention' ? null : 'attention')}>{uiText("founderDesign.view.overdue.and.pending.reviews")}</Button></div></dl>
    <p className="ui-rd-caption">{uiText("founderDesign.estimates.are.not.realized.profit.recorded.investment.is.not")}</p>
    {metricPanel}
  </>;
  const projectButton = (project: LeadershipProject, withTasks = false, section: '经营依据' | '推进与节点' = '经营依据') => <button key={project.id} className="ui-rd-task" aria-pressed={selected?.id === project.id} onClick={() => choose(project, section)}>
    <span><strong>{project.name}</strong><small>{systemText(project.stage)} · {lifecycleLabels[project.lifecycle]} · {project.coordinator}</small><span>{project.concern}</span><span>{uiText("directorDesign.next.step")}{project.next_action}</span>
      {withTasks && <span>{uiText("founderDesign.unfinished.and.due")} {overdueTasks(project, preview.as_of).length} {uiText("founderDesign.awaiting.review")} {project.tasks.filter(task => task.status === 'review').length} {uiText("projectPreplan.items")}</span>}
    </span><span className="ui-rd-task-meta"><strong>{daysLabel(project, preview.as_of)}</strong><small>{uiText("founderDesign.actual.holding.days")}</small><span>{modelLabel(project)}</span><small>{project.lifecycle === 'active' ? uiText("founderDesign.current.modeled.return.estimate") : lifecycleLabels[project.lifecycle]}</small></span>
  </button>;
  const ledger = <div className="ui-ld-table-scroll"><table className="ui-ld-table" aria-label={uiText("founderDesign.t.project.operating.ledger")}><thead><tr><th scope="col">{uiText("directorDesign.property.stage")}</th><th scope="col">{uiText("founderDesign.recorded.project.investment")}</th><th scope="col">{uiText("founderDesign.current.modeled.return.estimate")}</th><th scope="col">{uiText("founderDesign.actual.holding.period")}</th><th scope="col">{uiText("founderDesign.current.issue")}</th></tr></thead><tbody>{rows.map(project => <tr key={project.id} data-selected={selected?.id === project.id}>
    <td><button aria-pressed={selected?.id === project.id} onClick={() => choose(project)}>{project.name}</button><div>{systemText(project.stage)}</div></td>
    <td className="ui-sd-money">{project.lifecycle === 'active' ? money(investedScale(project)) : uiText("founderDesign.excluded.from.active.totals")}</td>
    <td className="ui-sd-money">{modelLabel(project)}</td><td>{daysLabel(project, preview.as_of)}</td>
    <td>{project.issues.length ? project.issues.map(kind => issueLabels[kind]).join('、') : uiText("founderDesign.no.issue.recorded")}</td>
  </tr>)}</tbody></table></div>;
  const issuesView = <>{(Object.keys(issueLabels) as Issue[]).map(kind => {
    const group = rows.filter(project => project.issues.includes(kind));
    return group.length ? <section className="ui-rd-task-group" key={kind}><h3>{issueLabels[kind]} <small>{group.length} {uiText("directorDesign.properties")}</small></h3>{group.map(project => projectButton(project, false, kind === 'progress' ? '推进与节点' : '经营依据'))}</section> : null;
  })}{rows.some(project => !project.issues.length) && <section className="ui-rd-task-group"><h3>{uiText("founderDesign.no.issue.recorded")}</h3>{rows.filter(project => !project.issues.length).map(project => projectButton(project))}</section>}
    <p className="ui-rd-caption">{uiText("founderDesign.a.property.may.have.several.issues.amounts.and.property")}</p></>;
  const flow = <>
    <div className="ui-rd-section-heading"><h3>{uiText("founderDesign.stage.distribution")}</h3><div className="ui-rd-tabs" role="group" aria-label={uiText("founderDesign.stage.distribution.metric")}><button aria-pressed={distribution === 'count'} onClick={() => setDistribution('count')}>{uiText("founderDesign.property.count")}</button><button aria-pressed={distribution === 'invested'} onClick={() => setDistribution('invested')}>{uiText("founderDesign.recorded.investment.in.active.projects")}</button></div></div>
    <p className="ui-rd-caption">{uiText("founderDesign.distribution.scope.current.search.and.project.issue.filters")} {base.length} {uiText("founderDesign.properties.2")}{distribution === 'invested' && uiText("sentences.recorded.investment.covers.active.properties", { value1: (baseTotals.investedKnown), value2: (baseTotals.active) })}{uiText("founderDesign.select.a.stage.to.filter.the.totals.and.properties")}</p>
    <div className="ui-ld-stage-list" role="group" aria-label={uiText("founderDesign.select.stage.to.view.projects")}>{stageRows.map(group => <button className="ui-ld-stage-button" key={group.label} aria-pressed={stage === group.label} onClick={() => { setStage(stage === group.label ? 'all' : group.label); setDetailOpen(false); }}>
      <span>{systemText(group.label)}</span><svg viewBox="0 0 360 28" width={360} height={28} aria-hidden="true"><rect x={0} y={4} width={group.value / maxValue * 360} height={20} fill="currentColor" /></svg>
      <span>{distribution === 'count' ? uiText("sentences.properties", { value1: (group.projects.length) }) : group.totals.investedKnown ? money(group.totals.invested) : uiText("founderDesign.no.amounts.to.aggregate")}</span>
    </button>)}</div>
    {summary}{rows.map(project => <section key={project.id} className="ui-rd-task-group">{projectButton(project, true, '推进与节点')}{project.tasks.filter(task => task.status === 'review').map(task => <button key={task.id} className="ui-rd-resource" onClick={() => choose(project, '推进与节点')}><span>{systemText(task.title)} · {task.owner}</span><span>{uiText("founderDesign.current.submission.awaiting.review")} {reviewAge(task, preview.as_of) == null ? uiText("founderDesign.incomplete.dates") : uiText("sentences.days", { value1: (reviewAge(task, preview.as_of)) })}</span></button>)}</section>)}
    <p className="ui-rd-caption">{uiText("founderDesign.holding.time.starts.on.the.actual.purchase.date.and")}</p>
  </>;
  const main = <div className="ui-rd-main"><header className="ui-rd-work-header"><div><h2>{systemText(design.title)}</h2><p>{uiText("founderDesign.review.operating.facts.across.all.projects.then.open.a")}</p></div></header>
    <p className="ui-rd-caption">{uiText("founderDesign.synthetic.data.snapshot.as.of")} {preview.as_of}{uiText("founderDesign.this.compares.management.views.only.it.does.not.change")}</p>
    {toolbar}<div className="ui-rd-section-heading"><span>{uiText("founderDesign.stage")}{stage === 'all' ? uiText("founderDesign.all") : stage}</span><Button onClick={clear}>{uiText("founderDesign.clear.all.filters")}</Button></div>
    {design.id === 'C' ? flow : <>{summary}{design.id === 'A' ? ledger : issuesView}</>}
    {!rows.length && <p className="ui-rd-empty">{uiText("founderDesign.no.properties.match.clear.filters.to.return.to.all")}</p>}
  </div>;
  const detail = selected ? <LeadershipProjectDetail sectionRequestId={sectionRequestId} project={selected} asOf={preview.as_of} initialSection={detailSection} /> : <p className="ui-rd-empty">{uiText("founderDesign.select.a.property.to.review.estimates.dates.tasks.and")}</p>;
  return <CollaborationWorkspace main={main} detail={detail} detailOpen={detailOpen && !!selected} onBack={() => setDetailOpen(false)} />;
}
