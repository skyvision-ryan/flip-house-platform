import { systemText } from '../../i18n/core.ts';
import { useLanguage } from '../../i18n/LanguageProvider';
import { m as uiText } from '../../i18n/core.ts';
import { Fragment, useState } from 'react';
import Button from '@cloudscape-design/components/button';
import CollaborationWorkspace from '../ui/CollaborationWorkspace';
import type { RoleDesign, SpecialistPreview } from '../../lib/roleDesigns';
import { filterFinanceRecords, financePreviewTotals, formatFinanceMoney as money, isUnregisteredFinanceRecord as pending } from '../../lib/financeDesign';

type RecordRow = SpecialistPreview['records'][number];

/** Three information architectures over the same synthetic financial records. */
export default function SabrinaDesign({ preview, design }: { preview: SpecialistPreview; design: RoleDesign }) {
  useLanguage();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('全部');
  const [houseId, setHouseId] = useState(preview.houses[0]?.id ?? '');
  const [houseFilter, setHouseFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [descending, setDescending] = useState(false);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const houseName = (id: string) => preview.houses.find(house => house.id === id)?.name ?? id;
  const byHouse = design.id === 'C';
  const effectiveHouse = byHouse ? houseId : houseFilter;
  const rows = filterFinanceRecords(preview, query, status, effectiveHouse);
  const sortedRows = descending ? [...rows].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)) : rows;
  const selected = rows.find(row => row.id === selectedId);
  const selectedDocument = selected?.documents.find(document => document.id === documentId);
  const statuses = ['待付款核实', '金额待核', '凭证待补', '已登记'];
  const choose = (row: RecordRow) => {
    setSelectedId(row.id); setHouseId(row.house); setDocumentId(null); setEditing(false); setMessage(''); setDetailOpen(true);
  };
  const clearDetail = () => { setDetailOpen(false); setDocumentId(null); setEditing(false); setMessage(''); };
  const toolbar = <div className="ui-rd-toolbar">
    <label>{uiText("sabrinaDesign.find.record")}<input aria-label={uiText("sabrinaDesign.find.financial.records")} value={query} placeholder={uiText("sabrinaDesign.property.expense.or.supplier")} onChange={event => { setQuery(event.target.value); clearDetail(); }} /></label>
    {!byHouse && <label>{uiText("sabrinaDesign.property")}<select aria-label={uiText("sabrinaDesign.financial.property.filter")} value={houseFilter} onChange={event => { setHouseFilter(event.target.value); clearDetail(); }}><option value="all">{uiText("directorDesign.all.properties")}</option>{preview.houses.map(house => <option key={house.id} value={house.id}>{house.name}</option>)}</select></label>}
    <label>{uiText("sabrinaDesign.verification.status")}<select aria-label={uiText("sabrinaDesign.financial.status.filter")} value={status} onChange={event => { setStatus(event.target.value); clearDetail(); }}><option value="全部">{uiText("founderDesign.all")}</option>{statuses.map(value => <option key={value} value={value}>{systemText(value)}</option>)}</select></label>
  </div>;
  const recordButton = (row: RecordRow) => <button className="ui-rd-task" key={row.id} aria-pressed={selected?.id === row.id} onClick={() => choose(row)}>
    <span><strong>{systemText(row.title)}</strong><small>{houseName(row.house)} · {systemText(row.category)}</small><span>{systemText(row.detail)}</span></span>
    <span className="ui-rd-task-meta"><strong>{money(row.amount ?? 0)}</strong><small>{systemText(row.status)}</small>{pending(row) && <small>{uiText("sabrinaDesign.excluded.from.recorded.expenses")}</small>}</span>
  </button>;
  const ledger = <div className="ui-sd-table-scroll"><table className="ui-sd-ledger" aria-label={uiText("sabrinaDesign.synthetic.expense.ledger")}><thead><tr><th scope="col">{uiText("sabrinaDesign.expense.property")}</th><th scope="col">{uiText("sabrinaDesign.category")}</th><th scope="col" className="ui-sd-money"><button onClick={() => setDescending(!descending)} aria-label={descending ? uiText("sabrinaDesign.restore.default.expense.order") : uiText("sabrinaDesign.sort.expenses.by.amount.high.to.low")}>{uiText("procurementItemRow.amount")}{descending ? ' ↓' : ''}</button></th><th scope="col">{uiText("sabrinaDesign.verification.status")}</th></tr></thead><tbody>{sortedRows.map(row => <tr key={row.id} data-selected={selected?.id === row.id}><td><button aria-pressed={selected?.id === row.id} onClick={() => choose(row)}>{systemText(row.title)}</button><div>{houseName(row.house)}</div></td><td>{systemText(row.category)}</td><td className="ui-sd-money">{money(row.amount ?? 0)}{pending(row) && <div>{uiText("sabrinaDesign.not.recorded")}</div>}</td><td>{systemText(row.status)}</td></tr>)}</tbody></table></div>;
  const houseRecords = preview.records.filter(row => row.house === houseId);
  const { planned, registered: spent, remaining } = financePreviewTotals(houseRecords);
  const main = <div className="ui-rd-main">
    <header className="ui-rd-work-header"><div><h2>{systemText(design.title)}</h2><p>{uiText("sabrinaDesign.match.expenses.to.properties.and.amounts.to.receipts.verify")}</p></div></header>
    <p className="ui-rd-caption">{uiText("sabrinaDesign.all.amounts.and.receipts.are.synthetic.examples.the.current")}</p>
    {byHouse ? <div className="ui-rd-house-layout"><nav aria-label={uiText("sabrinaDesign.financial.property.navigation")}>{preview.houses.map(house => <button key={house.id} aria-pressed={houseId === house.id} onClick={() => { setHouseId(house.id); setStatus('全部'); setQuery(''); clearDetail(); }}><strong>{house.name}</strong><small>{systemText(house.stage)}</small></button>)}</nav><section>
      <div className="ui-rd-house-title"><h2>{houseName(houseId)}</h2><span>{uiText("sabrinaDesign.all.sample.records.for.this.property")}</span></div>
      <dl className="ui-sd-budget-strip"><div><dt>{uiText("sabrinaDesign.category.budget")}</dt><dd>{money(planned)}</dd></div><div><dt>{uiText("founderDesign.recorded.expenses.2")}</dt><dd>{money(spent)}</dd></div><div><dt>{uiText("sabrinaDesign.budget.less.recorded.expenses")}</dt><dd>{money(remaining)}</dd></div></dl>
      <p className="ui-rd-caption">{uiText("sabrinaDesign.the.difference.is.not.savings.or.profit.unrecorded.receipts")}</p>
      {toolbar}{rows.map(recordButton)}
    </section></div> : <>{toolbar}<div className="ui-rd-section-heading"><h3>{rows.length} {uiText("sabrinaDesign.sample.records")}</h3><span>{uiText("sabrinaDesign.recorded.expenses.in.filter")} {money(financePreviewTotals(rows).registered)}</span></div>
      {design.id === 'A' ? ledger : statuses.map(group => { const groupRows = rows.filter(row => row.status === group); return groupRows.length ? <section className="ui-rd-task-group" key={group}><h3>{group} <small>{groupRows.length}</small></h3>{groupRows.map(recordButton)}</section> : null; })}</>}
    {!rows.length && <p className="ui-rd-empty">{uiText("sabrinaDesign.no.financial.records.match.clear.the.search.or.select")}</p>}
  </div>;
  const detail = selected ? <div className="ui-rd-detail">
    <h2>{systemText(selected.title)}</h2><p>{houseName(selected.house)} · {systemText(selected.status)}</p><p>{systemText(selected.detail)}</p>
    <dl className="ui-rd-facts"><dt>{pending(selected) ? uiText("sabrinaDesign.unverified.receipt.amount") : uiText("sabrinaDesign.recorded.amount")}</dt><dd>{money(selected.amount ?? 0)}</dd><dt>{uiText("sabrinaDesign.category.budget")}</dt><dd>{money(selected.planned ?? 0)}</dd><dt>{uiText("sabrinaDesign.recorded.amount.less.budget")}</dt><dd>{pending(selected) ? uiText("sabrinaDesign.not.recorded.difference.not.calculated") : money((selected.amount ?? 0) - (selected.planned ?? 0))}</dd>{selected.fields.map(field => <Fragment key={field.label}><dt>{systemText(field.label)}</dt><dd>{systemText(field.value)}</dd></Fragment>)}<dt>{uiText("sabrinaDesign.record.source")}</dt><dd>{systemText(selected.source)}</dd></dl>
    <h3>{uiText("sabrinaDesign.linked.documents")}</h3>{selected.documents.length ? selected.documents.map(document => <button key={document.id} className="ui-rd-resource" aria-expanded={documentId === document.id} onClick={() => setDocumentId(documentId === document.id ? null : document.id)}>{document.name}<span>{uiText("sabrinaDesign.view.content")}</span></button>) : <p>{uiText("sabrinaDesign.no.receipt.is.linked.this.gap.remains.an.expense")}</p>}
    {selectedDocument && <section className="ui-rd-file" aria-label={uiText("sabrinaDesign.financial.document.preview")}><h3>{selectedDocument.name}</h3><p>{systemText(selectedDocument.detail)}</p><p className="ui-rd-caption">{uiText("sabrinaDesign.for.comparing.navigation.only.not.a.real.file")}</p><Button onClick={() => setDocumentId(null)}>{uiText("sabrinaDesign.close.document.preview")}</Button></section>}
    <h3>{uiText("sabrinaDesign.verification.notes")}</h3><p>{notes[selected.id] ?? uiText("sabrinaDesign.no.notes.entered.for.this.preview")}</p>
    <Button variant="primary" onClick={() => { setDraft(notes[selected.id] ?? ''); setEditing(!editing); setMessage(''); }}>{editing ? uiText("leadershipProjectDetail.cancel.editing") : uiText("sabrinaDesign.edit.verification.notes")}</Button>
    {editing && <div className="ui-rd-edit"><label>{uiText("sabrinaDesign.verification.notes.for.this.record")}<textarea maxLength={500} value={draft} onChange={event => setDraft(event.target.value)} /></label><Button onClick={() => { setNotes(value => ({ ...value, [selected.id]: draft.trim() || '尚未填写本次预览备注。' })); setEditing(false); setMessage(uiText("sabrinaDesign.notes.remain.in.this.preview.across.options.and.reset")); }}>{uiText("leadershipProjectDetail.save.to.this.preview")}</Button></div>}
    {message && <p role="status">{message}</p>}
  </div> : <p className="ui-rd-empty">{uiText("sabrinaDesign.select.an.expense.to.view.its.amount.budget.and")}</p>;
  return <CollaborationWorkspace main={main} detail={detail} detailOpen={detailOpen && !!selected} onBack={() => setDetailOpen(false)} />;
}
