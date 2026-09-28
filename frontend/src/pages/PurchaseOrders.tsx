import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams, useParams } from 'react-router-dom';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import Textarea from '@cloudscape-design/components/textarea';
import { api, type ProcurementItem, type ProcurementWorkspaceData } from '../api/client';
import Header from '../components/ui/Header';
import FormField from '../components/ui/FormField';
import { ExpandableSection, Table } from '../components/ui/Surface';
import PurchaseOrderEntry from '../components/PurchaseOrderEntry';
import PurchaseOrderFields, { Choice, TextField } from '../components/PurchaseOrderFields';
import { type PurchaseOrder, type OrderDocument, type ImportPreview, type Receipt, type Adjustment,
  newOrder, newLine, importDocument, moneyValue, todayLA } from '../lib/purchaseOrders';
import { useFlash } from '../lib/flash';
import { useMeta } from '../lib/meta';
import { orderFormErrors, receiptFormErrors, procurementReturnTo, procurementSaveError } from '../lib/procurementForm';
import { orderStages } from '../lib/orderStages';

export default function PurchaseOrders() {
  const [params] = useSearchParams();
  const route = useParams();
  const navigate = useNavigate(); const flash = useFlash(); const meta = useMeta();
  const initialMaterial = Number(params.get('material')) || 0;
  const initialOrder = Number(params.get('order')) || 0;
  const [workspace, setWorkspace] = useState<ProcurementWorkspaceData | null>(null);
  const [projectId, setProjectId] = useState(route.projectId ?? params.get('project') ?? '');
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
  const receiptErrors = receiptAttempted && receiving ? receiptFormErrors(receiving) : {};
  const [voidId, setVoidId] = useState(''); const [voidReason, setVoidReason] = useState('');
  const pendingRequest = useRef({ payload: '', key: '' });
  const loadedInitial = useRef(false);
  const dirty = editing && (JSON.stringify(doc) !== original || !!source || !!eventNote || customizing);
  const project = workspace?.projects.find(p => p.id === Number(projectId));
  const materials = workspace?.items.filter(i => i.project_id === Number(projectId)) ?? [];
  const today = todayLA();
  useEffect(() => {
    if (!error) return;
    requestAnimationFrame(() => {
      const invalid = surface.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
      const target = invalid || surface.current?.querySelector<HTMLElement>('[data-form-error]');
      target?.scrollIntoView({block: 'center'}); target?.focus();
    });
  }, [error]);
  useEffect(() => { if (receiving) requestAnimationFrame(() => { const input = surface.current?.querySelector<HTMLElement>('.proc-receipt-form input'); input?.focus(); input?.scrollIntoView({block:'center'}); }); }, [!!receiving]);
  useEffect(() => { if (detailsOpen) requestAnimationFrame(() => { const form = surface.current?.querySelector<HTMLElement>('.proc-order-edit input'); form?.focus(); form?.scrollIntoView({block:'center'}); }); }, [detailsOpen]);
  const requestKey = (payload: unknown) => {
    const encoded = JSON.stringify(payload);
    if (encoded !== pendingRequest.current.payload) pendingRequest.current = { payload: encoded, key: crypto.randomUUID() };
    return pendingRequest.current.key;
  };
  const load = useCallback(async () => {
    setWorkspace(await api.procurementTracking());
  }, []);
  useEffect(() => { load().catch(e => setError(e.message)); }, [load]);
  useEffect(() => {
    if (!dirty && !receiving && !adjustment) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', prevent); return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty, receiving, adjustment]);
  const adopt = (order: PurchaseOrder) => {
    setSelected(order); setProjectId(String(order.project_id)); setDoc(order.document); setOriginal(JSON.stringify(order.document));
    setEditing(true); setDetailsOpen(false); setAttempted(false); setReceiptAttempted(false); setSource(''); setPreview(null); setEventNote(''); setReceiving(null); setAdjustment(null); setVoidId(''); setError('');
  };
  const open = async (id: number, keepSource = false) => {
    if (dirty && !keepSource) { setError('请先保存或放弃当前草稿，再打开其他订单。'); return; }
    setBusy(true); setError('');
    try { const order = await api.purchaseOrder(id); const text = source; adopt(order); if (keepSource) setSource(text); navigate(`/procurement/orders?project=${order.project_id}&order=${order.id}${routeSuffix}`, { replace: true }); }
    catch (e) { setError(procurementSaveError(e)); } finally { setBusy(false); }
  };
  useEffect(() => {
    if (!workspace || loadedInitial.current) return;
    loadedInitial.current = true;
    if (initialOrder) void open(initialOrder);
    else if (route.projectId || params.get('new') === '1') start();
  }, [workspace]); // Initial route only; later navigation is explicit.
  const reset = () => { setEditing(false); setSelected(null); setSource(''); setPreview(null); setEventNote(''); setReceiving(null); setAdjustment(null); setVoidId(''); setError(''); };
  const start = (targetProjectId = Number(projectId), targetNode = entryNode, targetMaterialId = initialMaterial) => {
    const targetProject = workspace?.projects.find(p => p.id === targetProjectId);
    if (!targetProject) { setError('先选择这笔订单所属房屋。每个订单只能归属一套房。'); return; }
    const next = newOrder(); next.ordered_on = today;
    const material = workspace?.items.find(m => m.project_id === targetProject.id && m.id === targetMaterialId && (!targetNode || m.wave === targetNode));
    setProjectId(String(targetProject.id)); setEntryNode(material?.wave || targetNode);
    if (material) next.lines = [{ ...newLine(material.id), name: material.name, quantity: '1', unit: material.unit || '件',
      needed_on: material.needed_on || null, specification: material.specification || '', location: material.use_location || '' }];
    else next.lines = [{ ...newLine(), quantity: '1' }];
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
    if (!project || !workspace) throw new Error('请先选择房屋');
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
      flash({ type: 'success', content: '订单已保存，关联采购项可查看商品与收货进展。' });
    } catch (e) { setError(procurementSaveError(e)); } finally { setBusy(false); }
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
      flash({ type: 'success', content: '本次实际收货已记录。' });
    } catch (e) { setError(procurementSaveError(e)); } finally { setBusy(false); }
  };
  const voidReceipt = async () => {
    if (!selected || !voidId || !voidReason.trim()) return;
    setBusy(true); setError(''); const payload = { expected_version: selected.version, reason: voidReason };
    try { adopt(await api.voidPurchaseReceipt(selected.id, voidId, { ...payload, request_key: requestKey({ id: selected.id, voidId, ...payload }) })); await load(); setVoidReason(''); }
    catch (e) { setError(procurementSaveError(e)); } finally { setBusy(false); }
  };
  if (!initialOrder && !route.projectId && params.get('new') !== '1') {
    const target = new URLSearchParams({view: 'orders'});
    if (projectId) target.set('project', projectId);
    return <Navigate replace to={`/procurement?${target}`} />;
  }
  if (workspace && !editing) return error
    ? <Alert type="error" action={<Button onClick={() => navigate(projectId ? `/procurement?project=${projectId}` : '/procurement')}>返回采购工作台</Button>}>{error}</Alert>
    : <Spinner />;
  if (!workspace) return error ? <Alert type="error" action={<Button onClick={() => { setError(''); void load().catch(e => setError(e.message)); }}>重试</Button>}>{error}</Alert> : <Spinner />;
  const purposes = orderStages(doc.lines, Number(projectId), workspace.items, nodes).filter(stage => stage.value !== 'unmapped');
  const purposeTitle = purposes.length ? purposes.map(s => s.label).join(' / ') : nodes.find(n => n.value === entryNode)?.label;
  return <div className="procurement-surface procurement-order" ref={surface}><SpaceBetween size="l">
    <Header variant="h1" description={`${project?.name ?? ''}${purposeTitle ? ' · ' + purposeTitle : ''}`}
      actions={<SpaceBetween direction="horizontal" size="s">
        <Button disabled={busy} onClick={() => { if (dirty || receiving || adjustment) setError('请先保存或放弃当前内容。'); else navigate(returnTo); }}>返回本房采购</Button>

      </SpaceBetween>}>{selected ? `${selected.document.vendor} · ${selected.document.order_number}` : '创建订单'}</Header>
    {error && <div data-form-error tabIndex={-1}><Alert type="error" dismissible onDismiss={() => setError('')}>{error}</Alert></div>}
    {selected && <div className="proc-order-facts"><span>下单 <strong>{selected.document.ordered_on || '未填'}</strong></span><span>实付 <strong>{moneyValue(selected.document.total)}</strong></span><span>收货地址 <strong>{selected.document.delivery_address || '未填'}</strong></span><Button disabled={busy || !!receiving || !!adjustment || !!voidId} onClick={() => { if (dirty) setError('先保存或取消订单修改。'); else setDetailsOpen(!detailsOpen); }}>{detailsOpen ? '收起订单修改' : '修改订单'}</Button></div>}
      {selected && <>
        {!!selected.summary.missing.length && <ExpandableSection headerText="查看待补资料"><Box>{selected.summary.missing.join('；')}</Box></ExpandableSection>}
        <section className="proc-receiving"><Header variant="h2">收货与缺口</Header>
          <div className="proc-receipt-list">{selected.summary.lines.map(l => {
            const item = selected.document.lines.find(line => line.id === l.id);
            const unit = item?.unit || '';
            const differences = [item?.brand && `品牌 ${item.brand}`, item?.vendor && `卖家 ${item.vendor}`, item?.expected_on && `预计 ${item.expected_on}`, item?.delivery_address && item.delivery_address !== selected.document.delivery_address && `本项送至 ${item.delivery_address}`].filter(Boolean).join(' · ');
            return <div className="proc-receipt-row" key={l.id}><div><strong>{l.name}</strong>{differences && <p className="proc-line-differences">{differences}</p>}{item?.issue_note && <p className="proc-item-issue">需处理：{item.issue_note}</p>}{item?.website_status && item.website_status !== 'unknown' && <p className="proc-line-differences">网站物流：{({not_shipped: '未发货', in_transit: '运输中', ready_pickup: '可取货', delivered: '显示送达', exception: '异常'})[item.website_status]}（不代表实收）</p>}</div><dl><div><dt>订购</dt><dd>{l.quantity ?? '未填'} {unit}</dd></div><div><dt>完好实收</dt><dd>{l.usable} {unit}</dd></div><div><dt>仍需补齐</dt><dd className={l.remaining == null || Number(l.remaining) > 0 ? 'proc-shortage' : ''}>{l.remaining ?? '待核对'} {unit}</dd></div></dl>{Number(l.damaged) > 0 && <span>累计实收 {l.received}，其中破损 {l.damaged} {unit}</span>}</div>;
          })}</div>
          <Box color="text-body-secondary">采购确认实际收货后，相关采购项自动更新。分次到货只填本次实收。</Box>
          <SpaceBetween direction="horizontal" size="s"><Button variant="primary" disabled={busy || dirty || !!receiving || !!adjustment || !!voidId || !selected.summary.lines.some(l => l.remaining == null || Number(l.remaining) > 0)} onClick={() => { setError(''); setReceiptAttempted(false); setReceiving({
            id: crypto.randomUUID(), delivery_id: null, received_on: today, location: doc.delivery_address || project?.address || '',
            lines: selected.summary.lines.filter(l => l.remaining == null || Number(l.remaining) > 0).map(l => ({ line_id: l.id, quantity: '0', damaged_quantity: '0' })),
            note: '', confirmed_by: 0, confirmed_name: '', recorded_at: '', void_reason: '',
          }); }}>登记到货</Button></SpaceBetween>
          <ExpandableSection headerText="退货 / 退款（发生时填写）"><SpaceBetween size="s">
            <TextField label="累计已退款（USD）" numeric value={doc.refunded ?? selected.summary.refund} disabled={busy || !!receiving || !!adjustment} onChange={v => setDoc({ ...doc, refunded: v || null })} />
            <Button disabled={busy || dirty || !!receiving || !!adjustment || !!voidId} onClick={() => setAdjustment({ id: crypto.randomUUID(), line_id: doc.lines[0].id,
              returned_quantity: '0', returned_usable_quantity: '0', refund: null, occurred_on: today, reason: '' })}>登记已退回商品</Button>
          </SpaceBetween></ExpandableSection>
          {dirty && <Box color="text-status-warning">请先保存订单修改，再登记收货或退货。</Box>}
          {receiving && <div className="proc-receipt-form"><SpaceBetween size="m"><Header variant="h3">本次收货</Header><div className="ui-order-grid">
            <TextField disabled={busy} error={receiptErrors.date} label="实际收货日期" date value={receiving.received_on} onChange={v => setReceiving({ ...receiving, received_on: v })} />
            <TextField disabled={busy} error={receiptErrors.location} label="实际收货地点" value={receiving.location} onChange={v => setReceiving({ ...receiving, location: v })} />
            {receiving.lines.map(line => <div className="proc-receipt-input" key={line.line_id}><strong>{doc.lines.find(l => l.id === line.line_id)?.name}</strong><p>此前完好实收 {selected.summary.lines.find(l => l.id === line.line_id)?.usable} · 仍需 {selected.summary.lines.find(l => l.id === line.line_id)?.remaining ?? '核对'} {doc.lines.find(l => l.id === line.line_id)?.unit}</p>
              <TextField disabled={busy} error={receiptErrors[`${line.line_id}.quantity`]} label={`${doc.lines.find(l => l.id === line.line_id)?.name} 本次实收数量`} numeric value={line.quantity} onChange={v => setReceiving({ ...receiving, lines: receiving.lines.map(l => l.line_id === line.line_id ? { ...l, quantity: v } : l) })} />
              <TextField disabled={busy} error={receiptErrors[`${line.line_id}.damaged`]} label={`${doc.lines.find(l => l.id === line.line_id)?.name} 其中破损数量`} numeric value={line.damaged_quantity} onChange={v => setReceiving({ ...receiving, lines: receiving.lines.map(l => l.line_id === line.line_id ? { ...l, damaged_quantity: v || '0' } : l) })} />
            </div>)}
          </div>{receiptErrors.lines && <Alert type="error">{receiptErrors.lines}</Alert>}<TextField disabled={busy} label="收货说明 / 缺件破损情况" value={receiving.note} onChange={v => setReceiving({ ...receiving, note: v })} />
            <SpaceBetween direction="horizontal" size="s"><Button variant="primary" loading={busy} onClick={receive}>确认本次实际收货</Button><Button disabled={busy} onClick={() => { setReceiving(null); setReceiptAttempted(false); setError(''); }}>取消登记</Button></SpaceBetween>
          </SpaceBetween></div>}
          {adjustment && <SpaceBetween size="m"><Header variant="h3">实际退货 / 退款记录</Header>
            <Choice label="退货退款对应商品" value={adjustment.line_id} options={doc.lines.map(l => ({ value: l.id, label: l.name }))} onChange={v => setAdjustment({ ...adjustment, line_id: v })} />
            <div className="ui-order-grid">
              <TextField label="实际退货数量" numeric value={adjustment.returned_quantity} onChange={v => setAdjustment({ ...adjustment, returned_quantity: v || '0' })} />
              <TextField label="其中原本完好的数量" numeric value={adjustment.returned_usable_quantity} onChange={v => setAdjustment({ ...adjustment, returned_usable_quantity: v || '0' })} />
              <TextField label="实际发生日期" date value={adjustment.occurred_on} onChange={v => setAdjustment({ ...adjustment, occurred_on: v })} />
            </div><TextField label="退货退款原因 / 凭据说明" value={adjustment.reason} onChange={v => setAdjustment({ ...adjustment, reason: v })} />
            <SpaceBetween direction="horizontal" size="s"><Button disabled={!adjustment.reason.trim()} onClick={() => { setDoc({ ...doc, adjustments: [...doc.adjustments, adjustment] }); setAdjustment(null); }}>加入草稿，随后保存订单</Button><Button onClick={() => setAdjustment(null)}>取消登记</Button></SpaceBetween>
          </SpaceBetween>}
          <ExpandableSection headerText={`收货记录 · ${doc.receipts.length} 次`}>{doc.receipts.map(r => <div className="ui-order-line" key={r.id}><Box>{r.received_on} · {r.location || '地点未填'} · {r.confirmed_name} · {r.lines.map(l => `${doc.lines.find(item => item.id === l.line_id)?.name}：${l.quantity}，破损 ${l.damaged_quantity}`).join('；')}</Box><Box>{r.note}</Box>
            {r.void_reason ? <Box color="text-status-warning">已撤销：{r.void_reason}</Box> : <Button variant="inline-link" disabled={busy || dirty || !!receiving || !!adjustment || !!voidId} onClick={() => { setVoidId(r.id); setVoidReason(''); }}>更正错误收货登记</Button>}
          </div>)}
          </ExpandableSection>
          {voidId && <SpaceBetween size="s"><TextField label="撤销原因（保留原记录，可重新登记）" value={voidReason} onChange={setVoidReason} /><SpaceBetween direction="horizontal" size="s"><Button disabled={busy || !voidReason.trim()} onClick={voidReceipt}>撤销本次收货登记</Button><Button onClick={() => setVoidId('')}>取消更正</Button></SpaceBetween></SpaceBetween>}
          {doc.adjustments.map(a => <Box key={a.id}>{a.occurred_on} · {doc.lines.find(l => l.id === a.line_id)?.name} · 退货 {a.returned_quantity} · 退款 {moneyValue(a.refund)} · {a.reason}</Box>)}
        </section>
        <ExpandableSection headerText={`操作与原文历史 · ${selected.events?.length ?? 0} 条`}>
          <SpaceBetween size="m">{selected.events?.map(e => <ExpandableSection key={e.version} headerText={`${e.kind} · ${e.actor} · ${e.created_at.replace('T', ' ')}`}>
            <Box>{e.note || '无补充说明'}</Box>{e.source_text && <pre className="ui-order-source">{e.source_text}</pre>}
            <Box>当时订单总额 {moneyValue(e.document.total)} · 商品 {e.document.lines.length} 项 · 跟进：{e.document.follow_up || '无'}</Box>
            <Box>{e.document.note}</Box>
          </ExpandableSection>)}</SpaceBetween>
        </ExpandableSection>
        <SpaceBetween direction="horizontal" size="s">{doc.order_url && <Link href={doc.order_url} external>打开商家订单</Link>}{doc.voucher_url && <Link href={doc.voucher_url} external>查看购买凭据</Link>}
          {doc.deliveries.filter(d => d.tracking_url).map(d => <Link key={d.id} href={d.tracking_url!} external>{d.label} 物流</Link>)}
        </SpaceBetween>
      </>}
      <div className="proc-order-edit" hidden={!!selected && !detailsOpen}>
      {selected ? <PurchaseOrderFields errors={fieldErrors} key={selected.id} nodes={nodes} defaultNode={entryNode} doc={doc} onChange={setDoc} materials={materials} busy={busy || !!receiving || !!adjustment || !!voidId} /> : <PurchaseOrderEntry errors={fieldErrors} key={`new-${projectId}`} nodes={nodes} defaultNode={entryNode} onStageChange={setEntryNode} onAddMaterial={addMaterial} onCustomizing={setCustomizing} doc={doc} onChange={setDoc} materials={materials} busy={busy} />}
      <ExpandableSection headerText={selected ? '粘贴后续订单邮件 / 保留跟进原文' : '粘贴订单导入'} defaultExpanded={false}>
        <SpaceBetween size="m">
          <FormField label="订单原文">
            <Textarea value={source} rows={4} disabled={busy || !!receiving || !!adjustment || !!voidId} onChange={({ detail }) => { setSource(detail.value); setPreview(null); }} placeholder="从订单页面或确认邮件复制商品、数量、金额等内容…" />
          </FormField>
          <Button disabled={busy || !!receiving || !!adjustment || !!voidId || !source.trim()} loading={busy} onClick={runPreview}>识别订单</Button>
          {preview && <>
            <Alert type="info">{preview.warnings.join(' ')}</Alert>
            {preview.existing_order_id && preview.existing_order_id !== selected?.id && <Alert type="warning" action={<Button onClick={() => void open(preview.existing_order_id!, true)}>打开已有订单并保留原文</Button>}>这个订单已登记，请核对已有记录。</Alert>}
            <Box>识别商家：{preview.draft.vendor || '未识别'} · 订单号：{preview.draft.order_number || '未识别'} · 商品候选 {preview.draft.lines.length} 条</Box>
            <Table variant="embedded" items={preview.draft.lines} columnDefinitions={[{ id: 'name', header: '识别商品（待核对）', cell: l => l.name }, { id: 'qty', header: '数量', cell: l => l.quantity ?? '未识别' }, { id: 'price', header: '单价', cell: l => moneyValue(l.unit_price ?? null) }]} />
            <ExpandableSection headerText="查看提取依据"><ul>{preview.evidence.map((e, i) => <li key={i}>{e.text}</li>)}</ul></ExpandableSection>
            {!selected ? <Button disabled={!!preview.existing_order_id || busy} onClick={() => {
              const next = importDocument(preview);
              next.delivery_address = project?.address || '';
              setDoc(next);
            }}>填入订单</Button> : <>
              <Box>仅勾选需要更新的订单信息；商品、配送和实际收货保留。原文随本次保存进入历史。</Box>
              {(['ordered_on', 'tax', 'shipping', 'discount', 'total'] as const).filter(k => preview.draft[k] != null).map(k => <Checkbox key={k} checked={appliedFields.includes(k)} onChange={({ detail }) => setAppliedFields(detail.checked ? [...appliedFields, k] : appliedFields.filter(f => f !== k))}>
                {({ ordered_on: '下单日期', tax: '税费', shipping: '运费', discount: '折扣', total: '订单总额' })[k]}：{String(doc[k] ?? '未填')} → {String(preview.draft[k])}
              </Checkbox>)}
              <Button disabled={busy || !appliedFields.length || (!!preview.draft.order_number && preview.draft.order_number !== doc.order_number)} onClick={() => { setDoc({ ...doc, ...Object.fromEntries(appliedFields.map(k => [k, preview.draft[k as keyof typeof preview.draft]])) }); setAppliedFields([]); }}>采用勾选变更</Button>
            </>}
          </>}
        </SpaceBetween>
      </ExpandableSection>
      {selected && <ExpandableSection headerText="补充本次操作说明"><FormField label="本次跟进记录（保留到历史）"><Textarea value={eventNote} disabled={busy || !!receiving || !!adjustment || !!voidId} onChange={({ detail }) => setEventNote(detail.value)} placeholder="例如已联系商家，剩余两件预计周四到货…" /></FormField></ExpandableSection>}
      </div>
      {(detailsOpen || !selected || dirty) && <div className="ui-order-actions proc-savebar"><SpaceBetween direction="horizontal" size="s">
        <Button variant="primary" loading={busy} disabled={!!selected && !dirty || busy || customizing || !!receiving || !!adjustment || !!voidId} onClick={save}>保存订单</Button>
        <Button disabled={busy} onClick={() => { if (selected) adopt(selected); else { reset(); setCustomizing(false); navigate(returnTo); } }}>取消修改</Button>
        {selected && <Button disabled={busy || dirty || !!receiving || !!adjustment || !!voidId} onClick={() => void open(selected.id)}>重新载入</Button>}
      </SpaceBetween></div>}

  </SpaceBetween></div>;
}
