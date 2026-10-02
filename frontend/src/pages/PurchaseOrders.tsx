import { orderLineName } from '../i18n/templateNames.ts';
import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams, useParams } from 'react-router-dom';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Textarea from '@cloudscape-design/components/textarea';
import { api, type ProcurementItem, type ProcurementWorkspaceData } from '../api/client';
import Header from '../components/ui/Header';
import FormField from '../components/ui/FormField';
import { ExpandableSection, Table } from '../components/ui/Surface';
import PurchaseOrderEntry from '../components/PurchaseOrderEntry';
import PurchaseOrderFields, { DateField, TextField } from '../components/PurchaseOrderFields';
import ProductThumb from '../components/ProductThumb';
import { type PurchaseOrder, type OrderDocument, type ImportPreview, type Receipt, type Adjustment,
  newOrder, newLine, importDocument, moneyValue, todayLA, websiteStatusLabel, refundedAfterAdjustment, orderTitle, lineStatus, lineStatusLabel } from '../lib/purchaseOrders';
import {materialQuantityFacts} from '../lib/procurementSummary';
import { useFlash } from '../lib/flash';
import { useActor } from '../lib/actor';
import { userCan } from '../lib/role';
import { useMeta } from '../lib/meta';
import { orderFormErrors, receiptFormErrors, adjustmentFormErrors, procurementReturnTo, procurementSaveError } from '../lib/procurementForm';
import { orderStages } from '../lib/orderStages';

