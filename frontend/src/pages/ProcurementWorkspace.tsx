import { materialSearchText, orderLineName } from '../i18n/templateNames.ts';
import { stageText } from '../lib/stepDisplay';
import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
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
import ExternalLink from '@cloudscape-design/components/link';
import { type PurchaseOrder, moneyValue, orderAttention, todayLA, orderTitle, nextExpected, arrivalChip, sortOrdersForList } from '../lib/purchaseOrders';
import { procurementNeedsAttention } from '../lib/procurement';
import { houseProcurement, pendingRequirements } from '../lib/procurementWorkspace';
import { api, type Project, type ProcurementWorkspaceData } from '../api/client';
import Header from '../components/ui/Header';
import { Table } from '../components/ui/Surface';
import { useMeta } from '../lib/meta';

export default function ProcurementWorkspace() {
  useLanguage();
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
  const [arrivalsOpen, setArrivalsOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [adding, setAdding] = useState<number | null>(params.get('new') ? Number(params.get('project')) : null);

  const request = useRef({body: '', key: ''}); const focused = useRef(false); const loadVersion = useRef(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({project: house, q: query, view, scope: 'working', attention: attentionOnly ? '1' : '', item: selectedId ? String(selectedId) : '', edit: editing && editing === selectedId ? '1' : ''})) if (value) next.set(key, value);
    setParams(next, {replace: true});
  }, [house, query, view, attentionOnly, selectedId, editing, setParams]);
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
  const newById = new Map((data?.new_requirements ?? []).filter(n => String(n.project_id) === house).map(n => [n.item_id, n]));
  const houseArrivals = (data?.arrivals ?? []).filter(a => String(a.project_id) === house);
  // Colleagues' untouched additions float to the top of the pending queue; the queue order is otherwise by maintenance time.
  const pending = [...pendingRequirements(houseItems)].sort((a, b) => Number(newById.has(b.id)) - Number(newById.has(a.id)));
  const scopeItems = view === 'pending' ? pending : view === 'excluded' ? houseItems.filter(i => i.status === 'na') : houseItems;
  const visible = scopeItems.filter(row => (view === 'pending' || view === 'excluded' || (attentionOnly ? procurementNeedsAttention(row) : row.in_worklist || row.id === selectedId)) && `${materialSearchText(row)} ${row.note ?? ''} ${row.specification ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const changeView = (next: string) => { setView(next); setQuery(''); setAttentionOnly(false); setCollapsed([]); setSelectedId(null); setEditing(null); };
  const choose = (id: number) => { if (dirty) { setError(uiText("procurementItemPage.save.or.discard.your.current.changes.first")); return; } setEditing(null); setSelectedId(selectedId === id ? null : id); };
  if (!data) return error ? <Alert type="error" action={<Button onClick={load}>{uiText("addProject.retry")}</Button>}>{systemText(error)}</Alert> : <Spinner />;
  const houseLocked = dirty || busy || adding !== null || managing;
  const currentHouse = data.projects.find(p => String(p.id) === house);
  const houseInfo = currentHouse ? projectInfo.find(p => p.id === currentHouse.id) : undefined;
  const stageLabel = (info?: Project) => info ? stageText(info, meta) : uiText("procurementWorkspace.stage.needs.verification");
  const progress = task?.procurement_progress;
  const attentionCount = houseItems.filter(procurementNeedsAttention).length;
  const total = houseOrderTotal(houseOrders);
  const nextNeeded = houseItems.filter(i => i.in_worklist && i.needed_on && !['received', 'na'].includes(i.status)).sort((a, b) => a.needed_on!.localeCompare(b.needed_on!))[0];
  const today = todayLA();
  const visibleOrders = sortOrdersForList(houseOrders.filter(o => `${o.document.title ?? ''} ${o.document.vendor} ${o.document.order_number} ${o.document.lines.map(l => `${l.name} ${orderLineName(l, houseItems)}`).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase())));
  const afterDelete = async () => { setEditing(null); setDirty(false); setSelectedId(null); await load(); };
  const historyHref = currentHouse && task ? `/projects/${currentHouse.id}/tasks/${task.id}?returnTo=${encodeURIComponent('/procurement?' + params.toString())}` : '';
  return <div className="procurement-surface procurement-workspace"><SpaceBetween size="m">
    <Header variant="h1" actions={<Button loading={loading} disabled={houseLocked} onClick={load}>{uiText("procurementWorkspace.refresh")}</Button>}>{uiText("app.procurement.workspace")}</Header>
    {error && <Alert type="error" dismissible onDismiss={() => setError('')}>{systemText(error)}</Alert>}
    <div className="proc-house-panel">
    <section className="proc-house-context" aria-label={uiText("procurementWorkspace.current.property")}>
      <div>
        <h2>{currentHouse ? <Link to={`/projects/${currentHouse.id}`} onClick={e=>{if(houseLocked){e.preventDefault();setError(uiText("procurementWorkspace.save.or.cancel.the.current.action.first"));}}}>{currentHouse.name}</Link> : uiText("procurementWorkspace.select.procurement.property")}</h2>
        <p>{currentHouse?.address || uiText("procurementWorkspace.select.a.property.to.view.requirements.and.orders")}</p>
        {currentHouse && <dl className="proc-house-facts">
          <div><dt>{uiText("procurementWorkspace.project.stage")}</dt><dd>{stageLabel(houseInfo)}</dd></div>
          <div><dt>{uiText("procurementWorkspace.earliest.required.on.site.date")}</dt><dd>{nextNeeded?.needed_on || uiText("procurementItemRow.not.entered")}</dd></div>
        </dl>}
      </div>
      <div className="proc-house-context-actions"><Button iconName="search" disabled={houseLocked || !data.projects.length} onClick={()=>{setHouseQuery('');setSwitching(true);}}>{uiText("procurementWorkspace.switch.property")}</Button></div>
      {houseLocked && <small>{uiText("procurementWorkspace.save.or.cancel.the.current.action.before.switching.properties")}</small>}
    </section>
    {currentHouse && <section className="proc-house-status" aria-label={uiText("procurementWorkspace.current.property.procurement.status")}>
      <dl className="proc-status-strip">
        <div className="proc-status-key"><dt>{uiText("procurementWorkspace.procurement.progress")}</dt><dd><StatusIndicator type={progress?.complete ? 'success' : task?.assignee ? 'in-progress' : 'pending'}>{progress?.complete ? uiText("procurementTask.all.required.items.ready") : task?.assignee ? uiText("procurementTask.procurement.in.progress") : uiText("personAvatar.unassigned")}</StatusIndicator></dd></div>
        <div className="proc-status-key"><dt>{uiText("procurementTask.all.required.items.ready")}</dt><dd>{progress ? <>{progress.ready} <small>/ {progress.total} {uiText("projectPreplan.items")}</small></> : uiText("procurementItemRow.needs.verification")}</dd></div>
        <div className="proc-status-key"><dt>{uiText("procurementSummary.follow.up.needed")}</dt><dd>{attentionCount ? <button type="button" className="proc-attention-filter" disabled={houseLocked} aria-pressed={attentionOnly && view === 'items'} title={attentionOnly && view === 'items' ? uiText("procurementWorkspace.restore.procurement.list") : uiText("procurementWorkspace.follow.up.needed.only")} onClick={() => {setView('items'); setQuery(''); setAttentionOnly(!(attentionOnly && view === 'items')); setCollapsed([]); setSelectedId(null);}}>{attentionCount} <small>{uiText("projectPreplan.items")}{attentionOnly && view === 'items' ? uiText("procurementWorkspace.filter.active") : ''}</small></button> : uiText("procurementWorkspace.none")}</dd></div>
        <div className="proc-status-key"><dt>{uiText("procurementWorkspace.new.requirements.to.handle")}</dt><dd>{newById.size ? <button type="button" className="proc-attention-filter" disabled={houseLocked} aria-pressed={view === 'pending'} onClick={() => changeView('pending')}>{newById.size} <small>{uiText("projectPreplan.items")}</small></button> : uiText("procurementWorkspace.none")}</dd></div>
        <div className="proc-status-key"><dt>{uiText("procurementWorkspace.arrival.reminders")}</dt><dd>{houseArrivals.length ? <button type="button" className="proc-attention-filter" disabled={houseLocked} aria-pressed={arrivalsOpen} aria-controls="proc-arrivals" onClick={() => setArrivalsOpen(!arrivalsOpen)}>{houseArrivals.length} <small>{uiText("projectPreplan.items")}</small></button> : uiText("procurementWorkspace.none")}</dd></div>
        <div><dt>{uiText('task.assignee')}</dt><dd>{task?.assignee?.display_name || uiText("personAvatar.unassigned")}</dd></div>
        <div><dt>{uiText("procurementWorkspace.procurement.due.date")}</dt><dd>{task?.due_at || uiText("leadershipProjectDetail.not.set")}</dd></div>
        <div><dt>{uiText("procurementWorkspace.orders")}</dt><dd>{houseOrders.length ? uiText("counts.orders", { count: (houseOrders.length) }) : uiText("purchaseOrderCoverage.no.orders")}</dd></div>
        <div><dt>{uiText("purchaseOrderCoverage.recorded.net.order.amount")}</dt><dd>{systemText(total.label)}{total.missing > 0 && <small className="proc-status-note">{total.missing} {uiText("procurementWorkspace.orders.without.payment.amounts")}</small>}</dd></div>
        {(canWrite || task) && <div className="proc-status-manage">{canWrite && <Button variant="inline-link" disabled={houseLocked} onClick={()=>setManaging(true)}>{uiText("procurementWorkspace.manage.procurement")}</Button>}{task && <Button variant="inline-link" disabled={houseLocked} onClick={()=>navigate(historyHref)}>{uiText("procurementWorkspace.project.procurement.history")}</Button>}</div>}
      </dl>
    </section>}
    {currentHouse && arrivalsOpen && houseArrivals.length > 0 && <section id="proc-arrivals" className="proc-arrivals" aria-label={uiText("procurementWorkspace.arrival.reminders")}>
      <div className="proc-arrivals-head"><strong>{uiText("procurementWorkspace.arrival.reminders")}</strong><span>{uiText("procurementWorkspace.arrival.hint")}</span><Button variant="inline-link" onClick={() => setArrivalsOpen(false)}>{uiText("procurementItemRow.collapse")}</Button></div>
      <ul>{houseArrivals.map(a => <li key={`${a.order_id}-${a.kind}-${a.line_id ?? a.name}`}>
        <span className="proc-arrival-name">{a.kind === 'line' ? orderLineName({ name: a.name, material_id: a.material_id }, houseItems) : a.name}</span>
        <span className="proc-arrival-meta">{a.order_title} · {uiText("sentences.estimated.2", { value1: a.expected_on })}{a.remaining ? ` · ${uiText("purchaseOrderCoverage.still.needed")} ${a.remaining} ${systemText(a.unit)}` : ''} <StatusIndicator type={a.days_overdue ? 'error' : 'warning'}>{a.days_overdue ? uiText("counts.overdue.days", { count: a.days_overdue }) : uiText("procurementWorkspace.chip.due.today")}</StatusIndicator></span>
        <span className="proc-arrival-actions"><Button variant="inline-link" disabled={houseLocked} onClick={() => navigate(orderHref(`/procurement/orders?project=${a.project_id}&order=${a.order_id}`))}>{uiText("procurementWorkspace.open.order")}</Button>{a.tracking_url && <ExternalLink external href={a.tracking_url}>{uiText("procurementItemRow.tracking")}</ExternalLink>}{canWrite && a.line_id && <Button variant="inline-link" disabled={houseLocked} onClick={() => navigate(orderHref(`/procurement/orders?project=${a.project_id}&order=${a.order_id}&receive=${a.line_id}`))}>{uiText("purchaseOrders.record.receipt.for.this.item")}</Button>}</span>
      </li>)}</ul>
    </section>}
    </div>
    <Modal visible={switching} header={uiText("procurementWorkspace.switch.procurement.property")} onDismiss={()=>setSwitching(false)}>
      <SpaceBetween size="m"><TextFilter filteringText={houseQuery} filteringPlaceholder={uiText("procurementWorkspace.search.property.name.or.address")} filteringAriaLabel={uiText("procurementWorkspace.search.procurement.properties")} onChange={({detail})=>setHouseQuery(detail.filteringText)} />
        <div className="proc-house-options">{data.projects.filter(p=>`${p.name} ${p.address}`.toLowerCase().includes(houseQuery.toLowerCase())).map(p=>{
          const t=data.tasks.find(t=>t.project_id===p.id);const info=projectInfo.find(i=>i.id===p.id);
          return <button type="button" key={p.id} aria-pressed={String(p.id)===house} onClick={()=>{setHouse(String(p.id));setView('items');setSelectedId(null);setEditing(null);focused.current=false;setQuery('');setError('');setAttentionOnly(false);setCollapsed([]);setSwitching(false);}}>
            <strong>{p.name}</strong><span>{p.address}</span><small>{stageLabel(info)} {uiText("procurementWorkspace.lead")} {t?.assignee?.display_name || uiText("personAvatar.unassigned")} · {t?.procurement_progress ? uiText("sentences.ready", { value1: (t.procurement_progress.ready), value2: (t.procurement_progress.total) }) : uiText("procurementWorkspace.progress.needs.verification")}{String(p.id)===house ? uiText("procurementWorkspace.current.property.2") : ''}</small>
          </button>;
        })}</div>
        {!data.projects.some(p=>`${p.name} ${p.address}`.toLowerCase().includes(houseQuery.toLowerCase())) && <Box>{uiText("procurementWorkspace.no.matching.properties")}</Box>}
      </SpaceBetween>
    </Modal>
    {!data.projects.length && <Box>{uiText("procurementWorkspace.no.procurement.properties.available.ask.jessie.to.assign.the")}</Box>}
    {house && !currentHouse && data.projects.length > 0 && <Alert type="warning">{uiText("procurementWorkspace.this.property.no.longer.exists.or.is.no.longer")}</Alert>}
    {currentHouse && <>
    <div className="proc-scope-bar">
      <div className="proc-view-switch" role="group" aria-label={uiText("procurementWorkspace.procurement.display.scope")}>
        <button type="button" disabled={houseLocked} aria-pressed={view === 'items'} onClick={() => changeView('items')}>{uiText("procurementWorkspace.procurement.list")}</button>
        <button type="button" disabled={houseLocked} aria-pressed={view === 'pending'} onClick={() => changeView('pending')}>{uiText("procurementScope.pending", { count: pending.length })}</button>
        <button type="button" disabled={houseLocked} aria-pressed={view === 'orders'} onClick={() => changeView('orders')}>{uiText("procurementWorkspace.orders")}</button>
        <button type="button" disabled={houseLocked} aria-pressed={view === 'excluded'} onClick={() => changeView('excluded')}>{uiText("procurementScope.excluded", { count: houseItems.filter(i => i.status === 'na').length })}</button>
      </div>
      <div className="proc-scope-search"><TextFilter disabled={houseLocked} filteringText={query} filteringPlaceholder={view === 'orders' ? uiText("procurementWorkspace.search.title.merchant.order.number.or.item") : uiText("procurementWorkspace.search.materials.specifications.or.notes")} filteringAriaLabel={uiText("procurementWorkspace.search.project.procurement")} onChange={({ detail }) => setQuery(detail.filteringText)} /></div>
    </div>
    {[currentHouse].map(p => <section className="proc-house" key={p.id}>
      <Header variant="h2" actions={canWrite ? <SpaceBetween direction="horizontal" size="s">
        <Button variant="primary" disabled={houseLocked || !task?.assignee} onClick={() => navigate(orderHref(`/projects/${p.id}/purchase-orders/new`))}>{uiText("procurementWorkspace.create.order")}</Button>
        <Button disabled={houseLocked} onClick={() => setAdding(p.id)}>{uiText("purchaseOrderEntry.add.procurement.requirement")}</Button>
      </SpaceBetween> : undefined}>{view==='orders' ? uiText("procurementWorkspace.property.orders") : view === 'pending' ? uiText("procurementWorkspace.pending.requirements.2") : view === 'excluded' ? uiText("procurementWorkspace.not.needed.for.this.property") : uiText("procurementWorkspace.property.procurement.requirements")}</Header>
      {view === 'pending' && <Box color="text-body-secondary">{uiText("procurementWorkspace.requirements.needing.selection.ordering.or.follow.up.sorted.within")}</Box>}
      {view === 'excluded' && <Box color="text-body-secondary">{uiText("procurementWorkspace.excluded.from.procurement.progress.view.details.to.check.the")}</Box>}
      {canWrite && !task?.assignee && <Box color="text-body-secondary">{uiText("procurementWorkspace.ask.jessie.to.assign.a.lead.in.manage.procurement")}</Box>}
      {!canWrite && <Box>{uiText("procurementWorkspace.read.only.procurement.records.amounts.are.procurement.entries.not")}</Box>}
      {managing && canWrite && <ProcurementManagement projectId={p.id} items={houseItems} task={task} onClose={()=>setManaging(false)} onSaved={load} />}
      {adding === p.id && <ProcurementRequirementForm stages={waves} onCancel={() => setAdding(null)} onSave={async (name, wave) => {
        const body = JSON.stringify({project: p.id, name, wave}); if (body !== request.current.body) request.current = {body, key: crypto.randomUUID()};
        const result = await api.addProcurement(p.id, {name, wave, request_key: request.current.key}); await load(); setAdding(null); changeView('items'); focused.current=false; setSelectedId(result.created_item_id ?? null);
      }} />}
      {view === 'orders' ? <Table variant="embedded" header={query ? <Box>{uiText("procurementWorkspace.search.results")} {visibleOrders.length} {uiText("procurementWorkspace.orders.property.total")} {houseOrders.length} {uiText("procurementItemRow.orders.2")}</Box> : undefined} items={visibleOrders} empty={<Box>{query ? uiText("procurementWorkspace.no.matching.orders") : uiText("procurementWorkspace.no.orders.recorded.for.this.property.yet")}</Box>} columnDefinitions={[
        {id:'order',header:uiText("procurementWorkspace.column.order"),minWidth:200,cell:o=><div className="proc-order-cell"><Button variant="inline-link" onClick={()=>navigate(orderHref(`/procurement/orders?project=${p.id}&order=${o.id}`))}>{orderTitle(o.document)}</Button>{o.document.title?.trim() && <small className="proc-order-subtitle">{o.document.vendor} · {o.document.order_number}</small>}</div>},
        {id:'items',header:uiText("purchaseOrderEntry.procurement.item"),minWidth:160,cell:o=>o.document.lines.map(l=>orderLineName(l, houseItems)).join('、')},
        {id:'ordered',header:uiText("procurementItemRow.order.date"),minWidth:110,cell:o=>o.document.ordered_on || uiText("procurementItemRow.not.entered")},
        {id:'expected',header:uiText("procurementItemRow.estimated.arrival"),minWidth:130,cell:o=>{ const next = nextExpected(o); const chip = arrivalChip(o, today); return <div className="proc-order-cell">{o.summary.complete ? uiText("procurementWorkspace.fully.received") : next || uiText("procurementItemRow.not.entered")}{chip && <StatusIndicator type={chip.kind === 'today' ? 'warning' : 'error'}>{chip.kind === 'today' ? uiText("procurementWorkspace.chip.due.today") : uiText("counts.overdue.days", { count: chip.days })}</StatusIndicator>}</div>; }},
        {id:'total',header:uiText("procurementWorkspace.recorded.payment.usd"),minWidth:110,cell:o=>moneyValue(o.document.total)},
        {id:'state',header:uiText("procurementWorkspace.pending.action.receiving"),minWidth:180,cell:o=>orderAttention(o,today).join('；') || (o.summary.complete?uiText("procurementWorkspace.fully.received"):uiText("procurementWorkspace.not.fully.received"))},
        {id:'recorded',header:uiText("procurementWorkspace.column.recorded.at"),minWidth:140,cell:o=>(o.created_at || o.updated_at).replace('T',' ').slice(0,16)},
        {id:'links',header:uiText("procurementWorkspace.column.links"),minWidth:90,cell:o=><span className="proc-order-cell-links">{o.document.order_url && <ExternalLink external href={o.document.order_url}>{uiText("procurementItemRow.merchant.order")}</ExternalLink>}{o.document.voucher_url && <ExternalLink external href={o.document.voucher_url}>{uiText("procurementItemRow.proof.of.purchase")}</ExternalLink>}</span>},
      ]} /> : <>
        {(attentionOnly || query) && <div className="ui-proc-list-caption"><span>{attentionOnly ? uiText("sentences.follow.up.needed.only.items", { value1: (attentionCount) }) : uiText("sentences.search.results.items", { value1: (visible.length) })}</span>{attentionOnly && <Button disabled={houseLocked} variant="inline-link" onClick={() => {setAttentionOnly(false); setQuery('');}}>{uiText("procurementWorkspace.restore.procurement.list")}</Button>}</div>}
        {waves.filter(w => visible.some(r => r.project_id === p.id && r.wave === w.value)).map(group => {
          const rows = visible.filter(r => r.project_id === p.id && r.wave === group.value);
          const open = !collapsed.includes(group.value);
          return <section className="proc-material-group" key={group.value}>
            <h3><button type="button" disabled={dirty && rows.some(r => r.id === editing)} aria-expanded={open} aria-controls={`proc-group-${group.value}`} onClick={() => setCollapsed(open ? [...collapsed,group.value] : collapsed.filter(g => g !== group.value))}><Icon name={open ? 'angle-down' : 'angle-right'} /><span>{systemText(group.label)}</span><small>{uiText("counts.items", { count: rows.length })}</small></button></h3>
            {open && <div id={`proc-group-${group.value}`}>
            <div className="ui-proc-items">{rows.map(row => <ProcurementItemRow key={row.id} row={row} readOnly={!canWrite} orders={houseOrders} waves={waves} expanded={selectedId===row.id} statusLabel={statuses.find(s=>s.value===row.status)?.label||row.status} newBy={newById.get(row.id)} onToggle={()=>choose(row.id)} onEdit={()=>{if(dirty){setError(uiText("procurementWorkspace.save.or.discard.changes.first"));return;}setEditing(editing===row.id?null:row.id);}} onOrder={id=>{if(dirty){setError(uiText("procurementWorkspace.save.or.discard.changes.first"));return;}navigate(orderHref(`/procurement/orders?project=${p.id}&material=${row.id}&order=${id}`));}} onDeleted={canWrite && !houseLocked ? afterDelete : undefined}>
              {editing===row.id && <ProcurementItemEditor key={row.id} materialId={row.id} houseId={p.id} onDirty={setDirty} onClose={()=>{setEditing(null);setDirty(false);}} onSaved={load} onDeleted={afterDelete} />}
            </ProcurementItemRow>)}</div>
            </div>}
          </section>;
        })}
        {!visible.some(r=>r.project_id===p.id) && <Box padding="m">{view === 'pending' && !query ? uiText("procurementWorkspace.no.pending.requirements") : view === 'excluded' && !query ? uiText("procurementWorkspace.no.materials.are.marked.not.needed.for.this.property") : !attentionOnly && !query && !houseItems.some(i => i.in_worklist) ? uiText("procurementWorkspace.no.requirements.in.this.property.s.list.for.an") : uiText("procurementWorkspace.no.materials.match.the.filters")}</Box>}
      </>}
    </section>)}
    </>}
  </SpaceBetween></div>;
}
