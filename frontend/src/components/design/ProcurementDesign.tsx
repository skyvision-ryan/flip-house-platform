import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Modal from '@cloudscape-design/components/modal';
import ProcurementOrderFields from '../ProcurementOrderFields';
import ProcurementFields from '../ProcurementFields';
import { money } from '../../lib/format';
import { procurementWorkGroups, procurementWorkGroup, deliveryLabel, procurementDraft, procurementChanges, procurementError, type ProcurementDraft } from '../../lib/procurement';
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
  const [query, setQuery] = useState('');
  const [house, setHouse] = useState('all');
  const [workGroup, setWorkGroup] = useState('all');
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
  const houseOptions = [{ value: 'all', label: '全部房屋' }, ...preview.houses.map(item => ({ value: item.id, label: item.name }))];
  const categoryOptions = [{ value: 'all', label: '全部采购节点' }, ...Array.from(new Set(rows.map(row => row.category))).map(value => ({ value, label: value }))];
  const statusOptions = [{ value: 'all', label: '全部状态' }, ...STATUSES.map(value => ({ value, label: value }))];
  const groupOf = (row: RecordItem) => procurementWorkGroup({ ...row.procurement, status: ({ '待选型': 'pending_spec', '待下单': 'pending_order', '已下单': 'ordered', '已到货': 'received', '异常': 'exception', '不适用': 'na' } as Record<string, string>)[row.status] });
  const visible = rows.filter(row => (house === 'all' || row.house === house) && (workGroup === 'all' || groupOf(row) === workGroup)
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
  const clearFilters = () => { setQuery(''); setHouse('all'); setWorkGroup('all'); setStatus('all'); setCategory('all'); };
  const statusBadge = (row: RecordItem) => <StatusIndicator type={statusKind(row.status)}>{row.status}</StatusIndicator>;
  const empty = <div className="ui-rd-empty"><SpaceBetween size="m"><span>没有符合当前筛选的采购项。</span><Button onClick={clearFilters}>清除筛选</Button></SpaceBetween></div>;

  const houseRegister = <SpaceBetween size="l">
    <Header variant="h2" description="先核对一套房在各采购节点的清单，再打开具体材料。">按房屋核对</Header>
    {preview.houses.filter(item => visible.some(row => row.house === item.id)).map(item => <section key={item.id}>
      <Table<RecordItem> variant="embedded" items={visible.filter(row => row.house === item.id)} trackBy="id"
        header={<Header variant="h3" description={item.stage}>{item.name}</Header>}
        empty={empty}
        columnDefinitions={[
          { id: 'name', header: '材料', cell: row => <Button variant="inline-link" ariaLabel={`查看${item.name}的${row.title}`} onClick={() => pick(row)}>{row.title}</Button> },
          { id: 'wave', header: '采购节点', cell: row => row.category },
          { id: 'status', header: '状态', cell: statusBadge },
          { id: 'dates', header: '下单 / 预计到货', cell: row => <span>{row.procurement?.ordered_on ?? '未下单'} / {row.procurement?.expected_on ?? '未填'}</span> },
          { id: 'delivery', header: '收货地点', cell: row => deliveryLabel(row.procurement ?? {}) },
          { id: 'amount', header: '金额（USD）', cell: row => money(row.procurement?.amount, 2) },
        ]} />
    </section>)}
    {!visible.length && empty}
  </SpaceBetween>;

  const actionQueue = <SpaceBetween size="m">
    <Header variant="h2" description="同一状态下集中查看不同房屋，保留材料使用节点与备注。">按状态处理</Header>
    {['异常', '待选型', '待下单', '已下单', '已到货', '不适用'].map(group => {
      const items = visible.filter(row => row.status === group);
      return items.length ? <section className="ui-rd-task-group" key={group}>
        <h3>{group}<small>{items.length} 项</small></h3>
        {items.map(row => <button type="button" className="ui-rd-task" key={row.id} aria-pressed={selected?.id === row.id} onClick={() => pick(row)}>
          <span><strong>{row.title}</strong><span>{houseName(row.house)} · {row.category}</span><span>{row.detail}</span><span>预计 {row.procurement?.expected_on ?? '未填'} · {deliveryLabel(row.procurement ?? {})} · {money(row.procurement?.amount, 2)}</span></span>
          <span className="ui-rd-task-meta">{statusBadge(row)}</span>
        </button>)}
      </section> : null;
    })}
    {!visible.length && empty}
  </SpaceBetween>;

  const materialDesk = <SpaceBetween size="m">
    <Header variant="h2" description="围绕材料读规格、备注和完整图片；待选型可以直接筛出。">选型资料台</Header>
    <SpaceBetween direction="horizontal" size="s">
      <Button variant={status === '待选型' ? 'primary' : 'normal'} onClick={() => setStatus(status === '待选型' ? 'all' : '待选型')}>{status === '待选型' ? '显示全部状态' : '只看待选型'}</Button>
      <Box color="text-body-secondary">设计推荐不等于已批准采购。</Box>
    </SpaceBetween>
    <div className="ui-sd-material-grid">{visible.map(row => <button type="button" key={row.id} className="ui-sd-material-card" aria-pressed={selected?.id === row.id} onClick={() => pick(row)}>
      <small>{houseName(row.house)} · {row.category}</small>
      <strong>{row.title}</strong>
      {statusBadge(row)}
      <span>{row.detail}</span><span>{row.procurement?.specification} · {money(row.procurement?.amount, 2)}</span>
      <small>{row.documents.length} 份备注摘录 · 查看材料资料</small>
    </button>)}</div>
    {!visible.length && empty}
  </SpaceBetween>;

  const detail = selected ? <div className="ui-rd-detail"><SpaceBetween size="m">
    <small>{houseName(selected.house)} · {preview.houses.find(item => item.id === selected.house)?.stage}</small>
    <Header variant="h2">{selected.title}</Header>
    {statusBadge(selected)}
    <p>{selected.detail}</p>
    <dl className="ui-rd-facts"><dt>采购节点</dt><dd>{selected.category}</dd>
      {selected.fields.map(field => <div className="ui-sd-fact-pair" key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>
    <Box color="text-body-secondary">{selected.source}</Box>
    <section><Header variant="h3">材料记录摘录</Header>
      {selected.documents.map(item => <button className="ui-rd-resource" type="button" key={item.id} aria-expanded={documentId === item.id} onClick={() => setDocumentId(documentId === item.id ? null : item.id)}>{item.name}<span>查看摘录</span></button>)}
      {!selected.documents.length && <Box>没有记录摘录。</Box>}
      {document && <div className="ui-rd-file"><Header variant="h3">{document.name}</Header><p>{document.detail}</p><Box color="text-body-secondary">合成备注摘录，不是已上传的采购原件。</Box></div>}
    </section>
    <section className="ui-rd-edit"><SpaceBetween size="m">
      <Header variant="h3" description="仅修改当前设计预览，切换 A/B/C 时保留，离开页面后清除。">试用采购项编辑</Header>
      <FormField label="采购状态"><Select selectedOption={STATUSES.map(value => ({ value, label: value })).find(item => item.value === draftStatus) ?? null}
        options={STATUSES.map(value => ({ value, label: value }))} onChange={({ detail }) => { setDraftStatus(detail.selectedOption.value!); setSaved(false); }} /></FormField>
      <ProcurementFields draft={draft} onChange={value => { setDraft(value); setSaved(false); }} projectAddress={preview.houses.find(h => h.id === selected.house)?.address ?? ''} />
      <Header variant="h3" description="同一采购项的订单与物流，可在工作台集中跟进；预览不读取真实商家账户。">订单跟进</Header>
      <ProcurementOrderFields draft={draft} onChange={value => { setDraft(value); setSaved(false); }} />
      {error && <Alert type="error">{error}</Alert>}
      <Button variant="primary" onClick={() => {
        const invalid = procurementError(draft); if (invalid) { setError(invalid); return; }
        const clean = procurementChanges(draft, procurementDraft({ ...selected.procurement, name: selected.title, note: selected.detail }));
        setOverrides(previous => ({ ...previous, [selected.id]: { status: draftStatus, detail: draft.note,
          procurement: { ...selected.procurement!, ...clean } } })); setSaved(true); setError('');
      }}>应用到预览</Button>
      <section className="ui-proc-images"><Header variant="h3" description="图片只留在本次预览中，离开后清除，不上传到实际项目。">材料图片</Header>
        <div className="ui-proc-image-grid">{(images[selected.id] ?? []).map(img => <button className="ui-proc-image-button" key={img.url} onClick={() => setFullImage(img)} aria-label={`查看完整图片：${img.name}`}><img src={img.url} alt={img.name} /></button>)}</div>
        <label className="ui-proc-upload">试放一张材料图片<input type="file" accept="image/jpeg,image/png,image/webp" aria-label="预览材料图片" onChange={e => {
          const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
          if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) { setError('请选择不超过 8 MB 的 JPG、PNG 或 WebP 图片'); return; }
          const url = URL.createObjectURL(file); urls.current.push(url); setImages(old => ({ ...old, [selected.id]: [...(old[selected.id] ?? []), { url, name: file.name }] }));
        }} /></label>
      </section>
      {saved && <Alert type="success">预览已更新，实际采购记录没有修改。</Alert>}
    </SpaceBetween></section>
  </SpaceBetween></div> : <div className="ui-rd-empty">{selectedId ? '刚才的采购项不在当前筛选结果中。请选择一项材料。' : '选择一项材料，查看对应房屋、状态、备注与资料。'}</div>;

  return <SpaceBetween size="m">
    <Modal visible={!!fullImage} size="max" header={fullImage?.name ?? '材料图片'} onDismiss={() => setFullImage(null)}>{fullImage && <img className="ui-proc-full-image" src={fullImage.url} alt={fullImage.name} />}</Modal>
    <Box color="text-body-secondary">工作台负责日常采购执行，项目页只看概况。大类包含材料记录，Jeremy / Tristin 共用，不按单件材料分派任务。</Box>
    <div className="ui-proc-work-groups">{procurementWorkGroups.map(group => <Button key={group.value} onClick={() => setWorkGroup(group.value)}><span className={workGroup === group.value ? 'ui-proc-active-group' : ''}>{group.label} · {rows.filter(row => group.value === 'all' || groupOf(row) === group.value).length}</span></Button>)}</div>
    <div className="ui-rd-toolbar">
      <TextFilter filteringText={query} onChange={({ detail }) => setQuery(detail.filteringText)} filteringPlaceholder="搜索材料、房屋或备注" filteringAriaLabel="搜索采购预览" />
      <Select ariaLabel="采购房屋" options={houseOptions} selectedOption={houseOptions.find(item => item.value === house)!} onChange={({ detail }) => setHouse(detail.selectedOption.value!)} />
      <Select ariaLabel="采购状态筛选" options={statusOptions} selectedOption={statusOptions.find(item => item.value === status)!} onChange={({ detail }) => setStatus(detail.selectedOption.value!)} />
      <Select ariaLabel="采购节点" options={categoryOptions} selectedOption={categoryOptions.find(item => item.value === category)!} onChange={({ detail }) => setCategory(detail.selectedOption.value!)} />
    </div>
    <Box color="text-body-secondary">显示 {visible.length} / {rows.length} 项 · Tristin / Jeremy 使用同一工作区。同一岗位、同一流程。可直接编辑下方材料，项目页同步高层状态。</Box>
    <CollaborationWorkspace main={<div className="ui-rd-main">{design.id === 'A' ? houseRegister : design.id === 'B' ? actionQueue : materialDesk}</div>}
      detail={detail} detailOpen={!!selected} onBack={() => setSelectedId(null)} />
  </SpaceBetween>;
}
