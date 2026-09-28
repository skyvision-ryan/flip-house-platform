import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import TextFilter from '@cloudscape-design/components/text-filter';
import Textarea from '@cloudscape-design/components/textarea';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import ProcurementTask from '../components/ProcurementTask';
import ProcurementWorklistPicker from '../components/ProcurementWorklistPicker';
import ProcurementItemRow from '../components/ProcurementItemRow';
import ProcurementRequirementForm from '../components/ProcurementRequirementForm';
import PurchaseOrderCoverage from '../components/PurchaseOrderCoverage';
import { ProcurementItemEditor } from './ProcurementItemPage';
import { type PurchaseOrder, moneyValue, orderAttention, todayLA } from '../lib/purchaseOrders';
import { procurementNeedsAttention } from '../lib/procurement';
import { api, type ProcurementItem, type ProcurementWorkspaceData } from '../api/client';
import Header from '../components/ui/Header';
import FormField from '../components/ui/FormField';
import { ExpandableSection, Table } from '../components/ui/Surface';
import { useMeta } from '../lib/meta';

export default function ProcurementWorkspace() {
  const [params, setParams] = useSearchParams(); const navigate = useNavigate(); const meta = useMeta();
  const [house, setHouse] = useState(params.get('project') ?? '');
  const [data, setData] = useState<ProcurementWorkspaceData | null>(null);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [wave, setWave] = useState(params.get('node') ?? ''); const [status, setStatus] = useState(params.get('status') ?? '');
  const [allMaterials, setAllMaterials] = useState(params.get('scope') === 'all' || (!params.has('scope') && !!params.get('item')) || params.get('status') === 'na');
  const [selecting, setSelecting] = useState<number | null>(null);
  const [attention, setAttention] = useState(params.get('attention') === '1'); const [view, setView] = useState(params.get('view') ?? 'items');
  const [selectedId, setSelectedId] = useState<number | null>(Number(params.get('item')) || null);
  const [editing, setEditing] = useState<number | null>(params.get('edit') ? Number(params.get('item')) : null);
  const [dirty, setDirty] = useState(false);
  const [adding, setAdding] = useState<number | null>(params.get('new') ? Number(params.get('project')) : null);
  const [bulkHouse, setBulkHouse] = useState<number | null>(null); const [bulkIds, setBulkIds] = useState<number[]>([]); const [reason, setReason] = useState('');
  const request = useRef({body: '', key: ''}); const focused = useRef(false);
  useEffect(() => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({project: house, q: query, node: wave, status, view, scope: allMaterials ? 'all' : 'working', attention: attention ? '1' : '', item: selectedId ? String(selectedId) : ''})) if (value) next.set(key, value);
    setParams(next, {replace: true});
  }, [house, query, wave, status, view, allMaterials, attention, selectedId, setParams]);
  const orderHref = (path: string) => `${path}${path.includes('?') ? '&' : '?'}returnTo=${encodeURIComponent('/procurement?' + params.toString())}`;
  const waves = meta?.procurement_waves ?? []; const statuses = meta?.procurement_statuses ?? [];
  const load = useCallback(async () => {
    try { const [next, purchases] = await Promise.all([api.procurementTracking(), api.purchaseOrders()]); setData(next); setOrders(purchases); setError(''); }
    catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!data || !waves.length || !selectedId || focused.current) return;
    const element = document.getElementById(`proc-item-${selectedId}`);
    if (element) { element.scrollIntoView({ block: 'center' }); focused.current = true; }
  }, [data, waves, selectedId]);
  const visible = (data?.items ?? []).filter(row => (allMaterials || row.in_worklist) && (!house || String(row.project_id) === house) && (!wave || row.wave === wave) && (!status || row.status === status) && (!attention || procurementNeedsAttention(row)) && `${row.name} ${row.note ?? ''} ${row.specification ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const choose = (id: number) => { if (dirty) { setError('请先保存或放弃当前修改。'); return; } setEditing(null); setSelectedId(selectedId === id ? null : id); };
  if (!data) return error ? <Alert type="error" action={<Button onClick={load}>重试</Button>}>{error}</Alert> : <Spinner />;
  return <div className="procurement-surface procurement-workspace"><SpaceBetween size="m">
    <Header variant="h1" actions={<Button disabled={dirty || busy || selecting !== null} onClick={load}>刷新</Button>}>采购工作台</Header>
    {error && <Alert type="error" dismissible onDismiss={() => setError('')}>{error}</Alert>}
    <div className="proc-view-switch" role="group" aria-label="采购显示范围">
      <button type="button" disabled={dirty || selecting !== null} aria-pressed={view === 'items' && !allMaterials} onClick={() => {setView('items'); setAllMaterials(false);}}>本次采购</button>
      <button type="button" disabled={dirty || selecting !== null} aria-pressed={view === 'items' && allMaterials} onClick={() => {setView('items'); setAllMaterials(true);}}>全部材料</button>
      <button type="button" disabled={dirty || selecting !== null} aria-pressed={view === 'orders'} onClick={() => setView('orders')}>订单</button>
    </div>
    <div className="ui-proc-toolbar ui-proc-workspace-toolbar">
      <Select disabled={dirty || selecting !== null} ariaLabel="工作台房屋筛选" options={[{ value: '', label: '全部房屋' }, ...data.projects.map(p => ({ value: String(p.id), label: p.name }))]} selectedOption={{ value: house, label: data.projects.find(p => String(p.id) === house)?.name ?? '全部房屋' }} onChange={({ detail }) => setHouse(detail.selectedOption.value!)} />
      <TextFilter disabled={dirty || selecting !== null} filteringText={query} filteringPlaceholder={view === 'items' ? '搜索材料、规格或备注' : '搜索商家或订单号'} filteringAriaLabel="搜索项目采购" onChange={({ detail }) => setQuery(detail.filteringText)} />
    </div>
    {view === 'items' && <ExpandableSection headerText="筛选节点与状态" defaultExpanded={!!(wave || status)}><div className="ui-proc-toolbar">
      <Select disabled={dirty || selecting !== null} ariaLabel="采购分组筛选" options={[{ value: '', label: '全部采购分组' }, ...waves]} selectedOption={waves.find(w => w.value === wave) ?? { value: '', label: '全部采购分组' }} onChange={({ detail }) => setWave(detail.selectedOption.value!)} />
      <Select disabled={dirty || selecting !== null} ariaLabel="采购状态筛选" options={[{ value: '', label: '全部状态' }, ...statuses]} selectedOption={statuses.find(s => s.value === status) ?? { value: '', label: '全部状态' }} onChange={({ detail }) => setStatus(detail.selectedOption.value!)} />
    </div></ExpandableSection>}
    <Checkbox disabled={dirty || selecting !== null} checked={attention} onChange={({ detail }) => setAttention(detail.checked)}>只看需处理</Checkbox>
    {data.projects.filter(p => !house || String(p.id) === house).map(p => <section className="proc-house" key={p.id}>
      <Header variant="h2" actions={<SpaceBetween direction="horizontal" size="s"><Button disabled={dirty || selecting !== null || !data.tasks.some(t => t.project_id === p.id && t.assignee)} onClick={() => setSelecting(p.id)}>选择采购项</Button><Button variant="primary" disabled={dirty || selecting !== null || !data.tasks.some(t => t.project_id === p.id && t.assignee)} onClick={() => navigate(orderHref(`/projects/${p.id}/purchase-orders/new`))}>创建订单</Button><Button disabled={dirty || selecting !== null} onClick={() => setAdding(adding === p.id ? null : p.id)}>新增需求</Button></SpaceBetween>}>{p.name}</Header>
      <div className="proc-house-summary"><ProcurementTask task={data.tasks.find(t => t.project_id === p.id)} onChanged={load} /><PurchaseOrderCoverage orders={orders} projectId={p.id} compact /></div>
      {selecting === p.id && <ProcurementWorklistPicker projectId={p.id} items={data.items.filter(i => i.project_id === p.id)} waves={waves} onSaved={load} onClose={() => setSelecting(null)} />}
      {adding === p.id && <ProcurementRequirementForm stages={waves} onCancel={() => setAdding(null)} onSave={async (name, wave) => {
        const body = JSON.stringify({project: p.id, name, wave}); if (body !== request.current.body) request.current = {body, key: crypto.randomUUID()};
        await api.addProcurement(p.id, {name, wave, request_key: request.current.key}); await load(); setAdding(null);
      }} />}
      <Box>需处理 {data.items.filter(i => i.project_id === p.id && procurementNeedsAttention(i)).length} 项</Box>
      {view === 'orders' ? <Table variant="embedded" items={orders.filter(o => o.project_id === p.id && (!attention || orderAttention(o, todayLA()).length) && `${o.document.vendor} ${o.document.order_number}`.toLowerCase().includes(query.toLowerCase()))} empty={<Box>暂无符合条件的订单。</Box>} columnDefinitions={[
        {id:'order',header:'商家订单',cell:o=><Button variant="inline-link" onClick={()=>navigate(orderHref(`/procurement/orders?project=${p.id}&order=${o.id}`))}>{o.document.vendor} · {o.document.order_number}</Button>},
        {id:'items',header:'采购项',cell:o=>o.document.lines.map(l=>l.name).join('、')}, {id:'total',header:'实付',cell:o=>moneyValue(o.document.total)},
        {id:'state',header:'待处理 / 收货',cell:o=>orderAttention(o,todayLA()).join('；') || (o.summary.complete?'已收齐':'待收齐')},
      ]} /> : <>
        <div className="ui-proc-list-caption"><strong>{allMaterials ? '全部材料与历史' : '本次采购清单'} · {data.items.filter(i => i.project_id === p.id && (allMaterials || i.in_worklist)).length} 项</strong><span>{data.items.filter(i => i.project_id === p.id && !i.in_worklist && i.status !== 'na').length > 0 ? `${data.items.filter(i => i.project_id === p.id && !i.in_worklist && i.status !== 'na').length} 项尚未纳入` : ''}</span></div>
        {allMaterials && <Button disabled={dirty || selecting !== null} variant="inline-link" onClick={() => { setBulkHouse(bulkHouse === p.id ? null : p.id); setBulkIds([]); setReason(''); }}>批量标为本房不需要</Button>}
        {bulkHouse === p.id && <div className="ui-proc-requirement"><SpaceBetween size="s"><Box>选择尚未关联订单的材料</Box>
          {data.items.filter(i => i.project_id === p.id && !i.order_managed && i.status !== 'na').map(i => <Checkbox key={i.id} disabled={busy} checked={bulkIds.includes(i.id)} onChange={({detail}) => setBulkIds(detail.checked ? [...bulkIds, i.id] : bulkIds.filter(id=>id!==i.id))}>{i.name}</Checkbox>)}
          <FormField label="本房不需要的原因"><Textarea value={reason} onChange={({detail})=>setReason(detail.value)} /></FormField>
          <SpaceBetween direction="horizontal" size="s"><Button loading={busy} disabled={!bulkIds.length || !reason.trim()} onClick={async()=>{setBusy(true);try {await api.procurementNotNeeded(p.id, {reason,items:bulkIds.map(id=>({id,updated_at:data.items.find(i=>i.id===id)!.updated_at}))});await load();setBulkHouse(null);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>保存 {bulkIds.length} 项</Button><Button onClick={()=>setBulkHouse(null)}>取消</Button></SpaceBetween>
        </SpaceBetween></div>}
        {waves.filter(w => visible.some(r => r.project_id === p.id && r.wave === w.value)).map(group => {
          const rows = visible.filter(r => r.project_id === p.id && r.wave === group.value);
          return <ExpandableSection key={group.value} defaultExpanded headerText={`${group.label} · ${rows.length} 项`}>
            <div className="ui-proc-items">{rows.map(row => <ProcurementItemRow key={row.id} row={row} orders={orders} waves={waves} expanded={selectedId===row.id} statusLabel={statuses.find(s=>s.value===row.status)?.label||row.status} onToggle={()=>choose(row.id)} onEdit={()=>{if(dirty){setError('请先保存或放弃修改。');return;}setEditing(editing===row.id?null:row.id);}} onOrder={id=>{if(dirty){setError('请先保存或放弃修改。');return;}navigate(orderHref(`/procurement/orders?project=${p.id}&material=${row.id}&order=${id}`));}}>
              {editing===row.id && <ProcurementItemEditor key={row.id} materialId={row.id} houseId={p.id} onDirty={setDirty} onClose={()=>{setEditing(null);setDirty(false);}} onSaved={load} />}
            </ProcurementItemRow>)}</div>
          </ExpandableSection>;
        })}
        {!visible.some(r=>r.project_id===p.id) && <Box padding="m">{!allMaterials && !data.items.some(i => i.project_id === p.id && i.in_worklist) ? '先选择本次要买的材料，或新增临时需求。' : '没有符合筛选的材料。'}</Box>}
      </>}
    </section>)}
  </SpaceBetween></div>;
}