export default function PurchaseOrders() {
  useLanguage();
  const [params] = useSearchParams();
  const route = useParams();
  const navigate = useNavigate(); const flash = useFlash(); const meta = useMeta(); const { me } = useActor(); const canWrite = userCan(meta, me, 'procurement');
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const initialMaterial = Number(params.get('material')) || 0;
  const initialOrder = Number(params.get('order')) || 0;
  const [workspace, setWorkspace] = useState<ProcurementWorkspaceData | null>(null);
  const [projectId, setProjectId] = useState(route.projectId ?? params.get('project') ?? '');
  const [entryExpected,setEntryExpected]=useState('');
  const [entryNode, setEntryNode] = useState(params.get('node') ?? '');
  const nodes = meta?.procurement_waves ?? [];
  const [selected, setSelected] = useState<PurchaseOrder | null>(null);
  const [customizing, setCustomizing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [doc, setDoc] = useState<OrderDocument>(newOrder());
  const [original, setOriginal] = useState('');
  const [source, setSource] = useState(''); const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [appliedFields, setAppliedFields] = useState<string[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [attempted, setAttempted] = useState(false); const [receiptAttempted, setReceiptAttempted] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  const returnTo = procurementReturnTo(params.get('returnTo'), projectId);
  const routeSuffix = params.get('returnTo') ? `&returnTo=${encodeURIComponent(returnTo)}` : '';
  const fieldErrors = attempted ? orderFormErrors(doc, selected ? undefined : entryNode) : {};
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [eventNote, setEventNote] = useState('');
  const [receiving, setReceiving] = useState<Receipt | null>(null);
  const [adjustment, setAdjustment] = useState<Adjustment | null>(null);
  const [adjustmentAttempted, setAdjustmentAttempted] = useState(false);
  const [conflict, setConflict] = useState(false);
  const receiptErrors = receiptAttempted && receiving ? receiptFormErrors(receiving) : {};
  const [voidId, setVoidId] = useState(''); const [voidReason, setVoidReason] = useState('');
  const adjustmentLine = adjustment && selected ? selected.summary.lines.find(l => l.id === adjustment.line_id) : undefined;
  const pendingRequest = useRef({ payload: '', key: '' });
  const loadedInitial = useRef(false);
  const dirty = editing && (JSON.stringify(doc) !== original || !!source || !!eventNote || customizing || (!selected && !!entryExpected));
  const project = workspace?.projects.find(p => p.id === Number(projectId));
  const materials = workspace?.items.filter(i => i.project_id === Number(projectId)) ?? [];
  const today = todayLA();
  const lineName = (line: { name: string; material_id?: number | null } | undefined) => orderLineName(line, materials);
  const adjustmentErrors = adjustmentAttempted && adjustment && adjustmentLine ? adjustmentFormErrors(adjustment, adjustmentLine, doc, today) : {};
  /** A 409 means a teammate saved first; keep the local entry and offer a reload instead of discarding it. */
  const fail = (e: unknown) => { setError(procurementSaveError(e)); if ((e as { status?: number })?.status === 409) setConflict(true); };
  useEffect(() => {
    if (!error) return;
    requestAnimationFrame(() => {
      const invalid = surface.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
      const target = invalid || surface.current?.querySelector<HTMLElement>('[data-form-error]');
      target?.scrollIntoView({block: 'center'}); target?.focus();
    });
  }, [error]);
  useEffect(() => { if (receiving) requestAnimationFrame(() => { const input = surface.current?.querySelector<HTMLElement>('.proc-receipt-form input'); input?.focus(); input?.scrollIntoView({block:'center'}); }); }, [!!receiving]);
  useEffect(() => { if (adjustment) requestAnimationFrame(() => { const input = surface.current?.querySelector<HTMLElement>('.proc-return-form input'); input?.focus(); input?.scrollIntoView({block:'center'}); }); }, [!!adjustment]);
  useEffect(() => { if (detailsOpen) requestAnimationFrame(() => { const form = surface.current?.querySelector<HTMLElement>('.proc-order-edit input'); form?.focus(); form?.scrollIntoView({block:'center'}); }); }, [detailsOpen]);
  const requestKey = (payload: unknown) => {
    const encoded = JSON.stringify(payload);
    if (encoded !== pendingRequest.current.payload) pendingRequest.current = { payload: encoded, key: crypto.randomUUID() };
    return pendingRequest.current.key;
  };
  const load = useCallback(async () => {
    const [next, purchases] = await Promise.all([api.procurementTracking(), api.purchaseOrders()]);
    setWorkspace(next); setOrders(purchases);
  }, []);
  useEffect(() => { load().catch(e => setError(e.message)); }, [load]);
  useEffect(() => {
    if (!dirty && !receiving && !adjustment) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', prevent); return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty, receiving, adjustment]);
  const adopt = (order: PurchaseOrder) => {
    setSelected(order); setProjectId(String(order.project_id)); setDoc(order.document); setOriginal(JSON.stringify(order.document));
    setEditing(true); setDetailsOpen(false); setAttempted(false); setReceiptAttempted(false); setSource(''); setPreview(null); setEventNote(''); setReceiving(null); setAdjustment(null); setAdjustmentAttempted(false); setVoidId(''); setError(''); setConflict(false);
  };
  const open = async (id: number, keepSource = false, receiveLine = '') => {
    if (dirty && !keepSource) { setError(uiText("purchaseOrders.save.or.discard.this.draft.before.opening.another.order")); return; }
    setBusy(true); setError('');
    try { const order = await api.purchaseOrder(id); const text = source; adopt(order); if (keepSource) setSource(text); navigate(`/procurement/orders?project=${order.project_id}&order=${order.id}${routeSuffix}`, { replace: true });
      // Arrival reminder deep link: land directly on this line's receipt form when it still needs quantity.
      if (canWrite && receiveLine && order.summary.lines.some(l => l.id === receiveLine && (l.remaining == null || Number(l.remaining) > 0))) startReceipt([receiveLine], order.document.delivery_address || workspace?.projects.find(p => p.id === order.project_id)?.address || ''); }
    catch (e) { setError(procurementSaveError(e)); } finally { setBusy(false); }
  };
  useEffect(() => {
    if (!workspace || loadedInitial.current) return;
    loadedInitial.current = true;
    if (initialOrder) void open(initialOrder, false, params.get('receive') ?? '');
    else if (route.projectId || params.get('new') === '1') start();
  }, [workspace]); // Initial route only; later navigation is explicit.
  const reset = () => { setEditing(false); setSelected(null); setSource(''); setPreview(null); setEventNote(''); setReceiving(null); setAdjustment(null); setVoidId(''); setError(''); };
  const start = (targetProjectId = Number(projectId), targetNode = entryNode, targetMaterialId = initialMaterial) => {
    const targetProject = workspace?.projects.find(p => p.id === targetProjectId);
    if (!targetProject) { setError(uiText("purchaseOrders.select.the.property.s.order.destination.first.each.order")); return; }
    const next = newOrder(); next.ordered_on = today;
    const material = workspace?.items.find(m => m.project_id === targetProject.id && m.id === targetMaterialId && (!targetNode || m.wave === targetNode));
    setProjectId(String(targetProject.id)); setEntryNode(material?.wave || targetNode);
    if (material) next.lines = [{ ...newLine(material.id), name: material.name, quantity: materialQuantityFacts(material,orders).unplaced || null, unit: material.unit || '件',
      needed_on: material.needed_on || null, specification: material.specification || '', location: material.use_location || '' }];
    else next.lines = [];
    next.delivery_address = targetProject.address;
    setSelected(null); setDoc(next); setOriginal(JSON.stringify(next)); setEditing(true); setSource(''); setPreview(null); setError('');
  };
  const runPreview = async () => {
    if (!source.trim() || !project) return;
    setBusy(true); setError('');
    try { setPreview(await api.previewPurchaseOrder(project.id, source)); setAppliedFields([]); }
    catch (e) { setError(procurementSaveError(e)); } finally { setBusy(false); }
  };
  const addMaterial = async (name: string, wave: string): Promise<ProcurementItem> => {
    if (!project || !workspace) throw new Error(uiText("purchaseOrders.select.a.property.first"));
    setBusy(true);
    try {
      // Re-read before adding so an interrupted request can reuse the already-created item.
      const current = await api.procurement(project.id);
      const existing = current.items.find(i => i.wave === wave && i.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase());
      const next = existing ? current : await api.addProcurement(project.id, { name: name.trim(), wave, request_key: requestKey({ kind: 'material', projectId, name: name.trim(), wave }) });
      const item = existing || next.items.find(i => i.id === next.created_item_id)!;
      setWorkspace(w => w ? { ...w, items: [...w.items.filter(i => i.project_id !== project.id), ...next.items.map(i => ({ ...i, project_name: project.name }))] } : w);
      return item;
    } finally { setBusy(false); }
  };
  const save = async () => {
    if (!project) return;
    if (busy) return;
    setAttempted(true);
    const invalid = orderFormErrors(doc, selected ? undefined : entryNode);
    if (Object.keys(invalid).length) { setError(Object.values(invalid)[0]); return; }
    setBusy(true); setError('');
    const document = { ...doc };
    const payload = { document, source_text: source, note: eventNote, ...(selected ? { expected_version: selected.version } : {}) };
    try {
      const body = { ...payload, request_key: requestKey({ projectId, id: selected?.id, ...payload }) };
      const saved = selected ? await api.savePurchaseOrder(selected.id, body) : await api.createPurchaseOrder(project.id, body);
      adopt(saved); await load();
      if (!selected) navigate(`/procurement/orders?project=${project.id}&order=${saved.id}${routeSuffix}`, { replace: true });
      flash({ type: 'success', content: uiText("purchaseOrders.order.saved.linked.procurement.items.show.purchase.and.receipt") });
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const receive = async () => {
    if (!selected || !receiving) return;
    if (busy) return;
    setReceiptAttempted(true);
    const invalid = receiptFormErrors(receiving);
    if (Object.keys(invalid).length) { setError(Object.values(invalid)[0]); return; }
    setBusy(true); setError('');
    const receipt = { ...receiving, lines: receiving.lines.filter(l => Number(l.quantity) > 0) };
    const payload = { receipt, expected_version: selected.version };
    try { adopt(await api.receivePurchaseOrder(selected.id, { ...payload, request_key: requestKey({ id: selected.id, ...payload }) })); await load();
      flash({ type: 'success', content: uiText("purchaseOrders.actual.receipt.recorded") });
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  /** One receipt body for the whole order or a single line; the quantity is never prefilled because a partial arrival is not completion. */
  const startReceipt = (lineIds: string[], location = doc.delivery_address || project?.address || '') => {
    setError(''); setReceiptAttempted(false);
    setReceiving({ id: crypto.randomUUID(), delivery_id: null, received_on: today, location,
      lines: lineIds.map(id => ({ line_id: id, quantity: lineIds.length === 1 ? '' : '0', damaged_quantity: '0' })), note: '', confirmed_by: 0, confirmed_name: '', recorded_at: '', void_reason: '' });
  };
  const startReturn = (lineId: string) => { setError(''); setAdjustmentAttempted(false); setAdjustment({ id: crypto.randomUUID(), line_id: lineId, returned_quantity: '', returned_usable_quantity: '0', refund: null, occurred_on: today, reason: '' }); };
  const recordReturn = async () => {
    if (!selected || !adjustment || !adjustmentLine || busy) return;
    setAdjustmentAttempted(true);
    const invalid = adjustmentFormErrors(adjustment, adjustmentLine, doc, today);
    if (Object.keys(invalid).length) { setError(Object.values(invalid)[0]); return; }
    const entry: Adjustment = { ...adjustment, returned_quantity: adjustment.returned_quantity || '0', returned_usable_quantity: adjustment.returned_usable_quantity || '0', refund: adjustment.refund === '' ? null : adjustment.refund, reason: adjustment.reason.trim() };
    const document = { ...doc, adjustments: [...doc.adjustments, entry], refunded: refundedAfterAdjustment(doc, entry).refunded };
    const note = uiText("purchaseOrders.return.note", { value1: lineName(adjustmentLine), value2: String(entry.returned_quantity), value3: entry.refund == null ? uiText("procurementItemRow.not.entered.2") : moneyValue(entry.refund) });
    const payload = { document, source_text: '', note, expected_version: selected.version };
    setBusy(true); setError('');
    try { adopt(await api.savePurchaseOrder(selected.id, { ...payload, request_key: requestKey({ projectId, id: selected.id, ...payload }) })); await load();
      flash({ type: 'success', content: uiText("purchaseOrders.return.recorded") });
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const reloadAndContinue = async () => {
    if (!selected) return;
    const keptReturn = adjustment, keptReceipt = receiving;
    setBusy(true); setError('');
    try { adopt(await api.purchaseOrder(selected.id)); setAdjustment(keptReturn); setReceiving(keptReceipt); }
    catch (e) { setError(procurementSaveError(e)); } finally { setBusy(false); }
  };
  const voidReceipt = async () => {
    if (!selected || !voidId || !voidReason.trim()) return;
    setBusy(true); setError(''); const payload = { expected_version: selected.version, reason: voidReason };
    try { adopt(await api.voidPurchaseReceipt(selected.id, voidId, { ...payload, request_key: requestKey({ id: selected.id, voidId, ...payload }) })); await load(); setVoidReason(''); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  if (!canWrite && !initialOrder && workspace) return <Navigate replace to={returnTo} />;
  if (!initialOrder && !route.projectId && params.get('new') !== '1') {
    const target = new URLSearchParams({view: 'orders'});
    if (projectId) target.set('project', projectId);
    return <Navigate replace to={`/procurement?${target}`} />;
  }
  if (workspace && !editing) return error
    ? <Alert type="error" action={<Button onClick={() => navigate(projectId ? `/procurement?project=${projectId}` : '/procurement')}>{uiText("purchaseOrders.back.to.procurement.workspace")}</Button>}>{systemText(error)}</Alert>
    : <Spinner />;
  if (!workspace) return error ? <Alert type="error" action={<Button onClick={() => { setError(''); void load().catch(e => setError(e.message)); }}>{uiText("addProject.retry")}</Button>}>{systemText(error)}</Alert> : <Spinner />;
  const purposes = orderStages(doc.lines, Number(projectId), workspace.items, nodes).filter(stage => stage.value !== 'unmapped');
  const purposeTitle = purposes.length ? purposes.map(s => s.label).join(' / ') : nodes.find(n => n.value === entryNode)?.label;
  return <div className="procurement-surface procurement-order" ref={surface}><SpaceBetween size="l">
    <Header variant="h1" description={[selected?.document.title?.trim() ? `${selected.document.vendor} · ${selected.document.order_number}` : '', project?.name ?? '', purposeTitle ?? ''].filter(Boolean).join(' · ')}
      actions={<SpaceBetween direction="horizontal" size="s">
        <Button disabled={busy} onClick={() => { if (dirty || receiving || adjustment) setError(uiText("purchaseOrders.save.or.discard.the.current.content.first")); else navigate(returnTo); }}>{uiText("purchaseOrders.back.to.property.procurement")}</Button>

      </SpaceBetween>}>{selected ? orderTitle(selected.document) : uiText("procurementWorkspace.create.order")}</Header>
    {error && <div data-form-error tabIndex={-1}><Alert type="error" dismissible onDismiss={() => setError('')}>{systemText(error)}</Alert></div>}
    {conflict && selected && <Alert type="warning" action={<Button disabled={busy} onClick={() => void reloadAndContinue()}>{uiText("purchaseOrders.reload.and.continue")}</Button>}>{uiText("purchaseOrders.conflict.keep.input.reload")}</Alert>}
    {!canWrite && <Box>{uiText("procurementWorkspace.read.only.procurement.records.amounts.are.procurement.entries.not")}</Box>}
    {selected && <div className="proc-order-facts"><span>{uiText("procurementItemRow.order.date")} <strong>{selected.document.ordered_on || uiText("procurementItemRow.not.entered.2")}</strong></span><span>{uiText("procurementWorkspace.recorded.payment.usd")} <strong>{moneyValue(selected.document.total)}</strong></span><span>{uiText("purchaseOrders.total.refunds")} <strong>{moneyValue(selected.summary.refund)}</strong></span><span>{uiText("procurementItemRow.delivery.address")} <strong>{selected.document.delivery_address || uiText("procurementItemRow.not.entered.2")}</strong></span>{canWrite && <Button disabled={busy || !!receiving || !!adjustment || !!voidId} onClick={() => { if (dirty) setError(uiText("purchaseOrders.save.or.cancel.order.changes.first")); else setDetailsOpen(!detailsOpen); }}>{detailsOpen ? uiText("purchaseOrders.collapse.order.editor") : uiText("purchaseOrders.edit.order")}</Button>}</div>}
      {selected && <>
        {!!selected.summary.missing.length && <ExpandableSection headerText={uiText("purchaseOrders.view.missing.information")}><Box>{selected.summary.missing.join('；')}</Box></ExpandableSection>}
        {(selected.document.follow_up || selected.document.note) && <section className="proc-order-notes"><h2>{uiText("purchaseOrders.follow.up.and.notes")}</h2>{selected.document.follow_up && <p><strong>{uiText("purchaseOrders.pending")}</strong>{selected.document.follow_up}{selected.document.follow_up_on ? uiText("sentences.next.follow.up", { value1: (selected.document.follow_up_on) }) : ''}</p>}{selected.document.note && <p>{selected.document.note}</p>}{selected.document.checked_on && <p className="proc-detail-note">{uiText("purchaseOrders.last.manual.verification")} {selected.document.checked_on}</p>}</section>}
        <section className="proc-receiving"><Header variant="h2">{uiText("purchaseOrders.items.and.receiving.gaps")}</Header>
          <div className="proc-receipt-list">{selected.summary.lines.map(l => {
            const item = selected.document.lines.find(line => line.id === l.id);
            const unit = systemText(item?.unit || '');
            const differences = [item?.brand && uiText("sentences.brand", { value1: (item.brand) }), item?.vendor && uiText("sentences.seller", { value1: (item.vendor) }), item?.expected_on && uiText("sentences.estimated.2", { value1: (item.expected_on) }), item?.delivery_address && item.delivery_address !== selected.document.delivery_address && uiText("sentences.deliver.item.to", { value1: (item.delivery_address) })].filter(Boolean).join(' · ');
            const status = item ? lineStatus(l, item) : 'pending';
            const outstanding = l.remaining == null || Number(l.remaining) > 0;
            return <div className="proc-receipt-row" key={l.id}><div className="proc-line-head"><ProductThumb src={item?.image_url} label={lineName(l)} /><div><div className="proc-line-title"><strong>{lineName(l)}</strong><StatusIndicator type={status === 'received' ? 'success' : status === 'partial' ? 'in-progress' : status === 'cancelled' || status === 'returned' ? 'stopped' : 'pending'}>{lineStatusLabel(status)}</StatusIndicator></div>{item?.specification && <p className="proc-line-differences">{item.specification}</p>}<p className="proc-line-differences">{uiText("purchaseOrderCoverage.item.amount")} {moneyValue(l.amount)}</p>{differences && <p className="proc-line-differences">{differences}</p>}{item?.issue_note && <p className="proc-item-issue">{uiText("procurementItemRow.action.needed")}{item.issue_note}</p>}{websiteStatusLabel(item?.website_status) && <p className="proc-line-differences">{uiText("purchaseOrders.carrier.status")}{websiteStatusLabel(item?.website_status)}{uiText("purchaseOrders.not.proof.of.receipt")}</p>}<div className="proc-detail-links">{item?.product_url && <Link external href={item.product_url}>{uiText("procurementItemRow.product.link")}</Link>}{item?.tracking_url && <Link external href={item.tracking_url}>{uiText("procurementItemRow.tracking.link")}</Link>}</div></div></div><dl><div><dt>{uiText("purchaseOrders.ordered")}</dt><dd>{l.quantity ?? uiText("procurementItemRow.not.entered.2")} {unit}</dd></div><div><dt>{uiText("purchaseOrders.received.in.good.condition")}</dt><dd>{l.usable} {unit}</dd></div><div><dt>{uiText("purchaseOrderCoverage.still.needed")}</dt><dd className={l.remaining == null || Number(l.remaining) > 0 ? 'proc-shortage' : ''}>{l.remaining ?? uiText("procurementItemRow.needs.verification")} {unit}</dd></div></dl>{Number(l.damaged) > 0 && <span>{uiText("purchaseOrders.total.received")} {l.received}{uiText("purchaseOrders.including.damaged")} {l.damaged} {unit}</span>}{canWrite && <div className="proc-line-actions">{outstanding && status !== 'cancelled' && <Button variant="inline-link" disabled={busy || dirty || !!receiving || !!adjustment || !!voidId} onClick={() => startReceipt([l.id])}>{uiText("purchaseOrders.record.receipt.for.this.item")}</Button>}<Button variant="inline-link" disabled={busy || dirty || !!receiving || !!adjustment || !!voidId} onClick={() => startReturn(l.id)}>{uiText("purchaseOrders.return.refund.this.item")}</Button></div>}</div>;
          })}</div>
          <Box color="text-body-secondary">{uiText("purchaseOrders.confirming.actual.receipt.updates.linked.procurement.items.for.partial")}</Box>
          {canWrite && <SpaceBetween direction="horizontal" size="s"><Button variant="primary" disabled={!canWrite || busy || dirty || !!receiving || !!adjustment || !!voidId || !selected.summary.lines.some(l => l.remaining == null || Number(l.remaining) > 0)} onClick={() => startReceipt(selected.summary.lines.filter(l => l.remaining == null || Number(l.remaining) > 0).map(l => l.id))}>{uiText("purchaseOrders.record.receipt")}</Button></SpaceBetween>}
          {canWrite && <ExpandableSection headerText={uiText("purchaseOrders.returns.refunds.when.applicable")}><SpaceBetween size="s">
            <TextField label={uiText("purchaseOrders.total.refunded.usd")} hint={uiText("purchaseOrders.refund.total.auto.sum.hint")} numeric value={doc.refunded ?? ''} disabled={!canWrite || busy || !!receiving || !!adjustment} onChange={v => setDoc({ ...doc, refunded: v || null })} />
          </SpaceBetween></ExpandableSection>}
          {dirty && <Box color="text-status-warning">{uiText("purchaseOrders.save.order.changes.before.recording.receipts.or.returns")}</Box>}
          {receiving && <div className="proc-receipt-form"><SpaceBetween size="m"><Header variant="h3">{uiText("purchaseOrders.this.receipt")}</Header><div className="ui-order-grid">
            <DateField disabled={busy} error={receiptErrors.date} label={uiText("purchaseOrders.actual.receipt.date")} value={receiving.received_on} onChange={v => setReceiving({ ...receiving, received_on: v })} />
            <TextField disabled={busy} error={receiptErrors.location} label={uiText("purchaseOrders.actual.receiving.location")} value={receiving.location} onChange={v => setReceiving({ ...receiving, location: v })} />
            {receiving.lines.map(line => { const fact = selected.summary.lines.find(l => l.id === line.line_id); const remaining = fact?.remaining == null || fact.remaining === '' ? null : String(fact.remaining); return <div className="proc-receipt-input" key={line.line_id}><strong>{lineName(doc.lines.find(l => l.id === line.line_id))}</strong><p>{uiText("purchaseOrders.previously.received.in.good.condition")} {fact?.usable} {uiText("purchaseOrders.still.needed")} {fact?.remaining ?? uiText("purchaseOrders.verify")} {systemText(doc.lines.find(l => l.id === line.line_id)?.unit)}{remaining && Number(remaining) > 0 && <> · <Button variant="inline-link" disabled={busy} onClick={() => setReceiving({ ...receiving, lines: receiving.lines.map(l => l.line_id === line.line_id ? { ...l, quantity: remaining } : l) })}>{uiText("purchaseOrders.fill.remaining", { value1: remaining })}</Button></>}</p>
              <TextField disabled={busy} error={receiptErrors[`${line.line_id}.quantity`]} label={uiText("sentences.quantity.received.this.time", { value1: (lineName(doc.lines.find(l => l.id === line.line_id))) })} numeric value={line.quantity} onChange={v => setReceiving({ ...receiving, lines: receiving.lines.map(l => l.line_id === line.line_id ? { ...l, quantity: v } : l) })} />
              <TextField disabled={busy} error={receiptErrors[`${line.line_id}.damaged`]} label={uiText("sentences.damaged.quantity.this.time", { value1: (lineName(doc.lines.find(l => l.id === line.line_id))) })} numeric value={line.damaged_quantity} onChange={v => setReceiving({ ...receiving, lines: receiving.lines.map(l => l.line_id === line.line_id ? { ...l, damaged_quantity: v || '0' } : l) })} />
            </div>; })}
          </div>{receiptErrors.lines && <Alert type="error">{receiptErrors.lines}</Alert>}<TextField disabled={busy} label={uiText("purchaseOrders.receipt.notes.missing.or.damaged.items")} value={receiving.note} onChange={v => setReceiving({ ...receiving, note: v })} />
            <SpaceBetween direction="horizontal" size="s"><Button variant="primary" loading={busy} onClick={receive}>{uiText("purchaseOrders.confirm.actual.receipt")}</Button><Button disabled={busy} onClick={() => { setReceiving(null); setReceiptAttempted(false); setError(''); }}>{uiText("purchaseOrders.cancel.entry")}</Button></SpaceBetween>
          </SpaceBetween></div>}
          {adjustment && adjustmentLine && <div className="proc-return-form"><SpaceBetween size="m"><Header variant="h3" description={uiText("purchaseOrders.return.facts", { value1: String(adjustmentLine.received), value2: String(adjustmentLine.returned), value3: String(adjustmentLine.usable), value4: systemText(doc.lines.find(l => l.id === adjustment.line_id)?.unit || '') })}>{uiText("purchaseOrders.return.refund.form.title")} · {lineName(adjustmentLine)}</Header>
            <div className="ui-order-grid">
              <TextField disabled={busy} error={adjustmentErrors.returned} hint={uiText("purchaseOrders.refund.only.hint")} label={uiText("purchaseOrders.actual.return.quantity")} numeric value={adjustment.returned_quantity} onChange={v => setAdjustment({ ...adjustment, returned_quantity: v })} />
              <TextField disabled={busy} error={adjustmentErrors.usable} label={uiText("purchaseOrders.quantity.previously.in.good.condition")} numeric value={adjustment.returned_usable_quantity} onChange={v => setAdjustment({ ...adjustment, returned_usable_quantity: v || '0' })} />
              <TextField disabled={busy} error={adjustmentErrors.refund} label={uiText("purchaseOrders.refund.amount.usd")} numeric value={adjustment.refund} onChange={v => setAdjustment({ ...adjustment, refund: v || null })} />
              <DateField disabled={busy} error={adjustmentErrors.date} label={uiText("purchaseOrders.actual.event.date")} value={adjustment.occurred_on} onChange={v => setAdjustment({ ...adjustment, occurred_on: v })} />
            </div><TextField disabled={busy} error={adjustmentErrors.reason} label={uiText("purchaseOrders.return.refund.reason.and.receipt.notes")} value={adjustment.reason} onChange={v => setAdjustment({ ...adjustment, reason: v })} />
            {refundedAfterAdjustment(doc, adjustment).raised && <Box color="text-status-info">{uiText("purchaseOrders.order.refund.total.will.update", { value1: moneyValue(refundedAfterAdjustment(doc, adjustment).refunded) })}</Box>}
            <SpaceBetween direction="horizontal" size="s"><Button variant="primary" loading={busy} onClick={recordReturn}>{uiText("purchaseOrders.save.return")}</Button><Button disabled={busy} onClick={() => { setAdjustment(null); setAdjustmentAttempted(false); setError(''); }}>{uiText("purchaseOrders.cancel.entry")}</Button></SpaceBetween>
          </SpaceBetween></div>}
          <ExpandableSection headerText={uiText("sentences.receipt.records", { value1: (doc.receipts.length) })}>{!doc.receipts.length && <Box>{uiText("purchaseOrders.no.actual.receipts.recorded.yet")}</Box>}{doc.receipts.map(r => <div className="proc-history-entry" key={r.id}>
            <strong>{r.received_on} · {r.confirmed_name || uiText("purchaseOrders.procurement.entry")}</strong><p>{r.location || uiText("purchaseOrders.receiving.location.not.entered")}</p>
            <dl className="proc-detail-facts">{r.lines.map(l=><div key={l.line_id}><dt>{lineName(doc.lines.find(item=>item.id===l.line_id))}</dt><dd>{uiText("procurementItemRow.received")} {l.quantity} {uiText("purchaseOrders.damaged")} {l.damaged_quantity} {systemText(doc.lines.find(item=>item.id===l.line_id)?.unit)}</dd></div>)}</dl>{r.note && <p>{r.note}</p>}
            {r.void_reason ? <Box color="text-status-warning">{uiText("purchaseOrders.reversed")}{r.void_reason}</Box> : canWrite ? <Button variant="inline-link" disabled={busy || dirty || !!receiving || !!adjustment || !!voidId} onClick={() => { setVoidId(r.id); setVoidReason(''); }}>{uiText("purchaseOrders.correct.an.erroneous.receipt")}</Button> : null}
          </div>)}</ExpandableSection>
          {voidId && <SpaceBetween size="s"><TextField label={uiText("purchaseOrders.reversal.reason.original.record.retained.a.new.receipt.can")} value={voidReason} onChange={setVoidReason} /><SpaceBetween direction="horizontal" size="s"><Button disabled={busy || !voidReason.trim()} onClick={voidReceipt}>{uiText("purchaseOrders.reverse.this.receipt")}</Button><Button onClick={() => setVoidId('')}>{uiText("purchaseOrders.cancel.correction")}</Button></SpaceBetween></SpaceBetween>}
          {!!doc.adjustments.length && <ExpandableSection headerText={uiText("sentences.return.records", { value1: (doc.adjustments.length) })}>{doc.adjustments.map(a => <div className="proc-history-entry" key={a.id}><strong>{a.occurred_on} · {lineName(doc.lines.find(l=>l.id===a.line_id))}</strong><p>{uiText("procurementItemRow.return")} {a.returned_quantity} {systemText(doc.lines.find(l=>l.id===a.line_id)?.unit)}{a.refund!=null ? uiText("sentences.refund.recorded", { value1: (moneyValue(a.refund)) }) : ''}</p><p>{a.reason}</p></div>)}</ExpandableSection>}
        </section>
        <ExpandableSection headerText={uiText("sentences.actions.and.original.text.history", { value1: (selected.events?.length ?? 0) })}>
          <SpaceBetween size="m">{selected.events?.map(e => <ExpandableSection key={e.version} headerText={`${systemText(e.kind)} · ${e.actor} · ${e.created_at.replace('T', ' ')}`}>
            <Box>{e.note || uiText("purchaseOrders.no.additional.notes")}</Box>{e.source_text && <pre className="ui-order-source">{e.source_text}</pre>}
            <Box>{uiText("purchaseOrders.order.total.at.the.time")} {moneyValue(e.document.total)} {uiText("purchaseOrders.items")} {e.document.lines.length} {uiText("purchaseOrders.follow.up")}{e.document.follow_up || uiText("procurementWorkspace.none")}</Box>
            <Box>{e.document.note}</Box>
          </ExpandableSection>)}</SpaceBetween>
        </ExpandableSection>
        <SpaceBetween direction="horizontal" size="s">{doc.order_url && <Link href={doc.order_url} external>{uiText("purchaseOrders.open.merchant.order")}</Link>}{doc.voucher_url && <Link href={doc.voucher_url} external>{uiText("purchaseOrders.view.proof.of.purchase")}</Link>}
          {doc.deliveries.filter(d => d.tracking_url).map(d => <Link key={d.id} href={d.tracking_url!} external>{systemText(d.label)} {uiText("procurementItemRow.tracking")}</Link>)}
        </SpaceBetween>
      </>}
      <div className="proc-order-edit" hidden={!canWrite || (!!selected && !detailsOpen)}>
      {selected ? <PurchaseOrderFields errors={fieldErrors} key={selected.id} nodes={nodes} defaultNode={entryNode} doc={doc} onChange={setDoc} materials={materials} busy={busy || !!receiving || !!adjustment || !!voidId} /> : <PurchaseOrderEntry errors={fieldErrors} key={`new-${projectId}`} nodes={nodes} defaultNode={entryNode} onStageChange={setEntryNode} onAddMaterial={addMaterial} onCustomizing={setCustomizing} doc={doc} onChange={setDoc} materials={materials} orders={orders} expectedOn={entryExpected} onExpectedChange={setEntryExpected} busy={busy} />}
      <ExpandableSection headerText={selected ? uiText("purchaseOrders.paste.a.follow.up.order.email.preserve.original.text") : uiText("purchaseOrders.import.pasted.order")} defaultExpanded={false}>
        <SpaceBetween size="m">
          <FormField label={uiText("purchaseOrders.original.order.text")}>
            <Textarea value={source} rows={4} disabled={busy || !!receiving || !!adjustment || !!voidId} onChange={({ detail }) => { setSource(detail.value); setPreview(null); }} placeholder={uiText("purchaseOrders.copy.items.quantities.and.amounts.from.the.order.page")} />
          </FormField>
          <Button disabled={busy || !!receiving || !!adjustment || !!voidId || !source.trim()} loading={busy} onClick={runPreview}>{uiText("purchaseOrders.recognize.order")}</Button>
          {preview && <>
            {preview.warnings.length > 0 && <Alert type="info">{preview.warnings.join(' ')}</Alert>}
            {preview.existing_order_id && preview.existing_order_id !== selected?.id && <Alert type="warning" action={<Button onClick={() => void open(preview.existing_order_id!, true)}>{uiText("purchaseOrders.open.existing.order.and.retain.original.text")}</Button>}>{uiText("purchaseOrders.this.order.is.already.recorded.check.the.existing.record")}</Alert>}
            <Box>{uiText("purchaseOrders.detected.merchant")}{preview.draft.vendor || uiText("purchaseOrders.not.detected")} {uiText("purchaseOrders.order.number")}{preview.draft.order_number || uiText("purchaseOrders.not.detected")} {uiText("purchaseOrders.candidate.items")} {preview.draft.lines.length} {uiText("purchaseOrders.records")}</Box>
            <Table variant="embedded" items={preview.draft.lines} columnDefinitions={[{ id: 'name', header: uiText("purchaseOrders.detected.items.verify.before.use"), cell: l => l.name }, { id: 'qty', header: uiText("procurementItemRow.quantity"), cell: l => l.quantity ?? uiText("purchaseOrders.not.detected") }, { id: 'price', header: uiText("procurementItemRow.unit.price"), cell: l => moneyValue(l.unit_price ?? null) }]} />
            <ExpandableSection headerText={uiText("purchaseOrders.view.extraction.evidence")}><ul>{preview.evidence.map((e, i) => <li key={i}>{e.text}</li>)}</ul></ExpandableSection>
            {!selected ? <Button disabled={!!preview.existing_order_id || busy} onClick={() => {
              const next = importDocument(preview);
              next.delivery_address = project?.address || '';
              setDoc(next);
            }}>{uiText("purchaseOrders.fill.order")}</Button> : <>
              <Box>{uiText("purchaseOrders.select.only.the.order.information.to.update.items.deliveries")}</Box>
              {(['ordered_on', 'tax', 'shipping', 'discount', 'total'] as const).filter(k => preview.draft[k] != null).map(k => <Checkbox key={k} checked={appliedFields.includes(k)} onChange={({ detail }) => setAppliedFields(detail.checked ? [...appliedFields, k] : appliedFields.filter(f => f !== k))}>
                {systemText(({ ordered_on: '下单日期', tax: '税费', shipping: '运费', discount: '折扣', total: '订单总额' })[k])}：{String(doc[k] ?? uiText("procurementItemRow.not.entered.2"))} → {String(preview.draft[k])}
              </Checkbox>)}
              <Button disabled={busy || !appliedFields.length || (!!preview.draft.order_number && preview.draft.order_number !== doc.order_number)} onClick={() => { setDoc({ ...doc, ...Object.fromEntries(appliedFields.map(k => [k, preview.draft[k as keyof typeof preview.draft]])) }); setAppliedFields([]); }}>{uiText("purchaseOrders.apply.selected.changes")}</Button>
            </>}
          </>}
        </SpaceBetween>
      </ExpandableSection>
      {selected && <ExpandableSection headerText={uiText("purchaseOrders.add.action.notes")}><FormField label={uiText("purchaseOrders.follow.up.record.retained.in.history")}><Textarea value={eventNote} disabled={busy || !!receiving || !!adjustment || !!voidId} onChange={({ detail }) => setEventNote(detail.value)} placeholder={uiText("purchaseOrders.for.example.contacted.the.merchant.the.remaining.two.items")} /></FormField></ExpandableSection>}
      </div>
      {canWrite && (detailsOpen || !selected || dirty) && <div className="ui-order-actions proc-savebar"><SpaceBetween direction="horizontal" size="s">
        <Button variant="primary" loading={busy} disabled={!!selected && !dirty || busy || customizing || !!receiving || !!adjustment || !!voidId} onClick={save}>{uiText("purchaseOrders.save.order")}</Button>
        <Button disabled={busy} onClick={() => { if (selected) adopt(selected); else { reset(); setCustomizing(false); navigate(returnTo); } }}>{selected ? uiText("purchaseOrders.cancel.changes") : uiText("purchaseOrders.cancel.creation")}</Button>
        {selected && <Button disabled={!canWrite || busy || dirty || !!receiving || !!adjustment || !!voidId} onClick={() => void open(selected.id)}>{uiText("procurementItemPage.reload")}</Button>}
      </SpaceBetween></div>}

  </SpaceBetween></div>;
}
