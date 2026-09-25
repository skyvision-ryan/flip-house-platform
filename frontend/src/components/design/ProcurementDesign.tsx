import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Textarea from '@cloudscape-design/components/textarea';
import TextFilter from '@cloudscape-design/components/text-filter';
import { useEffect, useMemo, useState } from 'react';
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
  const [owner, setOwner] = useState('all');
  const [status, setStatus] = useState('all');
  const [category, setCategory] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, { status: string; detail: string }>>({});
  const [draftStatus, setDraftStatus] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const [saved, setSaved] = useState(false);
  const rows = useMemo(() => preview.records.map(row => ({ ...row, ...overrides[row.id] })), [preview.records, overrides]);
  const houseName = (id: string) => preview.houses.find(item => item.id === id)?.name ?? id;
  const houseOptions = [{ value: 'all', label: '全部房屋' }, ...preview.houses.map(item => ({ value: item.id, label: item.name }))];
  const ownerOptions = [{ value: 'all', label: '全部示例分工' }, ...Array.from(new Set(rows.map(row => row.owner))).map(value => ({ value, label: `${value}（示例）` }))];
  const categoryOptions = [{ value: 'all', label: '全部采购节点' }, ...Array.from(new Set(rows.map(row => row.category))).map(value => ({ value, label: value }))];
  const statusOptions = [{ value: 'all', label: '全部状态' }, ...STATUSES.map(value => ({ value, label: value }))];
  const visible = rows.filter(row => (house === 'all' || row.house === house) && (owner === 'all' || row.owner === owner)
    && (status === 'all' || row.status === status) && (category === 'all' || row.category === category)
    && `${row.title} ${houseName(row.house)} ${row.detail} ${row.owner}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = visible.find(row => row.id === selectedId) ?? null;
  const document = selected?.documents.find(item => item.id === documentId);
  useEffect(() => {
    setDocumentId(null);
    setSaved(false);
    setDraftStatus(selected?.status ?? '');
    setDraftNote(selected?.detail ?? '');
  }, [selected?.id]);
  const pick = (row: RecordItem) => { setSelectedId(row.id); setDocumentId(null); setSaved(false); };
  const clearFilters = () => { setQuery(''); setHouse('all'); setOwner('all'); setStatus('all'); setCategory('all'); };
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
          { id: 'owner', header: '示例分工', cell: row => row.owner },
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
          <span><strong>{row.title}</strong><span>{houseName(row.house)} · {row.category}</span><span>{row.detail}</span></span>
          <span className="ui-rd-task-meta"><small>{row.owner} · 示例分工</small>{statusBadge(row)}</span>
        </button>)}
      </section> : null;
    })}
    {!visible.length && empty}
  </SpaceBetween>;

  const materialDesk = <SpaceBetween size="m">
    <Header variant="h2" description="围绕每件材料读选型备注和查看记录摘录；待选型可以直接筛出。">选型资料台</Header>
    <SpaceBetween direction="horizontal" size="s">
      <Button variant={status === '待选型' ? 'primary' : 'normal'} onClick={() => setStatus(status === '待选型' ? 'all' : '待选型')}>{status === '待选型' ? '显示全部状态' : '只看待选型'}</Button>
      <Box color="text-body-secondary">设计推荐不等于已批准采购。</Box>
    </SpaceBetween>
    <div className="ui-sd-material-grid">{visible.map(row => <button type="button" key={row.id} className="ui-sd-material-card" aria-pressed={selected?.id === row.id} onClick={() => pick(row)}>
      <small>{houseName(row.house)} · {row.category}</small>
      <strong>{row.title}</strong>
      {statusBadge(row)}
      <span>{row.detail}</span>
      <small>{row.documents.length} 份备注摘录 · 查看材料资料</small>
    </button>)}</div>
    {!visible.length && empty}
  </SpaceBetween>;

  const detail = selected ? <div className="ui-rd-detail"><SpaceBetween size="m">
    <small>{houseName(selected.house)} · {preview.houses.find(item => item.id === selected.house)?.stage}</small>
    <Header variant="h2">{selected.title}</Header>
    {statusBadge(selected)}
    <p>{selected.detail}</p>
    <dl className="ui-rd-facts"><dt>采购节点</dt><dd>{selected.category}</dd><dt>示例分工</dt><dd>{selected.owner}（非实际分派）</dd>
      {selected.fields.map(field => <div className="ui-sd-fact-pair" key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>
    <Box color="text-body-secondary">{selected.source}</Box>
    <section><Header variant="h3">材料记录摘录</Header>
      {selected.documents.map(item => <button className="ui-rd-resource" type="button" key={item.id} aria-expanded={documentId === item.id} onClick={() => setDocumentId(documentId === item.id ? null : item.id)}>{item.name}<span>查看摘录</span></button>)}
      {!selected.documents.length && <Box>没有记录摘录。</Box>}
      {document && <div className="ui-rd-file"><Header variant="h3">{document.name}</Header><p>{document.detail}</p><Box color="text-body-secondary">合成备注摘录，不是已上传的采购原件。</Box></div>}
    </section>
    <section className="ui-rd-edit"><SpaceBetween size="m">
      <Header variant="h3" description="仅修改当前设计预览，切换 A/B/C 时保留，离开页面后清除。">试用状态与备注编辑</Header>
      <FormField label="采购状态"><Select selectedOption={STATUSES.map(value => ({ value, label: value })).find(item => item.value === draftStatus) ?? null}
        options={STATUSES.map(value => ({ value, label: value }))} onChange={({ detail }) => { setDraftStatus(detail.selectedOption.value!); setSaved(false); }} /></FormField>
      <FormField label="采购备注"><Textarea value={draftNote} onChange={({ detail }) => { setDraftNote(detail.value); setSaved(false); }} /></FormField>
      <Button variant="primary" onClick={() => { setOverrides(previous => ({ ...previous, [selected.id]: { status: draftStatus, detail: draftNote } })); setSaved(true); }}>应用到预览</Button>
      {saved && <Alert type="success">预览已更新，实际采购记录没有修改。</Alert>}
    </SpaceBetween></section>
  </SpaceBetween></div> : <div className="ui-rd-empty">{selectedId ? '刚才的采购项不在当前筛选结果中。请选择一项材料。' : '选择一项材料，查看对应房屋、状态、备注与资料。'}</div>;

  return <SpaceBetween size="m">
    <div className="ui-rd-toolbar">
      <TextFilter filteringText={query} onChange={({ detail }) => setQuery(detail.filteringText)} filteringPlaceholder="搜索材料、房屋或备注" filteringAriaLabel="搜索采购预览" />
      <Select ariaLabel="采购房屋" options={houseOptions} selectedOption={houseOptions.find(item => item.value === house)!} onChange={({ detail }) => setHouse(detail.selectedOption.value!)} />
      <Select ariaLabel="采购示例分工" options={ownerOptions} selectedOption={ownerOptions.find(item => item.value === owner)!} onChange={({ detail }) => setOwner(detail.selectedOption.value!)} />
      <Select ariaLabel="采购状态筛选" options={statusOptions} selectedOption={statusOptions.find(item => item.value === status)!} onChange={({ detail }) => setStatus(detail.selectedOption.value!)} />
      <Select ariaLabel="采购节点" options={categoryOptions} selectedOption={categoryOptions.find(item => item.value === category)!} onChange={({ detail }) => setCategory(detail.selectedOption.value!)} />
    </div>
    <Box color="text-body-secondary">显示 {visible.length} / {rows.length} 项 · Tristin / Jeremy 使用同一工作区。示例分工用于体验筛选，不代表真实采购行已绑定负责人。</Box>
    <CollaborationWorkspace main={<div className="ui-rd-main">{design.id === 'A' ? houseRegister : design.id === 'B' ? actionQueue : materialDesk}</div>}
      detail={detail} detailOpen={!!selected} onBack={() => setSelectedId(null)} />
  </SpaceBetween>;
}
