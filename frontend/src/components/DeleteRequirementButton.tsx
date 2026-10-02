import { useState } from 'react';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { materialName } from '../i18n/templateNames.ts';
import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
import { api, type ProcurementItem } from '../api/client';
import { procurementSaveError } from '../lib/procurementForm';
import { useFlash } from '../lib/flash';

/** Hard delete of a mis-added requirement. The server refuses rows with orders, images or legacy purchase facts; 本房不需要 is the path that keeps a reason. */
export default function DeleteRequirementButton({ row, disabled = false, onDeleted }: { row: ProcurementItem; disabled?: boolean; onDeleted: () => void | Promise<void> }) {
  useLanguage();
  const flash = useFlash();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const blockedByImages = (row.images?.length ?? 0) > 0;
  const remove = async () => {
    setBusy(true); setError('');
    try {
      await api.deleteProcurement(row.id, row.updated_at);
      setOpen(false);
      flash({ type: 'success', content: uiText("procurementItemPage.requirement.deleted", { value1: materialName(row) }) });
      await onDeleted();
    } catch (e) {
      // A row that is already gone is the outcome the user asked for.
      if ((e as { status?: number })?.status === 404) { setOpen(false); await onDeleted(); }
      else setError(procurementSaveError(e));
    } finally { setBusy(false); }
  };
  return <>
    <Button variant="inline-link" disabled={disabled || busy} onClick={() => { setError(''); setOpen(true); }}>{uiText("procurementItemPage.delete.requirement")}</Button>
    <Modal visible={open} header={uiText("procurementItemPage.delete.confirm.title")} onDismiss={() => { if (!busy) setOpen(false); }}
      footer={<SpaceBetween direction="horizontal" size="s"><Button disabled={busy} onClick={() => setOpen(false)}>{uiText("fieldWithSource.cancel")}</Button><Button variant="primary" loading={busy} disabled={blockedByImages} onClick={() => void remove()}>{uiText("procurementItemPage.confirm.delete")}</Button></SpaceBetween>}>
      <SpaceBetween size="s">
        <Box>{uiText("procurementItemPage.delete.confirm", { value1: materialName(row) })}</Box>
        {blockedByImages && <Alert type="warning">{uiText("procurementItemPage.remove.images.first")}</Alert>}
        {error && <Alert type="error">{systemText(error)}</Alert>}
      </SpaceBetween>
    </Modal>
  </>;
}
