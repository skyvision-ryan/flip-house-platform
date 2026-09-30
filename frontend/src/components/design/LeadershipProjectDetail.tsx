import { systemText } from '../../i18n/core.ts';
import { useLanguage } from '../../i18n/LanguageProvider';
import { m as uiText } from '../../i18n/core.ts';
import { Fragment, useEffect, useState } from 'react';
import Button from '@cloudscape-design/components/button';
import { currentAnalysis, holdingDays, investedScale, leadershipMoney as money, overdueTasks, reviewAge, type LeadershipProject } from '../../lib/leadershipDesign';
const statuses = { todo: '未开始', doing: '进行中', waiting: '等待中', review: '待审核', done: '已完成', na: '不适用' };

export default function LeadershipProjectDetail({ project: p, asOf, initialSection = '经营依据', sectionRequestId = 0 }: { project: LeadershipProject; asOf: string; initialSection?: string; sectionRequestId?: number }) {
  useLanguage();
  const [section, setSection] = useState(initialSection);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { setSection(initialSection); }, [p.id, initialSection, sectionRequestId]);
  useEffect(() => { setDocumentId(null); setEditing(false); setNotice(''); }, [p.id]);
  const model = currentAnalysis(p);
  const days = holdingDays(p, asOf);
  const file = p.documents.find(d => d.id === documentId);
  return <div className="ui-rd-detail">
    <h2>{p.name}</h2><p>{systemText(p.stage)} {uiText("leadershipProjectDetail.coordinator")} {p.coordinator}</p>
    <h3>{uiText("leadershipProjectDetail.current.focus")}</h3><p>{p.concern}</p><h3>{uiText("leadershipProjectDetail.next.check")}</h3><p>{p.next_action}</p>
    <div className="ui-rd-tabs" role="group" aria-label={uiText("leadershipProjectDetail.property.evidence.tabs")}>{['经营依据', '推进与节点', '资料与记录'].map(s => <button key={s} aria-pressed={section === s} onClick={() => setSection(s)}>{systemText(s)}</button>)}</div>
    {section === '经营依据' && <>
      <dl className="ui-rd-facts"><dt>{uiText("founderDesign.purchase.price")}</dt><dd>{money(p.purchase_price)}</dd><dt>{uiText("founderDesign.recorded.expenses.2")}</dt><dd>{money(p.expenses)}</dd><dt>{uiText("updatesList.budget")}</dt><dd>{money(p.budget)}</dd><dt>{uiText("leadershipProjectDetail.budget.less.recorded.expenses")}</dt><dd>{money(p.budget == null || p.expenses == null ? null : p.budget - p.expenses)}</dd><dt>{uiText("leadershipProjectDetail.purchase.price.recorded.expenses")}</dt><dd>{p.lifecycle === 'lead' ? uiText("leadershipProjectDetail.not.purchased.excluded") : money(investedScale(p))}</dd><dt>{uiText("leadershipProjectDetail.amount.recorded.at")}</dt><dd>{p.financial_updated_at}</dd></dl>
      <p className="ui-rd-caption">{uiText("leadershipProjectDetail.source.project.purchase.price.budget.lines.and.expense.records")}</p>
      {p.lifecycle === 'closed' ? <><h3>{uiText("leadershipProjectDetail.closing.reconciliation.pending")}</h3><dl className="ui-rd-facts"><dt>{uiText("leadershipProjectDetail.recorded.sale.price")}</dt><dd>{money(p.sale_price)}</dd><dt>{uiText("leadershipProjectDetail.actual.net.profit.net.proceeds")}</dt><dd>{uiText("leadershipProjectDetail.complete.closing.and.payment.evidence.required")}</dd></dl><p>{uiText("leadershipProjectDetail.sale.price.is.not.cash.received.historical.estimates.do")}</p></> : <>
        <h3>{p.lifecycle === 'lead' ? uiText("leadershipProjectDetail.lead.analysis.assumptions") : uiText("leadershipProjectDetail.current.modeled.profit")}</h3>
        <p className="ui-ld-amount">{model?.outputs && !model.missing.length ? money(model.outputs.total_profit) : uiText("leadershipProjectDetail.incomplete.inputs.not.calculated")}</p>
        <p>{model ? `${model.label} · ${model.recorded_at}` : uiText("founderDesign.no.unique.current.analysis.version.found")}</p>
        {model?.missing.length ? <p>{uiText("leadershipProjectDetail.missing")}{model.missing.join('、')}</p> : null}
        {model?.outputs && !model.missing.length && <><dl className="ui-rd-facts"><dt>{uiText("leadershipProjectDetail.estimated.sale.price")}</dt><dd>{money(model.outputs.sale_price)}</dd><dt>{uiText("leadershipProjectDetail.acquisition.including.charges")}</dt><dd>{money(model.outputs.purchase_total)}</dd><dt>{uiText("leadershipProjectDetail.renovation.assumption")}</dt><dd>{money(model.outputs.rehab_total)}</dd><dt>{uiText("leadershipProjectDetail.holding.including.modeled.interest")}</dt><dd>{money(model.outputs.holding_total)}</dd><dt>{uiText("leadershipProjectDetail.selling.cost.assumption")}</dt><dd>{money(model.outputs.selling_total)}</dd></dl><p>{uiText("leadershipProjectDetail.formula.estimated.sale.price.acquisition.renovation.holding.and.interest")}</p></>}
        {model && <details><summary>{uiText("leadershipProjectDetail.expand.input.assumptions.and.sources")}</summary>{model.assumptions.map(a => <Fragment key={a.label}><h4>{systemText(a.label)} · {a.value}</h4><p>{systemText(a.source)}</p></Fragment>)}</details>}
      </>}
    </>}
    {section === '推进与节点' && <>
      <dl className="ui-rd-facts"><dt>{p.lifecycle === 'closed' ? uiText("leadershipProjectDetail.purchase.to.sale.interval") : uiText("leadershipProjectDetail.days.since.purchase")}</dt><dd>{days == null ? uiText("leadershipProjectDetail.actual.dates.incomplete") : uiText("sentences.days", { value1: (days) })}</dd><dt>{uiText("leadershipProjectDetail.purchase.date")}</dt><dd>{p.purchase_date ?? uiText("directorDesign.not.recorded")}</dd><dt>{uiText("leadershipProjectDetail.planned.finish.date")}</dt><dd>{p.planned_end ?? uiText("directorDesign.not.recorded")}</dd><dt>{uiText("leadershipProjectDetail.overdue.unfinished.tasks")}</dt><dd>{overdueTasks(p, asOf).length} {uiText("leadershipProjectDetail.as.of")} {asOf}</dd></dl>
      <p>{uiText("leadershipProjectDetail.a.planned.date.is.not.actual.completion.holding.days")}</p>
      <h3>{systemText(p.gate.title)}</h3><p>{systemText(p.gate.detail)}</p><dl className="ui-rd-facts"><dt>{uiText("leadershipProjectDetail.prerequisite.facts")}</dt><dd>{p.gate.prerequisite_met ? uiText("taskSummaryPanel.requirements.met") : uiText("taskSummaryPanel.requirements.not.met")}</dd><dt>{uiText("leadershipProjectDetail.d.confirmation")}</dt><dd>{p.gate.d ? uiText("leadershipProjectDetail.recorded") : uiText("directorDesign.not.recorded")}</dd><dt>{uiText("leadershipProjectDetail.j.confirmation")}</dt><dd>{p.gate.j ? uiText("leadershipProjectDetail.recorded") : uiText("directorDesign.not.recorded")}</dd></dl>
      <h3>{uiText("leadershipProjectDetail.task.and.waiting.evidence")}</h3>{p.tasks.map(t => <section className="ui-ld-task-fact" key={t.id}><h4>{systemText(t.title)}</h4><p>{systemText(statuses[t.status])} · {t.owner}</p><p>{uiText("leadershipProjectDetail.due")}{t.due_date ?? uiText("leadershipProjectDetail.not.set")}{reviewAge(t, asOf) != null ? uiText("sentences.current.submission.awaiting.review.for.calendar.days", { value1: (reviewAge(t, asOf)) }) : ''}</p>{t.wait_reason && <p>{uiText("leadershipProjectDetail.waiting.2")}{t.waiting_for}；{t.wait_reason}</p>}</section>)}
      <p className="ui-rd-caption">{uiText("leadershipProjectDetail.task.counts.and.current.review.age.identify.backlogs.not")}</p>
    </>}
    {section === '资料与记录' && <>
      <h3>{uiText("leadershipProjectDetail.related.documents")}</h3>{p.documents.map(d => <button className="ui-rd-resource" key={d.id} aria-expanded={documentId === d.id} onClick={() => setDocumentId(documentId === d.id ? null : d.id)}>{d.name}<span>{uiText("leadershipProjectDetail.view.evidence")}</span></button>)}
      {file && <section className="ui-rd-file"><h3>{file.name}</h3><p>{systemText(file.detail)}</p><p>{uiText("leadershipProjectDetail.source")}{systemText(file.source)}</p><Button onClick={() => setDocumentId(null)}>{uiText("leadershipProjectDetail.close.document")}</Button></section>}
      <h3>{uiText("leadershipProjectDetail.project.updates")}</h3>{p.updates.map((u,i) => <section key={i}><h4>{u.date} · {systemText(u.title)}</h4><p>{systemText(u.detail)}</p></section>)}
    </>}
    <h3>{uiText("leadershipProjectDetail.focus.for.this.review")}</h3><p>{notes[p.id] ?? uiText("leadershipProjectDetail.not.entered")}</p><Button variant="primary" onClick={() => { setDraft(notes[p.id] ?? ''); setEditing(!editing); setNotice(''); }}>{editing ? uiText("leadershipProjectDetail.cancel.editing") : uiText("leadershipProjectDetail.record.preview.focus")}</Button>
    {editing && <div className="ui-rd-edit"><label>{p.name} {uiText("leadershipProjectDetail.review.focus")}<textarea maxLength={500} value={draft} onChange={e=>setDraft(e.target.value)} /></label><Button onClick={()=>{setNotes(n=>({...n,[p.id]:draft.trim()}));setEditing(false);setNotice(uiText("leadershipProjectDetail.is.retained.in.this.preview.only.no.messages.or"));}}>{uiText("leadershipProjectDetail.save.to.this.preview")}</Button></div>}{notice && <p role="status">{systemText(notice)}</p>}
  </div>;
}
