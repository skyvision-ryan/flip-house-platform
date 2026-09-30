import { systemText } from '../../i18n/core.ts';
import { useLanguage } from '../../i18n/LanguageProvider';
import { m as uiText } from '../../i18n/core.ts';
import { Fragment, useState } from 'react';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import TextFilter from '@cloudscape-design/components/text-filter';
import type { RoleDesign } from '../../lib/roleDesigns';
import { currentAnalysis, holdingDays, overdueTasks, leadershipMoney as money, type LeadershipAnalysis, type LeadershipPreview, type LeadershipProject } from '../../lib/leadershipDesign';
import CollaborationWorkspace from '../ui/CollaborationWorkspace';
import Header from '../ui/Header';
import FormField from '../ui/FormField';
import LeadershipProjectDetail from './LeadershipProjectDetail';

const ISSUES = [
  { value: 'all', get label() { return uiText("directorDesign.all.topics"); } }, { value: 'data', get label() { return uiText("directorDesign.records.and.estimate.inputs"); } },
  { value: 'progress', get label() { return uiText("directorDesign.progress.and.milestones"); } }, { value: 'settlement', get label() { return uiText("directorDesign.sale.and.closing.records"); } },
];
const LIFECYCLES = [{ value: 'all', get label() { return uiText("directorDesign.all.properties"); } }, { value: 'lead', get label() { return uiText("directorDesign.not.purchased"); } }, { value: 'active', get label() { return uiText("directorDesign.in.progress"); } }, { value: 'closed', get label() { return uiText("directorDesign.sold"); } }];
const COSTS = [
  { key: 'purchase_total', get title() { return uiText("directorDesign.acquisition.and.additional.costs"); }, get description() { return uiText("directorDesign.purchase.price.plus.acquisition.charges.in.this.analysis.version"); } },
  { key: 'rehab_total', get title() { return uiText("directorDesign.renovation.cost.assumptions"); }, get description() { return uiText("directorDesign.sum.of.renovation.line.items.in.this.analysis.version"); } },
  { key: 'holding_total', get title() { return uiText("directorDesign.holding.and.financing.costs"); }, get description() { return uiText("directorDesign.estimated.holding.months.times.monthly.costs.plus.financing.interest"); } },
  { key: 'selling_total', get title() { return uiText("directorDesign.selling.cost.assumptions"); }, get description() { return uiText("directorDesign.assumed.sale.price.times.the.selling.cost.percentage.plus"); } },
] as const;
type CostKey = typeof COSTS[number]['key'];
const outputs = (analysis: LeadershipAnalysis | null | undefined) => analysis && !analysis.missing.length ? analysis.outputs : null;
const latestUpdate = (project: LeadershipProject) => [...project.updates].sort((a, b) => b.date.localeCompare(a.date))[0];

