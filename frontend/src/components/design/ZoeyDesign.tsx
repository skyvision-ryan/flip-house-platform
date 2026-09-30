import { systemText } from '../../i18n/core.ts';
import { useLanguage } from '../../i18n/LanguageProvider';
import { m as uiText } from '../../i18n/core.ts';
import { Fragment, useState } from 'react';
import Button from '@cloudscape-design/components/button';
import type { RoleDesign, SpecialistPreview } from '../../lib/roleDesigns';
import CollaborationWorkspace from '../ui/CollaborationWorkspace';

type RecordItem = SpecialistPreview['records'][number];
const categories = ['全部', '图纸资料', 'Permit 资料', '检查记录'];
const statuses = ['待补资料', '未通过', '等待回复', '进行中', '已预约', '已上传', '已通过'];

/** One synthetic dataset, three ways to find Zoey's work. Never calls a business API. */
export default function ZoeyDesign({ preview, design }: { preview: SpecialistPreview; design: RoleDesign }) {
  useLanguage();
  const [houseId, setHouseId] = useState(preview.houses[0]?.id ?? '');
  const [selectedId, setSelectedId] = useState(preview.records[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [status, setStatus] = useState('全部');
  const [detailOpen, setDetailOpen] = useState(false);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const byHouse = design.layout === 'zoey-house';
  const register = design.layout === 'zoey-register';
  const houseName = (id: string) => preview.houses.find(h => h.id === id)?.name ?? id;
  const queryText = query.trim().toLowerCase();
  const rows = preview.records.filter(record => (!byHouse || record.house === houseId)
    && (category === '全部' || category === record.category)
    && (status === '全部' || status === record.status)
    && `${houseName(record.house)} ${record.title} ${record.category} ${record.owner} ${record.detail} ${record.documents.map(doc => doc.name).join(' ')}`.toLowerCase().includes(queryText));
  const selected = rows.find(record => record.id === selectedId);
  const document = selected?.documents.find(doc => doc.id === documentId);
  const house = preview.houses.find(item => item.id === houseId);
  const openRecord = (record: RecordItem, docId: string | null = null) => {
    setSelectedId(record.id);
    setHouseId(record.house);
    setDocumentId(docId);
    setEditing(false);
    setNotice('');
    setDetailOpen(true);
  };
  const chooseHouse = (id: string) => {
    setHouseId(id);
    setCategory('全部');
    setStatus('全部');
    setQuery('');
    setSelectedId(preview.records.find(record => record.house === id)?.id ?? '');
    setDocumentId(null);
    setEditing(false);
    setNotice('');
    setDetailOpen(false);
  };
  const listRow = (record: RecordItem) => <button key={record.id} className="ui-rd-task" aria-pressed={record.id === selectedId} onClick={() => openRecord(record)}>
    <span><small>{houseName(record.house)} · {systemText(record.category)}</small><strong>{systemText(record.title)}</strong><span>{systemText(record.detail)}</span></span>
    <span className="ui-rd-task-meta"><strong>{systemText(record.status)}</strong><span>{record.owner}</span><span>{record.documents.length ? uiText("counts.files", { count: (record.documents.length) }) : uiText("zoeyDesign.no.attachment")}</span></span>
  </button>;
  const controls = <>
    <div className="ui-rd-toolbar"><label>{uiText("zoeyDesign.search.property.task.or.file")}<input value={query} onChange={event => setQuery(event.target.value)} placeholder={uiText("zoeyDesign.for.example.oak.final.or.application.receipt")} /></label>
      <div role="group" aria-label={uiText("zoeyDesign.filter.zoey.record.status")}>{['全部', '待补资料', '未通过', '等待回复', '已预约'].map(value => <button key={value} aria-pressed={status === value} onClick={() => setStatus(value)}>{systemText(value)}</button>)}</div>
    </div>
    <div className="ui-rd-tabs" role="group" aria-label={uiText("zoeyDesign.filter.zoey.document.category")}>{categories.map(value => <button key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>{systemText(value)}</button>)}</div>
  </>;
  const content = <>
    {controls}
    <div className="ui-rd-section-heading"><h3>{byHouse ? uiText("sentences.design.and.permit", { value1: (house?.name ?? uiText("sabrinaDesign.property")) }) : register ? uiText("zoeyDesign.documents.and.related.records") : uiText("zoeyDesign.follow.up.across.properties")}</h3><span>{rows.length} {uiText("zoeyDesign.records")}</span></div>
    {!rows.length ? <div className="ui-rd-empty"><p>{uiText("zoeyDesign.no.matching.records")}</p><Button onClick={() => { setQuery(''); setCategory('全部'); setStatus('全部'); }}>{uiText("directorDesign.clear.filters")}</Button></div>
      : register ? <div className="ui-sd-table-scroll"><table className="ui-sd-ledger"><caption className="ui-sr-only">{uiText("zoeyDesign.zoey.s.documents.and.inspection.records.select.a.filename")}</caption><thead><tr><th>{uiText("zoeyDesign.file.record")}</th><th>{uiText("sabrinaDesign.property")}</th><th>{uiText("sabrinaDesign.category")}</th><th>{uiText("zoeyDesign.record.status")}</th></tr></thead><tbody>
        {rows.flatMap(record => record.documents.length ? record.documents.map(doc => <tr key={`${record.id}:${doc.id}`}><td><button className="ui-sd-link" aria-pressed={selectedId === record.id && documentId === doc.id} onClick={() => openRecord(record, doc.id)}>{doc.name}</button><small>{systemText(record.title)}</small></td><td>{houseName(record.house)}</td><td>{systemText(record.category)}</td><td>{systemText(record.status)}</td></tr>)
          : [<tr key={record.id}><td><button className="ui-sd-link" aria-pressed={selectedId === record.id} onClick={() => openRecord(record)}>{systemText(record.title)}</button><small>{uiText("zoeyDesign.no.attachment.view.original.record")}</small></td><td>{houseName(record.house)}</td><td>{systemText(record.category)}</td><td>{systemText(record.status)}</td></tr>])}
      </tbody></table></div>
        : byHouse ? rows.map(listRow) : statuses.map(value => { const group = rows.filter(record => record.status === value); return group.length ? <section className="ui-rd-task-group" key={value}><h3>{systemText(value)} <small>{group.length}</small></h3>{group.map(listRow)}</section> : null; })}
  </>;
  const main = <div className="ui-rd-main"><header className="ui-rd-work-header"><div><small>{uiText("zoeyDesign.permit.design.synthetic.workspace")}</small><h2>{systemText(design.title)}</h2><p>{uiText("zoeyDesign.check.the.property.s.stage.then.review.drawings.application")}</p></div></header>
    {byHouse ? <div className="ui-rd-house-layout"><nav aria-label={uiText("zoeyDesign.zoey.sample.property.navigation")}>{preview.houses.map(item => <button key={item.id} aria-pressed={houseId === item.id} onClick={() => chooseHouse(item.id)}><strong>{item.name}</strong><small>{systemText(item.stage)}</small></button>)}</nav><section>{content}</section></div>
      : <><div className="ui-sd-project-strip" aria-label={uiText("zoeyDesign.sample.property.overview")}>{preview.houses.map(item => <span key={item.id}><strong>{item.name}</strong><small>{systemText(item.stage)}</small></span>)}</div>{content}</>}
  </div>;
  const detail = selected ? <div className="ui-rd-detail"><small>{houseName(selected.house)} · {systemText(preview.houses.find(item => item.id === selected.house)?.stage)}</small><h2>{systemText(selected.title)}</h2><strong>{systemText(selected.status)}</strong><p>{systemText(selected.detail)}</p>
    <dl className="ui-rd-facts"><dt>{uiText("zoeyDesign.assigned.records")}</dt><dd>{selected.owner}</dd><dt>{uiText("fieldWithSource.source")}</dt><dd>{systemText(selected.source)}</dd>{selected.fields.map((field, index) => <Fragment key={`${field.label}:${index}`}><dt>{systemText(field.label)}</dt><dd>{systemText(field.value)}</dd></Fragment>)}</dl>
    <h3>{uiText("zoeyDesign.documents.for.this.record")}</h3>{selected.documents.length ? selected.documents.map(doc => <button key={doc.id} className="ui-rd-resource" aria-pressed={documentId === doc.id} onClick={() => setDocumentId(documentId === doc.id ? null : doc.id)}>{doc.name}<span>{documentId === doc.id ? uiText("zoeyDesign.collapse.documents") : uiText("zoeyDesign.view.documents")}</span></button>) : <p>{uiText("zoeyDesign.this.record.has.no.attachment.files.from.other.properties")}</p>}
    {document && <div className="ui-rd-file"><h3>{document.name}</h3><p>{houseName(selected.house)} · {systemText(selected.title)}</p><p>{systemText(document.detail)}</p><p>{uiText("zoeyDesign.synthetic.document.preview.no.real.file.is.opened.or")}</p><Button onClick={() => setDocumentId(null)}>{uiText("zoeyDesign.close.this.document")}</Button></div>}
    <h3>{uiText("zoeyDesign.additional.notes")}</h3><p>{notes[selected.id] ?? uiText("zoeyDesign.no.notes.added.to.this.preview")}</p>
    <Button variant="primary" onClick={() => { setDraft(notes[selected.id] ?? ''); setEditing(!editing); setNotice(''); }}>{editing ? uiText("leadershipProjectDetail.cancel.editing") : uiText("zoeyDesign.edit.preview.notes")}</Button>
    {editing && <div className="ui-rd-edit"><label>{uiText("zoeyDesign.only.for")} {systemText(selected.title)}<textarea maxLength={500} value={draft} onChange={event => setDraft(event.target.value)} /></label><Button onClick={() => { setNotes(previous => ({ ...previous, [selected.id]: draft.trim() || '未填写补充备注。' })); setEditing(false); setNotice(uiText("sentences.notes.for.are.saved.in.this.preview.and.remain.available", { value1: (selected.title) })); }}>{uiText("leadershipProjectDetail.save.to.this.preview")}</Button></div>}
    {notice && <p role="status">{systemText(notice)}</p>}
    <p className="ui-muted">{uiText("zoeyDesign.this.compares.information.and.document.access.only.notes.do")}</p>
  </div> : <p className="ui-rd-empty">{uiText("zoeyDesign.the.record.is.outside.the.current.filter.select.a")}</p>;
  return <><CollaborationWorkspace main={main} detail={detail} detailOpen={detailOpen && !!selected} onBack={() => setDetailOpen(false)} /><p className="ui-rd-caption">{uiText("zoeyDesign.existing.records.include.drawings.permit.file.types.tasks.waiting")}</p></>;
}
