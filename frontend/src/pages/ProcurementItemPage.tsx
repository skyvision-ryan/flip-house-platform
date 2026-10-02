import { materialName } from '../i18n/templateNames.ts';
import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import { useParams, useSearchParams, Navigate } from 'react-router-dom';
import { procurementSaveError } from '../lib/procurementForm';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ProcurementWorkspaceData, type ProcurementImage } from '../api/client';
import ImageViewer from '../components/ui/ImageViewer';
import ProcurementFields from '../components/ProcurementFields';
import DeleteRequirementButton from '../components/DeleteRequirementButton';
import FormField from '../components/ui/FormField';
import Header from '../components/ui/Header';
import { useFlash } from '../lib/flash';
import { useMeta } from '../lib/meta';
import { procurementChanges, procurementDraft, procurementError, type ProcurementDraft } from '../lib/procurement';

export function ProcurementItemEditor({ materialId, houseId, onClose, onSaved, onDirty, onDeleted }: { materialId: number; houseId: number; onClose: () => void; onSaved: () => Promise<void>; onDirty: (dirty: boolean) => void; onDeleted?: () => void | Promise<void> }) {
  useLanguage();
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
    if (dirty) { setError(uiText("procurementItemPage.save.or.discard.your.current.changes.first")); return; }
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
    if (!project) { setError(uiText("procurementItemPage.select.a.property.you.can.manage.procurement.for")); return; }
    const invalid = procurementError(draft);
    if (invalid) { setError(invalid); return; }
    setBusy(true); setError('');
    try {
      const changes = procurementChanges(draft, original);
      const next = await api.patchProcurement(selectedId, { ...changes, expected_updated_at: revision });
      const saved = next.items.find(row => row.id === selectedId)!;
      await load(); setDraft(procurementDraft(saved)); setOriginal(procurementDraft(saved)); setRevision(saved.updated_at);
      await onSaved();
      flash({ type: 'success', content: uiText("sentences.saved", { value1: (materialName(saved)) }) });
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
    try { await api.uploadProcurementImage(Number(selectedId), file); await load(); flash({ type: 'success', content: uiText("procurementItemPage.material.image.uploaded") }); }
    catch (e) { setError(procurementSaveError(e)); }
    finally { setBusy(false); }
  };
  if (loadError) return <Alert type="error" header={uiText("procurementItemPage.procurement.list.could.not.be.loaded")} action={<Button onClick={load}>{uiText("addProject.retry")}</Button>}>{systemText(loadError)}</Alert>;
  if (!data) return <Box padding="l"><Spinner /> {uiText("procurementItemPage.loading.procurement.item")}</Box>;
  if (materialId && (!selected || selected.project_id !== houseId)) return <Alert type="error">{uiText("procurementItemPage.item.does.not.exist.or.access.is.denied")}<Button onClick={close}>{uiText("procurementItemPage.back.to.procurement.list")}</Button></Alert>;
  const editor = selectedId !== null ? <SpaceBetween size="m">
    <Header variant="h3" actions={<Button disabled={busy} onClick={close}>{uiText("procurementItemPage.close.editor")}</Button>}>{uiText("procurementItemRow.edit.requirement")}</Header>
    <Box color="text-body-secondary">{project?.name ?? uiText("procurementItemPage.select.a.property")} · {`${waveOptions.find(w => w.value === selected?.wave)?.label || ''} · ${label(selected?.status || '')}`}</Box>
    {error && <Alert type="error">{systemText(error)}</Alert>}
    <div className="proc-requirement-fields" ref={editorRef}>
      <SpaceBetween size="m">
    <div className="proc-requirement-basics"><FormField label={uiText("procurementItemRow.material.name")}><Input disabled={busy} value={draft.name} onChange={({ detail }) => setDraft({ ...draft, name: detail.value })} /></FormField>
    <FormField label={uiText("procurementItemPage.procurement.group")}><Select disabled={busy} selectedOption={waveOptions.find(w => w.value === draft.wave) ?? null} options={waveOptions} onChange={({ detail }) => setDraft({ ...draft, wave: detail.selectedOption.value! })} /></FormField>
    <FormField label={uiText("procurementItemPage.requirement.status")} constraintText={selected?.order_managed ? uiText("procurementItemPage.linked.orders.exist.purchase.progress.updates.from.orders.and") : undefined}><Select disabled={busy || !!selected?.order_managed} options={statusOptions.filter(s => ['pending_spec', 'pending_order', 'exception', 'na'].includes(s.value))} selectedOption={statusOptions.find(s => s.value === draft.status) ?? null} onChange={({ detail }) => setDraft({ ...draft, status: detail.selectedOption.value! })} /></FormField>
    </div><ProcurementFields draft={draft} onChange={setDraft} disabled={busy} />
    <SpaceBetween direction="horizontal" size="s">
      <Button variant="primary" loading={busy} disabled={!dirty} onClick={() => save()}>{uiText("procurementItemPage.save.requirement")}</Button>
      <Button disabled={busy} onClick={discard}>{dirty ? uiText("procurementItemPage.discard.changes") : uiText("procurementItemPage.reload")}</Button>
      {selected && !selected.order_managed && <DeleteRequirementButton row={selected} disabled={busy || dirty} onDeleted={async () => { if (onDeleted) await onDeleted(); else { await onSaved(); onClose(); } }} />}
    </SpaceBetween>
      </SpaceBetween>
    </div>
    {selected && <>
      <Box color="text-body-secondary">{uiText("procurementItemPage.material.details.last.edited")}{selected.updated_by ?? uiText("directorDesign.not.recorded")} · {selected.updated_at.replace('T', ' ').slice(0, 16)}</Box>
      <section className="ui-proc-images"><Header variant="h3" description={uiText("procurementItemPage.select.an.image.to.zoom.and.browse.jpg.png")}>{uiText("procurementDesign.material.images")}</Header>
        {selected.images.length === 0 && <Box color="text-body-secondary">{uiText("procurementItemPage.no.material.images.uploaded.yet")}</Box>}
        <div className="ui-proc-image-grid">{selected.images.map(img => <div key={img.id}>
          <button type="button" className="ui-proc-image-button" onClick={() => setImage(img)} aria-label={uiText("sentences.view.full.image", { value1: (img.filename) })}><img src={`/api/procurement-images/${img.id}`} alt={img.filename} loading="lazy" /></button>
          <Button variant="inline-link" disabled={busy} onClick={() => setRemoveImage(img)}>{uiText("purchaseOrderEntry.remove")} {img.filename}</Button>
        </div>)}</div>
        <label className="ui-proc-upload">{uiText("procurementItemPage.add.material.images")}<input type="file" aria-label={uiText("procurementItemPage.add.material.images")} accept="image/jpeg,image/png,image/webp" disabled={busy || selected.images.length >= 12} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void upload(file); }} /></label>
      </section>
    </>}
  </SpaceBetween> : null;
  return <div className="ui-proc-item-page"><SpaceBetween size="m">
    {editor}
    {image && selected && <ImageViewer images={selected.images.map(img => ({ id: img.id, src: `/api/procurement-images/${img.id}`, label: img.filename }))} selectedId={image.id} onClose={() => setImage(null)} />}
    <Modal visible={!!removeImage} header={uiText("procurementItemPage.remove.material.image")} onDismiss={() => setRemoveImage(null)} footer={<SpaceBetween direction="horizontal" size="s"><Button onClick={() => setRemoveImage(null)}>{uiText("fieldWithSource.cancel")}</Button><Button loading={busy} onClick={async () => { if (!removeImage) return; setBusy(true); try { await api.deleteProcurementImage(removeImage.id); setRemoveImage(null); await load(); } catch (e) { setError(procurementSaveError(e)); } finally { setBusy(false); } }}>{uiText("procurementItemPage.confirm.removal")}</Button></SpaceBetween>}>
      {uiText("procurementItemPage.remove")}{removeImage?.filename}{uiText("procurementItemPage.restoring.it.will.require.another.upload")} </Modal>
  </SpaceBetween></div>;
}

export default function ProcurementItemPage() {
  useLanguage();
  const { itemId, projectId } = useParams();
  const [params] = useSearchParams();
  const houseId = projectId || params.get('project') || '';
  return <Navigate replace to={`/procurement?project=${encodeURIComponent(houseId)}${itemId && itemId !== 'new' ? `&item=${itemId}&edit=1` : '&new=1'}`} />;
}
