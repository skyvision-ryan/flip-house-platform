import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import { useParams, Navigate } from 'react-router-dom';
import { procurementSaveError } from '../lib/procurementForm';
import { moneyValue } from '../lib/purchaseOrders';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ProcurementWorkspaceData, type ProcurementImage } from '../api/client';
import ProcurementFields from '../components/ProcurementFields';
import FormField from '../components/ui/FormField';
import Header from '../components/ui/Header';
import { ExpandableSection } from '../components/ui/Surface';
import { useFlash } from '../lib/flash';
import { useMeta } from '../lib/meta';
import { procurementChanges, procurementDraft, procurementError, type ProcurementDraft } from '../lib/procurement';

export function ProcurementItemEditor({ materialId, houseId, onClose, onSaved, onDirty }: { materialId: number; houseId: number; onClose: () => void; onSaved: () => Promise<void>; onDirty: (dirty: boolean) => void }) {
  const selectedId = materialId;
  const meta = useMeta();
  const flash = useFlash();
  const [data, setData] = useState<ProcurementWorkspaceData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState<ProcurementDraft>(procurementDraft());
  const [original, setOriginal] = useState<ProcurementDraft>(procurementDraft());
  const focusedItem = useRef<number | undefined>();
  const editorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (data) editorRef.current?.querySelector<HTMLInputElement>('input')?.focus({preventScroll: true});
  }, [!!data]);
  const [revision, setRevision] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [image, setImage] = useState<ProcurementImage | null>(null);
  const [removeImage, setRemoveImage] = useState<ProcurementImage | null>(null);
  const selected = data?.items.find(row => row.id === selectedId);
  const project = data?.projects.find(p => p.id === houseId);
  const dirty = JSON.stringify(draft) !== JSON.stringify(original);
  const statusOptions = meta?.procurement_statuses ?? [];
  const waveOptions = meta?.procurement_waves ?? [];
  const label = (value: string) => statusOptions.find(s => s.value === value)?.label ?? value;
  const load = useCallback(async () => {
    try { const next = await api.procurementTracking(); setData(next); setLoadError(''); }
    catch (e) { setLoadError((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!data || !materialId || focusedItem.current === materialId) return;
    const row = data.items.find(item => item.id === materialId);
    focusedItem.current = materialId;
    if (row) { const d = procurementDraft(row); setDraft(d); setOriginal(d); setRevision(row.updated_at); }
  }, [data, materialId]);
  const close = () => {
    if (busy) return;
    if (dirty) { setError('请先保存或放弃当前修改。'); return; }
    onClose();
  };
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  const save = async () => {
    if (!project) { setError('请选择有采购权限的房屋'); return; }
    const invalid = procurementError(draft);
    if (invalid) { setError(invalid); return; }
    setBusy(true); setError('');
    try {
      const changes = procurementChanges(draft, original);
      const next = await api.patchProcurement(selectedId, { ...changes, expected_updated_at: revision });
      const saved = next.items.find(row => row.id === selectedId)!;
      await load(); setDraft(procurementDraft(saved)); setOriginal(procurementDraft(saved)); setRevision(saved.updated_at);
      await onSaved();
      flash({ type: 'success', content: `「${saved.name}」已保存` });
    } catch (e) { setError(procurementSaveError(e)); }
    finally { setBusy(false); }
  };
  const discard = async () => {
    setBusy(true);
    try {
      const next = await api.procurementTracking(); setData(next);
      const current = next.items.find(row => row.id === selectedId);
      if (current) { const clean = procurementDraft(current); setDraft(clean); setOriginal(clean); setRevision(current.updated_at); }
      setError('');
    } catch (e) { setError(procurementSaveError(e)); }
    finally { setBusy(false); }
  };
  const upload = async (file: File) => {
    setBusy(true); setError('');
    try { await api.uploadProcurementImage(Number(selectedId), file); await load(); flash({ type: 'success', content: '材料图片已上传' }); }
    catch (e) { setError(procurementSaveError(e)); }
    finally { setBusy(false); }
  };
  if (loadError) return <Alert type="error" header="采购清单暂时无法加载" action={<Button onClick={load}>重试</Button>}>{loadError}</Alert>;
  if (!data) return <Box padding="l"><Spinner /> 正在加载采购项…</Box>;
  if (materialId && (!selected || selected.project_id !== houseId)) return <Alert type="error">采购项不存在或无权访问。<Button onClick={close}>返回采购清单</Button></Alert>;
  const editor = selectedId !== null ? <SpaceBetween size="m">
    <Header variant="h3" actions={<Button disabled={busy} onClick={close}>收起</Button>}>修改需求</Header>
    <Box color="text-body-secondary">{project?.name ?? '请选择房屋'} · {`${waveOptions.find(w => w.value === selected?.wave)?.label || ''} · ${label(selected?.status || '')}`}</Box>
    {error && <Alert type="error">{error}</Alert>}
    <div className="proc-requirement-fields" ref={editorRef}>
      <SpaceBetween size="m">
    <div className="proc-requirement-basics"><FormField label="材料名称"><Input disabled={busy} value={draft.name} onChange={({ detail }) => setDraft({ ...draft, name: detail.value })} /></FormField>
    <FormField label="采购分组"><Select disabled={busy} selectedOption={waveOptions.find(w => w.value === draft.wave) ?? null} options={waveOptions} onChange={({ detail }) => setDraft({ ...draft, wave: detail.selectedOption.value! })} /></FormField>
    <FormField label="采购状态"><Select disabled={busy || !!selected?.order_managed} options={statusOptions.filter(s => ['pending_spec', 'pending_order', 'exception', 'na'].includes(s.value))} selectedOption={statusOptions.find(s => s.value === draft.status) ?? null} onChange={({ detail }) => setDraft({ ...draft, status: detail.selectedOption.value! })} /></FormField>
    </div><ProcurementFields draft={draft} onChange={setDraft} disabled={busy} />
    <SpaceBetween direction="horizontal" size="s">
      <Button variant="primary" loading={busy} disabled={!dirty} onClick={() => save()}>保存采购项</Button>
      <Button disabled={busy} onClick={discard}>{dirty ? '放弃修改' : '重新载入'}</Button>
    </SpaceBetween>
      </SpaceBetween>
    </div>
    {selected && <>
      {Object.entries(selected.legacy_purchase || selected).some(([key, value]) => (['ordered_on', 'expected_on', 'received_on', 'retailer', 'order_number', 'order_url', 'amount', 'quantity', 'delivery_type', 'delivery_address', 'carrier', 'tracking_number', 'tracking_url', 'shipment_status', 'follow_up', 'checked_at'].includes(key) && value != null && value !== '') || (key === 'status' && ['ordered', 'received'].includes(String(value)))) && <ExpandableSection headerText="旧采购记录（只读）"><SpaceBetween size="s">
        <Box>状态：{label((selected.legacy_purchase || selected).status ?? '')} · 金额：{moneyValue((selected.legacy_purchase || selected).amount ?? null)}</Box>
        <Box>下单：{(selected.legacy_purchase || selected).ordered_on || '未填'} · 预计：{(selected.legacy_purchase || selected).expected_on || '未填'} · 实际到货：{(selected.legacy_purchase || selected).received_on || '未填'}</Box>
        <Box>商家：{(selected.legacy_purchase || selected).retailer || '未填'} · 订单号：{(selected.legacy_purchase || selected).order_number || '未填'}</Box>
        <Box>地点：{(selected.legacy_purchase || selected).delivery_address || '未填'} · 规格：{(selected.legacy_purchase || selected).specification || '未填'}</Box>
        <Box>数量：{(selected.legacy_purchase || selected).quantity ?? '未填'} · 配送方式：{(selected.legacy_purchase || selected).delivery_type || '未填'}</Box>
        <Box>物流：{(selected.legacy_purchase || selected).carrier || '未填'} · {(selected.legacy_purchase || selected).tracking_number || '无运单号'} · 网站状态：{(selected.legacy_purchase || selected).shipment_status || '未核对'}</Box>
        <Box>订单链接：{(selected.legacy_purchase || selected).order_url || '未填'}</Box>
        <Box>物流链接：{(selected.legacy_purchase || selected).tracking_url || '未填'}</Box>
        <Box>商品链接：{(selected.legacy_purchase || selected).product_url || '未填'}</Box>
        <Box>最近人工核对：{(selected.legacy_purchase || selected).checked_at || '未记录'}</Box>
        <Box>{(selected.legacy_purchase || selected).follow_up}</Box>
      </SpaceBetween></ExpandableSection>}
      <Box color="text-body-secondary">材料资料最近编辑：{selected.updated_by ?? '未记录'} · {selected.updated_at.replace('T', ' ').slice(0, 16)}</Box>
      <section className="ui-proc-images"><Header variant="h3" description="点击图片查看完整尺寸。JPG / PNG / WebP，每张不超过 8 MB，最多 12 张。">材料图片</Header>
        {selected.images.length === 0 && <Box color="text-body-secondary">尚未上传材料图片。</Box>}
        <div className="ui-proc-image-grid">{selected.images.map(img => <div key={img.id}>
          <button type="button" className="ui-proc-image-button" onClick={() => setImage(img)} aria-label={`查看完整图片：${img.filename}`}><img src={`/api/procurement-images/${img.id}`} alt={img.filename} loading="lazy" /></button>
          <Button variant="inline-link" disabled={busy} onClick={() => setRemoveImage(img)}>移除 {img.filename}</Button>
        </div>)}</div>
        <label className="ui-proc-upload">添加材料图片<input type="file" aria-label="添加材料图片" accept="image/jpeg,image/png,image/webp" disabled={busy || selected.images.length >= 12} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void upload(file); }} /></label>
      </section>
    </>}
  </SpaceBetween> : null;
  return <div className="ui-proc-item-page"><SpaceBetween size="m">
    {editor}
    <Modal visible={!!image} size="max" header={image?.filename ?? '材料图片'} onDismiss={() => setImage(null)}>
      {image && <SpaceBetween size="s"><a href={`/api/procurement-images/${image.id}`} target="_blank" rel="noreferrer">在新窗口查看原图</a><img className="ui-proc-full-image" src={`/api/procurement-images/${image.id}`} alt={image.filename} /></SpaceBetween>}
    </Modal>
    <Modal visible={!!removeImage} header="移除材料图片" onDismiss={() => setRemoveImage(null)} footer={<SpaceBetween direction="horizontal" size="s"><Button onClick={() => setRemoveImage(null)}>取消</Button><Button loading={busy} onClick={async () => { if (!removeImage) return; setBusy(true); try { await api.deleteProcurementImage(removeImage.id); setRemoveImage(null); await load(); } catch (e) { setError(procurementSaveError(e)); } finally { setBusy(false); } }}>确认移除</Button></SpaceBetween>}>
      移除「{removeImage?.filename}」后，需要重新上传才能恢复。
    </Modal>
  </SpaceBetween></div>;
}

export default function ProcurementItemPage() {
  const { itemId, projectId } = useParams();
  return <Navigate replace to={`/procurement?project=${projectId || ''}${itemId && itemId !== 'new' ? `&item=${itemId}&edit=1` : '&new=1'}`} />;
}
