import { systemText } from '../../i18n/core.ts';
import { useLanguage } from '../../i18n/LanguageProvider';
import { m as uiText } from '../../i18n/core.ts';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Modal from '@cloudscape-design/components/modal';
import ProcurementFields from '../ProcurementFields';
import { money } from '../../lib/format';
import { deliveryLabel, procurementDraft, procurementChanges, procurementError, type ProcurementDraft } from '../../lib/procurement';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import TextFilter from '@cloudscape-design/components/text-filter';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RoleDesign, SpecialistPreview } from '../../lib/roleDesigns';
import CollaborationWorkspace from '../ui/CollaborationWorkspace';
import FormField from '../ui/FormField';
import Header from '../ui/Header';
import { Table } from '../ui/Surface';

type RecordItem = SpecialistPreview['records'][number];
const STATUSES = ['待选型', '待下单', '已下单', '已到货', '异常', '不适用'];
const statusKind = (value: string): 'pending' | 'in-progress' | 'success' | 'error' | 'stopped' =>
  value === '异常' ? 'error' : value === '已到货' ? 'success' : value === '已下单' ? 'in-progress' : value === '不适用' ? 'stopped' : 'pending';

/** Three organizations of the same synthetic procurement records, with no business API writes. */
export default function ProcurementDesign({ preview, design }: { preview: SpecialistPreview; design: RoleDesign }) {
  useLanguage();
  const [query, setQuery] = useState('');
  const [house, setHouse] = useState('all');
  const [status, setStatus] = useState('all');
  const [category, setCategory] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Partial<RecordItem>>>({});
  const [draftStatus, setDraftStatus] = useState('');
  const [draft, setDraft] = useState<ProcurementDraft>(procurementDraft());
  const [error, setError] = useState('');
  const [images, setImages] = useState<Record<string, { url: string; name: string }[]>>({});
  const urls = useRef<string[]>([]);
  const [fullImage, setFullImage] = useState<{ url: string; name: string } | null>(null);
  useEffect(() => () => urls.current.forEach(url => URL.revokeObjectURL(url)), []);
  const [saved, setSaved] = useState(false);
  const rows = useMemo(() => preview.records.map(row => ({ ...row, ...overrides[row.id] })), [preview.records, overrides]);
  const houseName = (id: string) => preview.houses.find(item => item.id === id)?.name ?? id;
  const houseOptions = [{ value: 'all', label: uiText("directorDesign.all.properties") }, ...preview.houses.map(item => ({ value: item.id, label: item.name }))];
  const categoryOptions = [{ value: 'all', label: uiText("procurementDesign.all.procurement.milestones") }, ...Array.from(new Set(rows.map(row => row.category))).map(value => ({ value, label: value }))];
  const statusOptions = [{ value: 'all', label: uiText("procurementDesign.all.statuses") }, ...STATUSES.map(value => ({ value, label: value }))];
  const visible = rows.filter(row => (house === 'all' || row.house === house)
    && (status === 'all' || row.status === status) && (category === 'all' || row.category === category)
    && `${row.title} ${houseName(row.house)} ${row.detail} ${row.owner}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = visible.find(row => row.id === selectedId) ?? null;
  const document = selected?.documents.find(item => item.id === documentId);
  useEffect(() => {
    setDocumentId(null);
    setSaved(false);
    setDraftStatus(selected?.status ?? '');
    setDraft(procurementDraft({ ...selected?.procurement, name: selected?.title ?? '', note: selected?.detail ?? '' }));
    setError('');
  }, [selected?.id]);
  const pick = (row: RecordItem) => { setSelectedId(row.id); setDocumentId(null); setSaved(false); };
  const clearFilters = () => { setQuery(''); setHouse('all'); setStatus('all'); setCategory('all'); };
  const statusBadge = (row: RecordItem) => <StatusIndicator type={statusKind(row.status)}>{systemText(row.status)}</StatusIndicator>;
  const empty = <div className="ui-rd-empty"><SpaceBetween size="m"><span>{uiText("procurementDesign.no.procurement.items.match.these.filters")}</span><Button onClick={clearFilters}>{uiText("directorDesign.clear.filters")}</Button></SpaceBetween></div>;

  const houseRegister = <SpaceBetween size="l">
    <Header variant="h2" description={uiText("procurementDesign.review.one.property.s.list.by.use.milestone.then")}>{uiText("procurementDesign.review.by.property")}</Header>
    {preview.houses.filter(item => visible.some(row => row.house === item.id)).map(item => <section key={item.id}>
      <Table<RecordItem> variant="embedded" items={visible.filter(row => row.house === item.id)} trackBy="id"
        header={<Header variant="h3" description={item.stage}>{item.name}</Header>}
        empty={empty}
        columnDefinitions={[
          { id: 'name', header: uiText("procurementDesign.material"), cell: row => <Button variant="inline-link" ariaLabel={uiText("sentences.view.for", { value1: (item.name), value2: (row.title) })} onClick={() => pick(row)}>{systemText(row.title)}</Button> },
          { id: 'wave', header: uiText("procurementDesign.procurement.milestone"), cell: row => row.category },
          { id: 'status', header: uiText("taskSummaryPanel.status"), cell: statusBadge },
          { id: 'dates', header: uiText("procurementDesign.order.estimated.arrival"), cell: row => <span>{row.procurement?.ordered_on ?? uiText("procurementDesign.not.ordered")} / {row.procurement?.expected_on ?? uiText("procurementItemRow.not.entered.2")}</span> },
          { id: 'delivery', header: uiText("procurementItemRow.receiving.location"), cell: row => deliveryLabel(row.procurement ?? {}) },
          { id: 'amount', header: uiText("procurementDesign.amount.usd"), cell: row => money(row.procurement?.amount, 2) },
        ]} />
    </section>)}
    {!visible.length && empty}
  </SpaceBetween>;

  const actionQueue = <SpaceBetween size="m">
    <Header variant="h2" description={uiText("procurementDesign.review.the.same.status.across.properties.retaining.each.item")}>{uiText("procurementDesign.work.by.status")}</Header>
    {['异常', '待选型', '待下单', '已下单', '已到货', '不适用'].map(group => {
      const items = visible.filter(row => row.status === group);
      return items.length ? <section className="ui-rd-task-group" key={group}>
        <h3>{systemText(group)}<small>{items.length} {uiText("projectPreplan.items")}</small></h3>
        {items.map(row => <button type="button" className="ui-rd-task" key={row.id} aria-pressed={selected?.id === row.id} onClick={() => pick(row)}>
          <span><strong>{systemText(row.title)}</strong><span>{houseName(row.house)} · {systemText(row.category)}</span><span>{systemText(row.detail)}</span><span>{uiText("procurementDesign.estimated")} {row.procurement?.expected_on ?? uiText("procurementItemRow.not.entered.2")} · {deliveryLabel(row.procurement ?? {})} · {money(row.procurement?.amount, 2)}</span></span>
          <span className="ui-rd-task-meta">{statusBadge(row)}</span>
        </button>)}
      </section> : null;
    })}
    {!visible.length && empty}
  </SpaceBetween>;

  const materialDesk = <SpaceBetween size="m">
    <Header variant="h2" description={uiText("procurementDesign.review.specifications.notes.and.full.images.by.material.filter")}>{uiText("procurementDesign.product.selection.desk")}</Header>
    <SpaceBetween direction="horizontal" size="s">
      <Button variant={status === '待选型' ? 'primary' : 'normal'} onClick={() => setStatus(status === '待选型' ? 'all' : '待选型')}>{status === '待选型' ? uiText("procurementDesign.show.all.statuses") : uiText("procurementDesign.selection.needed.only")}</Button>
      <Box color="text-body-secondary">{uiText("procurementDesign.design.recommendations.are.not.purchase.approvals")}</Box>
    </SpaceBetween>
    <div className="ui-sd-material-grid">{visible.map(row => <button type="button" key={row.id} className="ui-sd-material-card" aria-pressed={selected?.id === row.id} onClick={() => pick(row)}>
      <small>{houseName(row.house)} · {systemText(row.category)}</small>
      <strong>{systemText(row.title)}</strong>
      {statusBadge(row)}
      <span>{systemText(row.detail)}</span><span>{row.procurement?.specification} · {money(row.procurement?.amount, 2)}</span>
      <small>{row.documents.length} {uiText("procurementDesign.note.excerpts.view.material.details")}</small>
    </button>)}</div>
    {!visible.length && empty}
  </SpaceBetween>;

  const detail = selected ? <div className="ui-rd-detail"><SpaceBetween size="m">
    <small>{houseName(selected.house)} · {systemText(preview.houses.find(item => item.id === selected.house)?.stage)}</small>
    <Header variant="h2">{systemText(selected.title)}</Header>
    {statusBadge(selected)}
    <p>{systemText(selected.detail)}</p>
    <dl className="ui-rd-facts"><dt>{uiText("procurementDesign.procurement.milestone")}</dt><dd>{systemText(selected.category)}</dd>
      {selected.fields.map(field => <div className="ui-sd-fact-pair" key={field.label}><dt>{systemText(field.label)}</dt><dd>{systemText(field.value)}</dd></div>)}</dl>
    <Box color="text-body-secondary">{systemText(selected.source)}</Box>
    <section><Header variant="h3">{uiText("procurementDesign.material.record.excerpts")}</Header>
      {selected.documents.map(item => <button className="ui-rd-resource" type="button" key={item.id} aria-expanded={documentId === item.id} onClick={() => setDocumentId(documentId === item.id ? null : item.id)}>{item.name}<span>{uiText("procurementDesign.view.excerpts")}</span></button>)}
      {!selected.documents.length && <Box>{uiText("procurementDesign.no.record.excerpts")}</Box>}
      {document && <div className="ui-rd-file"><Header variant="h3">{document.name}</Header><p>{systemText(document.detail)}</p><Box color="text-body-secondary">{uiText("procurementDesign.synthetic.note.excerpts.not.uploaded.procurement.documents")}</Box></div>}
    </section>
    <section className="ui-rd-edit"><SpaceBetween size="m">
      <Header variant="h3" description={uiText("procurementDesign.changes.apply.only.to.this.design.preview.they.persist")}>{uiText("procurementDesign.try.editing.an.item")}</Header>
      <FormField label={uiText("procurementDesign.procurement.status")}><Select selectedOption={STATUSES.map(value => ({ value, label: value })).find(item => item.value === draftStatus) ?? null}
        options={STATUSES.map(value => ({ value, label: value }))} onChange={({ detail }) => { setDraftStatus(detail.selectedOption.value!); setSaved(false); }} /></FormField>
      <ProcurementFields draft={draft} onChange={value => { setDraft(value); setSaved(false); }} />
      {error && <Alert type="error">{systemText(error)}</Alert>}
      <Button variant="primary" onClick={() => {
        const invalid = procurementError(draft); if (invalid) { setError(invalid); return; }
        const clean = procurementChanges(draft, procurementDraft({ ...selected.procurement, name: selected.title, note: selected.detail }));
        setOverrides(previous => ({ ...previous, [selected.id]: { status: draftStatus, detail: draft.note,
          procurement: { ...selected.procurement!, ...clean } } })); setSaved(true); setError('');
      }}>{uiText("procurementDesign.apply.to.preview")}</Button>
      <section className="ui-proc-images"><Header variant="h3" description={uiText("procurementDesign.images.stay.in.this.preview.only.and.clear.when")}>{uiText("procurementDesign.material.images")}</Header>
        <div className="ui-proc-image-grid">{(images[selected.id] ?? []).map(img => <button className="ui-proc-image-button" key={img.url} onClick={() => setFullImage(img)} aria-label={uiText("sentences.view.full.image", { value1: (img.name) })}><img src={img.url} alt={img.name} /></button>)}</div>
        <label className="ui-proc-upload">{uiText("procurementDesign.try.a.material.image")}<input type="file" accept="image/jpeg,image/png,image/webp" aria-label={uiText("procurementDesign.preview.material.image")} onChange={e => {
          const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
          if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) { setError(uiText("procurementDesign.select.a.jpg.png.or.webp.image.up.to")); return; }
          const url = URL.createObjectURL(file); urls.current.push(url); setImages(old => ({ ...old, [selected.id]: [...(old[selected.id] ?? []), { url, name: file.name }] }));
        }} /></label>
      </section>
      {saved && <Alert type="success">{uiText("procurementDesign.preview.updated.actual.procurement.records.are.unchanged")}</Alert>}
    </SpaceBetween></section>
  </SpaceBetween></div> : <div className="ui-rd-empty">{selectedId ? uiText("procurementDesign.the.item.is.outside.the.current.filter.select.another") : uiText("procurementDesign.select.a.material.to.view.its.property.status.notes")}</div>;

  return <SpaceBetween size="m">
    <Modal visible={!!fullImage} size="max" header={fullImage?.name ?? uiText("procurementDesign.material.images")} onDismiss={() => setFullImage(null)}>{fullImage && <img className="ui-proc-full-image" src={fullImage.url} alt={fullImage.name} />}</Modal>
    <Box color="text-body-secondary">{uiText("procurementDesign.the.workspace.handles.daily.procurement.project.pages.show.the")}</Box>
    <div className="ui-rd-toolbar">
      <TextFilter filteringText={query} onChange={({ detail }) => setQuery(detail.filteringText)} filteringPlaceholder={uiText("procurementDesign.search.material.property.or.notes")} filteringAriaLabel={uiText("procurementDesign.search.procurement.preview")} />
      <Select ariaLabel={uiText("procurementDesign.procurement.property")} options={houseOptions} selectedOption={houseOptions.find(item => item.value === house)!} onChange={({ detail }) => setHouse(detail.selectedOption.value!)} />
      <Select ariaLabel={uiText("procurementDesign.procurement.status.filter")} options={statusOptions} selectedOption={statusOptions.find(item => item.value === status)!} onChange={({ detail }) => setStatus(detail.selectedOption.value!)} />
      <Select ariaLabel={uiText("procurementDesign.procurement.milestone")} options={categoryOptions} selectedOption={categoryOptions.find(item => item.value === category)!} onChange={({ detail }) => setCategory(detail.selectedOption.value!)} />
    </div>
    <Box color="text-body-secondary">{uiText("procurementDesign.showing")} {visible.length} / {rows.length} {uiText("procurementDesign.items.tristin.and.jeremy.use.the.same.workspace.and")}</Box>
    <CollaborationWorkspace main={<div className="ui-rd-main">{design.id === 'A' ? houseRegister : design.id === 'B' ? actionQueue : materialDesk}</div>}
      detail={detail} detailOpen={!!selected} onBack={() => setSelectedId(null)} />
  </SpaceBetween>;
}
