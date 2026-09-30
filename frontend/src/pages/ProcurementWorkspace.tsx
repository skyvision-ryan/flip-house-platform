import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import TextFilter from '@cloudscape-design/components/text-filter';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import ProcurementItemRow from '../components/ProcurementItemRow';
import ProcurementRequirementForm from '../components/ProcurementRequirementForm';
import Modal from '@cloudscape-design/components/modal';
import ProcurementManagement from '../components/ProcurementManagement';
import {useActor} from '../lib/actor';
import {userCan} from '../lib/role';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Icon from '@cloudscape-design/components/icon';
import { houseOrderTotal } from '../lib/procurementSummary';
import { ProcurementItemEditor } from './ProcurementItemPage';
import { type PurchaseOrder, moneyValue, orderAttention, todayLA } from '../lib/purchaseOrders';
import { procurementNeedsAttention } from '../lib/procurement';
import { houseProcurement, pendingRequirements } from '../lib/procurementWorkspace';
import { api, type Project, type ProcurementWorkspaceData } from '../api/client';
import Header from '../components/ui/Header';
import { Table } from '../components/ui/Surface';
import { useMeta } from '../lib/meta';

export default function ProcurementWorkspace() {
  const [params, setParams] = useSearchParams(); const navigate = useNavigate(); const meta = useMeta(); const {me}=useActor(); const canWrite=userCan(meta,me,'procurement');
  const [projectInfo,setProjectInfo]=useState<Project[]>([]); const [switching,setSwitching]=useState(false); const [houseQuery,setHouseQuery]=useState(''); const [managing,setManaging]=useState(false);
  const [house, setHouse] = useState(params.get('project') ?? '');
  const [data, setData] = useState<ProcurementWorkspaceData | null>(null);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [attentionOnly, setAttentionOnly] = useState(params.get('attention') === '1');
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [view, setView] = useState(['orders', 'pending', 'excluded'].includes(params.get('view') || '') ? params.get('view')! : 'items');
  const [selectedId, setSelectedId] = useState<number | null>(Number(params.get('item')) || null);
  const [editing, setEditing] = useState<number | null>(params.get('edit') ? Number(params.get('item')) : null);
  const [dirty, setDirty] = useState(false);
  const [adding, setAdding] = useState<number | null>(params.get('new') ? Number(params.get('project')) : null);

  const request = useRef({body: '', key: ''}); const focused = useRef(false); const loadVersion = useRef(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({project: house, q: query, view, scope: 'working', attention: attentionOnly ? '1' : '', item: selectedId ? String(selectedId) : ''})) if (value) next.set(key, value);
    setParams(next, {replace: true});
  }, [house, query, view, attentionOnly, selectedId, setParams]);
  const orderHref = (path: string) => `${path}${path.includes('?') ? '&' : '?'}returnTo=${encodeURIComponent('/procurement?' + params.toString())}`;
  const waves = meta?.procurement_waves ?? []; const statuses = meta?.procurement_statuses ?? [];
  const load = useCallback(async () => {
    const version = ++loadVersion.current; setLoading(true);
    try {
      const [next, purchases, projects] = await Promise.all([api.procurementTracking(), api.purchaseOrders(), api.projects()]);
      if (version !== loadVersion.current) return;
      setData(next); setOrders(purchases); setProjectInfo(projects); setError('');
    } catch (e) { if (version === loadVersion.current) setError((e as Error).message); }
    finally { if (version === loadVersion.current) setLoading(false); }
  }, []);
  useEffect(() => { void load(); return () => { loadVersion.current++; }; }, [load]);
  useEffect(() => {
    if (!data || house) return;
    const linked = selectedId ? data.items.find(item => item.id === selectedId)?.project_id : null;
    const initial = linked ?? data.projects[0]?.id;
    if (initial) setHouse(String(initial));
  }, [data, house, selectedId]);
  useEffect(() => {
    if (!data || !waves.length || !selectedId || focused.current) return;
    const element = document.getElementById(`proc-item-${selectedId}`);
    if (element) { element.scrollIntoView({ block: 'center' }); focused.current = true; }
  }, [data, waves, selectedId, house]);
  const {items: houseItems, orders: houseOrders, task} = houseProcurement(data, orders, house);
  const pending = pendingRequirements(houseItems);
  const scopeItems = view === 'pending' ? pending : view === 'excluded' ? houseItems.filter(i => i.status === 'na') : houseItems;
  const visible = scopeItems.filter(row => (view === 'pending' || view === 'excluded' || (attentionOnly ? procurementNeedsAttention(row) : row.in_worklist || row.id === selectedId)) && `${row.name} ${row.note ?? ''} ${row.specification ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const changeView = (next: string) => { setView(next); setQuery(''); setAttentionOnly(false); setCollapsed([]); setSelectedId(null); setEditing(null); };
  const choose = (id: number) => { if (dirty) { setError('请先保存或放弃当前修改。'); return; } setEditing(null); setSelectedId(selectedId === id ? null : id); };
  if (!data) return error ? <Alert type="error" action={<Button onClick={load}>重试</Button>}>{error}</Alert> : <Spinner />;
  const houseLocked = dirty || busy || adding !== null || managing;
  const currentHouse = data.projects.find(p => String(p.id) === house);
  const houseInfo = currentHouse ? projectInfo.find(p => p.id === currentHouse.id) : undefined;
  const stageLabel = (info?: Project) => info?.group_position?.label || info?.current_stage?.label || '阶段待核对';
  const progress = task?.procurement_progress;
  const attentionCount = houseItems.filter(procurementNeedsAttention).length;
  const total = houseOrderTotal(houseOrders);
  const nextNeeded = houseItems.filter(i => i.in_worklist && i.needed_on && !['received', 'na'].includes(i.status)).sort((a, b) => a.needed_on!.localeCompare(b.needed_on!))[0];
  const visibleOrders = houseOrders.filter(o => `${o.document.vendor} ${o.document.order_number}`.toLowerCase().includes(query.toLowerCase()));
  const historyHref = currentHouse && task ? `/projects/${currentHouse.id}/tasks/${task.id}?returnTo=${encodeURIComponent('/procurement?' + params.toString())}` : '';
  return <div className="procurement-surface procurement-workspace"><SpaceBetween size="m">
    <Header variant="h1" actions={<Button loading={loading} disabled={houseLocked} onClick={load}>刷新</Button>}>采购工作台</Header>
    {error && <Alert type="error" dismissible onDismiss={() => setError('')}>{error}</Alert>}
    <div className="proc-house-panel">
    <section className="proc-house-context" aria-label="当前房屋">
      <div>
        <h2>{currentHouse ? <Link to={`/projects/${currentHouse.id}`} onClick={e=>{if(houseLocked){e.preventDefault();setError('请先保存或取消当前操作。');}}}>{currentHouse.name}</Link> : '选择采购房屋'}</h2>
        <p>{currentHouse?.address || '选择一套房屋，查看需求与订单'}</p>
        {currentHouse && <dl className="proc-house-facts">
          <div><dt>项目阶段</dt><dd>{stageLabel(houseInfo)}</dd></div>
          <div><dt>最早需要到场</dt><dd>{nextNeeded?.needed_on || '未填写'}</dd></div>
        </dl>}
      </div>
      <div className="proc-house-context-actions"><Button iconName="search" disabled={houseLocked || !data.projects.length} onClick={()=>{setHouseQuery('');setSwitching(true);}}>切换房屋</Button></div>
      {houseLocked && <small>请先保存或取消当前操作，再切换房屋。</small>}
    </section>
    {currentHouse && <section className="proc-house-status" aria-label="当前房屋采购状态">
      <dl className="proc-status-strip">
        <div className="proc-status-key"><dt>采购进度</dt><dd><StatusIndicator type={progress?.complete ? 'success' : task?.assignee ? 'in-progress' : 'pending'}>{progress?.complete ? '已备齐' : task?.assignee ? '采购中' : '待分派'}</StatusIndicator></dd></div>
        <div className="proc-status-key"><dt>已备齐</dt><dd>{progress ? <>{progress.ready} <small>/ {progress.total} 项</small></> : '待核对'}</dd></div>
        <div className="proc-status-key"><dt>需跟进</dt><dd>{attentionCount ? <button type="button" className="proc-attention-filter" disabled={houseLocked} aria-pressed={attentionOnly && view === 'items'} title={attentionOnly && view === 'items' ? '恢复采购清单' : '只看需跟进'} onClick={() => {setView('items'); setQuery(''); setAttentionOnly(!(attentionOnly && view === 'items')); setCollapsed([]); setSelectedId(null);}}>{attentionCount} <small>项{attentionOnly && view === 'items' ? ' · 筛选中' : ''}</small></button> : '无'}</dd></div>
        <div><dt>负责人</dt><dd>{task?.assignee?.display_name || '待分派'}</dd></div>
        <div><dt>采购截止</dt><dd>{task?.due_at || '未设置'}</dd></div>
        <div><dt>订单</dt><dd>{houseOrders.length ? `${houseOrders.length} 笔` : '暂无订单'}</dd></div>
        <div><dt>已登记订单净额</dt><dd>{total.label}{total.missing > 0 && <small className="proc-status-note">{total.missing} 笔实付未填</small>}</dd></div>
        {(canWrite || task) && <div className="proc-status-manage">{canWrite && <Button variant="inline-link" disabled={houseLocked} onClick={()=>setManaging(true)}>管理采购</Button>}{task && <Button variant="inline-link" disabled={houseLocked} onClick={()=>navigate(historyHref)}>项目采购记录</Button>}</div>}
      </dl>
    </section>}
    </div>
    <Modal visible={switching} header="切换采购房屋" onDismiss={()=>setSwitching(false)}>
      <SpaceBetween size="m"><TextFilter filteringText={houseQuery} filteringPlaceholder="搜索房屋名称或地址" filteringAriaLabel="搜索采购房屋" onChange={({detail})=>setHouseQuery(detail.filteringText)} />
        <div className="proc-house-options">{data.projects.filter(p=>`${p.name} ${p.address}`.toLowerCase().includes(houseQuery.toLowerCase())).map(p=>{
          const t=data.tasks.find(t=>t.project_id===p.id);const info=projectInfo.find(i=>i.id===p.id);
          return <button type="button" key={p.id} aria-pressed={String(p.id)===house} onClick={()=>{setHouse(String(p.id));setView('items');setSelectedId(null);setEditing(null);focused.current=false;setQuery('');setError('');setAttentionOnly(false);setCollapsed([]);setSwitching(false);}}>
            <strong>{p.name}</strong><span>{p.address}</span><small>{stageLabel(info)} · 负责人 {t?.assignee?.display_name || '待分派'} · {t?.procurement_progress ? `${t.procurement_progress.ready}/${t.procurement_progress.total} 已备齐` : '进度待核对'}{String(p.id)===house ? ' · 当前房屋' : ''}</small>
          </button>;
        })}</div>
        {!data.projects.some(p=>`${p.name} ${p.address}`.toLowerCase().includes(houseQuery.toLowerCase())) && <Box>没有匹配的房屋。</Box>}
      </SpaceBetween>
    </Modal>
    {!data.projects.length && <Box>暂无可查看的采购房屋。请由 Jessie 分派本房负责人或授权加入本房协作。</Box>}
    {house && !currentHouse && data.projects.length > 0 && <Alert type="warning">当前房屋不存在或你已无权查看，请选择其他房屋。</Alert>}
    {currentHouse && <>
    <div className="proc-scope-bar">
      <div className="proc-view-switch" role="group" aria-label="采购显示范围">
        <button type="button" disabled={houseLocked} aria-pressed={view === 'items'} onClick={() => changeView('items')}>采购清单</button>
        <button type="button" disabled={houseLocked} aria-pressed={view === 'pending'} onClick={() => changeView('pending')}>待处理需求（{pending.length}）</button>
        <button type="button" disabled={houseLocked} aria-pressed={view === 'orders'} onClick={() => changeView('orders')}>订单</button>
        <button type="button" disabled={houseLocked} aria-pressed={view === 'excluded'} onClick={() => changeView('excluded')}>本房不需要（{houseItems.filter(i => i.status === 'na').length}）</button>
      </div>
      <div className="proc-scope-search"><TextFilter disabled={houseLocked} filteringText={query} filteringPlaceholder={view === 'orders' ? '搜索商家或订单号' : '搜索材料、规格或备注'} filteringAriaLabel="搜索项目采购" onChange={({ detail }) => setQuery(detail.filteringText)} /></div>
    </div>
    {[currentHouse].map(p => <section className="proc-house" key={p.id}>
      <Header variant="h2" actions={canWrite ? <SpaceBetween direction="horizontal" size="s">
        <Button variant="primary" disabled={houseLocked || !task?.assignee} onClick={() => navigate(orderHref(`/projects/${p.id}/purchase-orders/new`))}>创建订单</Button>
        <Button disabled={houseLocked} onClick={() => setAdding(p.id)}>补充采购需求</Button>
      </SpaceBetween> : undefined}>{view==='orders' ? '本房订单' : view === 'pending' ? '待处理需求' : view === 'excluded' ? '本房不需要' : '本房采购需求'}</Header>
      {view === 'pending' && <Box color="text-body-secondary">待选型、待下单及需跟进的需求；各组按最近维护排序。点击“查看详情”定位处理。</Box>}
      {view === 'excluded' && <Box color="text-body-secondary">不计入采购进度。查看详情可核对原因，通过“恢复需求”重新纳入处理。</Box>}
      {canWrite && !task?.assignee && <Box color="text-body-secondary">请先由 Jessie 在管理采购中分派负责人，再创建订单。</Box>}
      {!canWrite && <Box>只读采购记录 · 金额为采购登记，未经财务核款。</Box>}
      {managing && canWrite && <ProcurementManagement projectId={p.id} items={houseItems} task={task} onClose={()=>setManaging(false)} onSaved={load} />}
      {adding === p.id && <ProcurementRequirementForm stages={waves} onCancel={() => setAdding(null)} onSave={async (name, wave) => {
        const body = JSON.stringify({project: p.id, name, wave}); if (body !== request.current.body) request.current = {body, key: crypto.randomUUID()};
        const result = await api.addProcurement(p.id, {name, wave, request_key: request.current.key}); await load(); setAdding(null); changeView('items'); focused.current=false; setSelectedId(result.created_item_id ?? null);
      }} />}
      {view === 'orders' ? <Table variant="embedded" header={query ? <Box>搜索结果 {visibleOrders.length} 笔 · 本房共 {houseOrders.length} 笔</Box> : undefined} items={visibleOrders} empty={<Box>{query ? '没有符合搜索的订单。' : '本房还没有登记订单。'}</Box>} columnDefinitions={[
        {id:'order',header:'商家订单',cell:o=><Button variant="inline-link" onClick={()=>navigate(orderHref(`/procurement/orders?project=${p.id}&order=${o.id}`))}>{o.document.vendor} · {o.document.order_number}</Button>},
        {id:'items',header:'采购项',cell:o=>o.document.lines.map(l=>l.name).join('、')}, {id:'total',header:'登记实付（USD）',cell:o=>moneyValue(o.document.total)},
        {id:'state',header:'待处理 / 收货',cell:o=>orderAttention(o,todayLA()).join('；') || (o.summary.complete?'已收齐':'待收齐')},
      ]} /> : <>
        {(attentionOnly || query) && <div className="ui-proc-list-caption"><span>{attentionOnly ? `只看需跟进 · ${attentionCount} 项` : `搜索结果 · ${visible.length} 项`}</span>{attentionOnly && <Button disabled={houseLocked} variant="inline-link" onClick={() => {setAttentionOnly(false); setQuery('');}}>恢复采购清单</Button>}</div>}
        {waves.filter(w => visible.some(r => r.project_id === p.id && r.wave === w.value)).map(group => {
          const rows = visible.filter(r => r.project_id === p.id && r.wave === group.value);
          const open = !collapsed.includes(group.value);
          return <section className="proc-material-group" key={group.value}>
            <h3><button type="button" disabled={dirty && rows.some(r => r.id === editing)} aria-expanded={open} aria-controls={`proc-group-${group.value}`} onClick={() => setCollapsed(open ? [...collapsed,group.value] : collapsed.filter(g => g !== group.value))}><Icon name={open ? 'angle-down' : 'angle-right'} /><span>{group.label}</span><small>{rows.length} 项</small></button></h3>
            {open && <div id={`proc-group-${group.value}`}>
            <div className="ui-proc-items">{rows.map(row => <ProcurementItemRow key={row.id} row={row} readOnly={!canWrite} orders={houseOrders} waves={waves} expanded={selectedId===row.id} statusLabel={statuses.find(s=>s.value===row.status)?.label||row.status} onToggle={()=>choose(row.id)} onEdit={()=>{if(dirty){setError('请先保存或放弃修改。');return;}setEditing(editing===row.id?null:row.id);}} onOrder={id=>{if(dirty){setError('请先保存或放弃修改。');return;}navigate(orderHref(`/procurement/orders?project=${p.id}&material=${row.id}&order=${id}`));}}>
              {editing===row.id && <ProcurementItemEditor key={row.id} materialId={row.id} houseId={p.id} onDirty={setDirty} onClose={()=>{setEditing(null);setDirty(false);}} onSaved={load} />}
            </ProcurementItemRow>)}</div>
            </div>}
          </section>;
        })}
        {!visible.some(r=>r.project_id===p.id) && <Box padding="m">{view === 'pending' && !query ? '暂无待处理需求。' : view === 'excluded' && !query ? '本房没有标记不需要的材料。' : !attentionOnly && !query && !houseItems.some(i => i.in_worklist) ? '本房清单暂无需求。已有房屋可在管理采购中恢复显示范围，或补充采购需求。' : '没有符合筛选的材料。'}</Box>}
      </>}
    </section>)}
    </>}
  </SpaceBetween></div>;
}