/** Director-facing design comparison. Only reads the authorized synthetic preview payload. */
export default function DirectorDesign({ preview, design }: { preview: LeadershipPreview; design: RoleDesign }) {
  useLanguage();
  const [sectionRequestId, setSectionRequestId] = useState(0);
  const [query, setQuery] = useState('');
  const [lifecycle, setLifecycle] = useState('all');
  const [issue, setIssue] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(preview.projects[0]?.id ?? null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedSection, setSelectedSection] = useState('经营依据');
  const [versionIds, setVersionIds] = useState<Record<string, string>>({});
  const [comparisonIds, setComparisonIds] = useState<Record<string, string>>({});
  const [cost, setCost] = useState<CostKey>('holding_total');
  const visible = preview.projects.filter(project => (lifecycle === 'all' || project.lifecycle === lifecycle)
    && (issue === 'all' || project.issues.includes(issue as LeadershipProject['issues'][number]))
    && `${project.name} ${project.stage} ${project.concern} ${project.next_action} ${project.coordinator}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = visible.find(project => project.id === selectedId) ?? null;
  const selectedCurrent = selected ? currentAnalysis(selected) : null;
  const selectedAnalysis = selected?.analyses.find(analysis => analysis.id === versionIds[selected.id]) ?? selectedCurrent;
  const compareAnalysis = selected?.analyses.find(analysis => analysis.id === comparisonIds[selected.id] && analysis.id !== selectedAnalysis?.id);
  const selectedOutputs = outputs(selectedAnalysis);
  const compareOutputs = outputs(compareAnalysis);
  const costDefinition = COSTS.find(item => item.key === cost)!;
  const choose = (project: LeadershipProject, open = true, section = '经营依据') => {
    setSectionRequestId(n => n + 1); setSelectedId(project.id); setSelectedSection(section); setDetailOpen(open);
  };
  const clear = () => { setQuery(''); setLifecycle('all'); setIssue('all'); };
  const empty = <div className="ui-rd-empty"><SpaceBetween size="s"><span>{uiText("directorDesign.no.properties.match.this.filter.does.not.expand.access")}</span><Button onClick={clear}>{uiText("directorDesign.clear.filters")}</Button></SpaceBetween></div>;
  const analysisProfit = (project: LeadershipProject) => {
    const current = currentAnalysis(project);
    if (project.lifecycle === 'closed') return <><button onClick={() => choose(project)}>{uiText("directorDesign.closing.reconciliation.pending")}</button><small>{uiText("directorDesign.historical.estimates.are.available.in.option.c.they.are")}</small></>;
    return <><button aria-label={uiText("sentences.view.estimate.inputs.for", { value1: (project.name) })} onClick={() => choose(project)}>{money(outputs(current)?.total_profit ?? null)}</button>
      <small>{current ? current.label : uiText("directorDesign.no.unique.current.analysis.version")}</small>
      <small>{project.lifecycle === 'lead' ? uiText("directorDesign.lead.analysis.assumptions.not.purchased") : uiText("directorDesign.current.model.estimate.not.final.net.profit")}</small></>;
  };

  const overview = <SpaceBetween size="m">
    <Header variant="h2" description={uiText("directorDesign.check.the.process.position.estimate.basis.and.open.questions")}>{uiText("directorDesign.director.s.project.review")}</Header>
    <div className="ui-sd-table-scroll"><table className="ui-sd-ledger"><caption className="ui-sr-only">{uiText("directorDesign.synthetic.property.review.visible.to.the.director")}</caption><thead><tr><th>{uiText("directorDesign.property.stage")}</th><th>{uiText("directorDesign.analysis.version.profit.estimate")}</th><th>{uiText("directorDesign.budget.recorded.expenses")}</th><th>{uiText("directorDesign.current.milestone.facts")}</th><th>{uiText("directorDesign.needs.verification")}</th></tr></thead><tbody>
      {visible.map(project => <tr key={project.id} data-selected={selected?.id === project.id}>
        <td><button aria-pressed={selected?.id === project.id} onClick={() => choose(project)}>{project.name}</button><small>{systemText(project.stage)}</small></td>
        <td>{analysisProfit(project)}</td>
        <td><button aria-label={uiText("sentences.view.budget.evidence.for", { value1: (project.name) })} onClick={() => choose(project)}>{money(project.budget)}</button><small>{uiText("directorDesign.recorded")} <button aria-label={uiText("sentences.view.expense.evidence.for", { value1: (project.name) })} onClick={() => choose(project)}>{money(project.expenses)}</button></small></td>
        <td>{systemText(project.gate.title)}<small>{uiText("directorDesign.prerequisites")}{project.gate.prerequisite_met ? uiText("taskSummaryPanel.requirements.met") : uiText("taskSummaryPanel.requirements.not.met")} · D{project.gate.d ? uiText("stepsPanel.confirmed") : uiText("directorDesign.unconfirmed")} / J{project.gate.j ? uiText("stepsPanel.confirmed") : uiText("directorDesign.unconfirmed")}</small></td>
        <td>{project.concern}<small>{project.financial_updated_at} {uiText("directorDesign.financial.record.timestamp")}</small></td>
      </tr>)}
    </tbody></table></div>
    {!visible.length && empty}
  </SpaceBetween>;

  const issueGroups = [...ISSUES.slice(1), { value: 'updates', label: uiText("directorDesign.recent.project.updates") }];
  const updates = <SpaceBetween size="m">
    <Header variant="h2" description={uiText("directorDesign.read.the.issue.records.and.next.step.first.each")}>{uiText("directorDesign.topics.and.recent.updates")}</Header>
    {issueGroups.map(group => {
      const projects = visible.filter(project => (issue === 'all' ? project.issues[0] ?? 'updates' : issue) === group.value);
      return projects.length ? <section className="ui-rd-task-group" key={group.value}><h3>{systemText(group.label)}<small>{projects.length} {uiText("directorDesign.properties")}</small></h3>
        {projects.map(project => {
          const recent = latestUpdate(project);
          const otherIssues = project.issues.filter(value => value !== group.value).map(value => ISSUES.find(item => item.value === value)?.label ?? value);
          return <button key={project.id} className="ui-rd-task" aria-pressed={selected?.id === project.id} onClick={() => choose(project, true, group.value === 'progress' ? uiText("directorDesign.progress.and.milestones.2") : group.value === 'data' ? uiText("directorDesign.operating.evidence") : uiText("directorDesign.records.and.documents"))}>
            <span><small>{project.name} · {systemText(project.stage)}</small><strong>{project.concern}</strong><span>{uiText("directorDesign.next.step")}{project.next_action}</span>
              {otherIssues.length > 0 && <span>{uiText("directorDesign.also.review")}{otherIssues.join('、')}</span>}
              {recent ? <span>{uiText("directorDesign.latest.record")} {recent.date} · {systemText(recent.title)}</span> : <span>{uiText("directorDesign.no.project.updates.yet")}</span>}</span>
            <span className="ui-rd-task-meta"><small>{uiText("directorDesign.coordinator")}{project.coordinator}</small><span>{overdueTasks(project, preview.as_of).length} {uiText("directorDesign.tasks.past.due")}</span></span>
          </button>;
        })}
      </section> : null;
    })}
    {!visible.length && empty}
  </SpaceBetween>;

  const assumptions = <SpaceBetween size="m">
    <Header variant="h2" description={uiText("directorDesign.select.a.property.and.analysis.version.then.inspect.its")}>{uiText("directorDesign.estimate.review.workspace")}</Header>
    <div className="ui-rd-house-layout"><nav aria-label={uiText("directorDesign.director.s.estimate.property.navigation")}>{visible.map(project => <button key={project.id} aria-pressed={selected?.id === project.id} onClick={() => choose(project, false)}><strong>{project.name}</strong><small>{systemText(project.stage)}</small></button>)}</nav>
      <section>{selected ? <SpaceBetween size="m">
        <Header variant="h3" description={uiText("sentences.project.coordinator", { value1: (selected.coordinator) })}>{selected.name}</Header>
        <Box>{uiText("directorDesign.holding.days")}{holdingDays(selected, preview.as_of) == null ? uiText("directorDesign.incomplete.dates.or.not.yet.purchased") : uiText("sentences.days", { value1: (holdingDays(selected, preview.as_of)) })}{uiText("directorDesign.actual.dates.and.assumed.holding.months.are.shown.separately")}</Box>
        {selected.analyses.length ? <>
          {!selectedCurrent && <Alert type="info">{uiText("directorDesign.current.analysis.version.is.ambiguous")}{selected.analyses.filter(analysis => analysis.current).length ? uiText("directorDesign.multiple.versions.are.marked.current") : uiText("directorDesign.no.version.is.marked.current")}{selectedAnalysis ? uiText("directorDesign.the.version.below.is.the.one.you.selected.to") : uiText("directorDesign.select.a.version.to.read.the.first.version.is")}</Alert>}
          <FormField label={uiText("directorDesign.view.analysis.version")}><Select ariaLabel={uiText("directorDesign.director.s.analysis.version")} placeholder={uiText("directorDesign.select.a.version.to.read")} options={selected.analyses.map(analysis => ({ value: analysis.id, label: `${analysis.label}${analysis.current ? selectedCurrent ? uiText("directorDesign.current.version") : uiText("directorDesign.current.designation.needs.review") : ''}` }))}
            selectedOption={selectedAnalysis ? { value: selectedAnalysis.id, label: `${selectedAnalysis.label}${selectedAnalysis.current ? selectedCurrent ? uiText("directorDesign.current.version") : uiText("directorDesign.current.designation.needs.review") : ''}` } : null}
            onChange={({ detail }) => setVersionIds(previous => ({ ...previous, [selected.id]: detail.selectedOption.value! }))} /></FormField>
          <FormField label={uiText("directorDesign.compare.another.version")}><Select ariaLabel={uiText("directorDesign.director.s.comparison.version")} disabled={!selectedAnalysis} options={[{ value: '', label: uiText("directorDesign.no.comparison") }, ...selected.analyses.filter(analysis => analysis.id !== selectedAnalysis?.id).map(analysis => ({ value: analysis.id, label: analysis.label }))]}
            selectedOption={compareAnalysis ? { value: compareAnalysis.id, label: compareAnalysis.label } : { value: '', label: uiText("directorDesign.no.comparison") }}
            onChange={({ detail }) => setComparisonIds(previous => ({ ...previous, [selected.id]: detail.selectedOption.value! }))} /></FormField>
          {selectedAnalysis && !selectedOutputs && <Alert type="info">{uiText("directorDesign.this.version.has.no.calculated.results.to.display")}{selectedAnalysis.missing.length ? uiText("sentences.missing.2", { value1: (selectedAnalysis.missing.join('、')) }) : uiText("directorDesign.complete.outputs.are.not.available")}{uiText("directorDesign.missing.amounts.have.not.been.treated.as.zero")}</Alert>}
          {compareAnalysis && !compareOutputs && <Alert type="info">{uiText("directorDesign.comparison.version.is.incomplete")}{compareAnalysis.missing.join('、') || uiText("directorDesign.no.complete.calculation.results")}{uiText("directorDesign.version.differences.are.not.calculated")}</Alert>}
          <dl className="ui-sd-budget-strip"><div><dt>{uiText("directorDesign.assumed.sale.price")}</dt><dd>{money(selectedOutputs?.sale_price ?? null)}</dd></div><div><dt>{uiText("directorDesign.modeled.total.cost")}</dt><dd>{money(selectedOutputs?.total_costs ?? null)}</dd></div><div><dt>{uiText("directorDesign.modeled.profit.estimate")}</dt><dd>{money(selectedOutputs?.total_profit ?? null)}</dd></div></dl>
          <div className="ui-sd-table-scroll"><table className="ui-sd-ledger"><caption className="ui-sr-only">{uiText("directorDesign.cost.breakdown.for.this.version.select.a.cost.to")}</caption><thead><tr><th>{uiText("directorDesign.cost.item")}</th><th>{systemText(selectedAnalysis?.label)}</th>{compareAnalysis && <><th>{systemText(compareAnalysis.label)}</th><th>{uiText("directorDesign.selected.minus.comparison")}</th></>}</tr></thead><tbody>
            {COSTS.map(item => <tr key={item.key} data-selected={cost === item.key}><td><button aria-pressed={cost === item.key} onClick={() => { setCost(item.key); setDetailOpen(true); }}>{systemText(item.title)}</button></td><td>{money(selectedOutputs?.[item.key] ?? null)}</td>{compareAnalysis && <><td>{money(compareOutputs?.[item.key] ?? null)}</td><td>{money(selectedOutputs && compareOutputs ? selectedOutputs[item.key] - compareOutputs[item.key] : null)}</td></>}</tr>)}
          </tbody></table></div>
          {selectedOutputs && compareOutputs && <Box>{uiText("directorDesign.compared.with")}{systemText(compareAnalysis?.label)}{uiText("directorDesign.sale.price.assumption.difference")} {money(selectedOutputs.sale_price - compareOutputs.sale_price)}{uiText("directorDesign.total.cost.difference")} {money(selectedOutputs.total_costs - compareOutputs.total_costs)}{uiText("directorDesign.profit.estimate.difference")} {money(selectedOutputs.total_profit - compareOutputs.total_profit)}{uiText("directorDesign.the.comparison.version.s.estimated.profit.is")} {money(compareOutputs.total_profit)}。</Box>}
          <Box color="text-body-secondary">{uiText("directorDesign.modeled.profit.assumed.sale.price.modeled.total.cost.it")}</Box>
          <Button onClick={() => setDetailOpen(true)}>{uiText("directorDesign.view.selected.cost.inputs.and.property.records")}</Button>
        </> : <Box>{uiText("directorDesign.this.property.has.no.analysis.version.estimates.remain.unknown")}</Box>}
      </SpaceBetween> : <div className="ui-rd-empty">{uiText("directorDesign.select.a.property.that.matches.the.filters")}</div>}</section>
    </div>
    {!visible.length && empty}
  </SpaceBetween>;

  const detail = selected ? <>
    {design.id === 'C' && <div className="ui-rd-detail"><SpaceBetween size="m">
      <Header variant="h2">{systemText(costDefinition.title)}</Header><p>{costDefinition.description}</p>
      <dl className="ui-rd-facts"><dt>{uiText("directorDesign.selected.version")}</dt><dd>{selectedAnalysis?.label ?? uiText("directorDesign.no.analysis.version.selected")}</dd><dt>{uiText("directorDesign.version.recorded.at")}</dt><dd>{selectedAnalysis?.recorded_at ?? uiText("directorDesign.not.recorded")}</dd><dt>{uiText("directorDesign.estimate.for.this.item")}</dt><dd>{money(selectedOutputs?.[cost] ?? null)}</dd></dl>
      <Header variant="h3" description={uiText("directorDesign.complete.inputs.for.the.selected.version.source.descriptions.are")}>{uiText("directorDesign.version.assumptions.and.sources")}</Header>
      {selectedAnalysis?.assumptions.length ? <dl className="ui-rd-facts">{selectedAnalysis.assumptions.map((item, index) => <Fragment key={`${item.label}:${index}`}><dt>{systemText(item.label)}</dt><dd>{item.value}<details><summary>{uiText("directorDesign.view.source")}</summary><p>{systemText(item.source)}</p></details></dd></Fragment>)}</dl> : <Box>{uiText("directorDesign.no.assumption.sources.available")}</Box>}
      {compareAnalysis && <details><summary>{uiText("directorDesign.view.comparison.assumptions")} {systemText(compareAnalysis.label)}</summary><dl className="ui-rd-facts">{compareAnalysis.assumptions.map((item, index) => <Fragment key={`${item.label}:${index}`}><dt>{systemText(item.label)}</dt><dd>{item.value}<p>{systemText(item.source)}</p></dd></Fragment>)}</dl></details>}
    </SpaceBetween></div>}
    <LeadershipProjectDetail sectionRequestId={sectionRequestId} project={selected} asOf={preview.as_of} initialSection={selectedSection} />
  </> : <div className="ui-rd-empty">{uiText("directorDesign.the.selected.property.is.outside.the.current.filter.select")}</div>;

  return <SpaceBetween size="m">
    <div className="ui-rd-toolbar"><TextFilter filteringText={query} filteringAriaLabel={uiText("directorDesign.search.director.s.projects")} filteringPlaceholder={uiText("directorDesign.search.property.issue.or.next.step")} onChange={({ detail }) => setQuery(detail.filteringText)} />
      <Select ariaLabel={uiText("directorDesign.director.s.project.scope")} options={LIFECYCLES} selectedOption={LIFECYCLES.find(item => item.value === lifecycle)!} onChange={({ detail }) => setLifecycle(detail.selectedOption.value!)} />
      <Select ariaLabel={uiText("directorDesign.director.s.topic.filter")} options={ISSUES} selectedOption={ISSUES.find(item => item.value === issue)!} onChange={({ detail }) => setIssue(detail.selectedOption.value!)} />
    </div>
    <Box color="text-body-secondary">{visible.length} / {preview.projects.length} {uiText("directorDesign.synthetic.properties.observation.date")} {preview.as_of} {uiText("directorDesign.this.page.does.not.execute.pricing.signing.or.d")}</Box>
    <CollaborationWorkspace main={<div className="ui-rd-main">{design.id === 'A' ? overview : design.id === 'B' ? updates : assumptions}</div>}
      detail={detail} detailOpen={detailOpen && !!selected} onBack={() => setDetailOpen(false)} />
  </SpaceBetween>;
}
