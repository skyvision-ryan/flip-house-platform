import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import DatePicker from '@cloudscape-design/components/date-picker';
import FileUpload from '@cloudscape-design/components/file-upload';
import Input from '@cloudscape-design/components/input';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState } from 'react';
import { api } from '../api/client';
import { useActor } from '../lib/actor';
import { useFlash } from '../lib/flash';
import { useMeta } from '../lib/meta';
import FormField from './ui/FormField';

interface Props {
  projectId: number;
  docType?: string;        // 预填类型
  lockType?: boolean;      // 锁死类型（从清单里“交文件”进来）
  stepKey?: string | null; // 挂到哪一步
  photoOnly?: boolean;     // 只收图片
  compact?: boolean;       // 少几个字段（弹窗里用）
  onDone: () => void;
}

/** 上传并登记：文件页和清单表的“交文件 / 交照片”共用。 */
export default function UploadForm({ projectId, docType: initType = 'other', lockType = false, stepKey = null, photoOnly = false, compact = false, onDone }: Props) {
  useLanguage();
  const meta = useMeta();
  const flash = useFlash();
  const { actor } = useActor();
  const [picked, setPicked] = useState<File[]>([]);
  const [docType, setDocType] = useState(photoOnly ? 'photo' : initType);
  const [uploadedBy, setUploadedBy] = useState('');
  const [docDate, setDocDate] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [amount, setAmount] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [step, setStep] = useState<string | null>(stepKey);
  const [uploading, setUploading] = useState(false);

  const typeOptions = (meta?.file_types ?? []).map((t) => ({ label: `${t.label}（${systemText(t.stage)}）`, value: t.value }));
  const peopleOptions = (meta?.roles ?? []).map((r) => ({ label: r.label, value: r.code, description: r.duties || undefined }));
  const stepOptions = (meta?.stage_checklist ?? []).flatMap((st) => st.items.map((it) => ({ label: `${st.label} · ${it.title}`, value: it.key })));
  const defaultUploader = actor !== '负责人' ? actor : (meta?.file_default_owner?.[docType] ?? '负责人');
  const uploader = uploadedBy || defaultUploader;

  const upload = async () => {
    if (!picked.length) return;
    setUploading(true);
    try {
      for (const f of picked) {
        const form = new FormData();
        form.append('file', f);
        form.append('doc_type', docType);
        if (docDate) form.append('doc_date', docDate);
        if (counterparty) form.append('counterparty', counterparty);
        if (amount) form.append('amount', amount);
        if (expiresAt) form.append('expires_at', expiresAt);
        if (step) form.append('step_key', step);
        form.append('uploaded_by', uploader);
        await api.upload(projectId, form);
      }
      setPicked([]); setDocDate(''); setCounterparty(''); setAmount(''); setExpiresAt('');
      flash({ type: 'success', content: uiText("sentences.uploaded.and.recorded", { value1: (picked.length > 1 ? uiText("sentences.files", { value1: (picked.length) }) : uiText("updatesList.files")), value2: (uploader) }) });
      onDone();
    } catch (e: any) {
      flash({ type: 'error', content: uiText("sentences.upload.failed", { value1: (e.message) }) });
    } finally {
      setUploading(false);
    }
  };

  return (
    <SpaceBetween size="m">
      <FileUpload
        value={picked}
        multiple={photoOnly}
        onChange={({ detail }) => setPicked(detail.value)}
        accept={photoOnly ? '.jpg,.jpeg,.png,.heic,.webp' : '.pdf,.docx,.doc,.xlsx,.xls,.xml,.jpg,.jpeg,.png,.txt'}
        showFileSize
        showFileThumbnail={photoOnly}
        i18nStrings={{ uploadButtonText: (m) => (m ? uiText("uploadForm.select.photos") : uiText("uploadForm.select.files")), dropzoneText: (m) => (m ? uiText("uploadForm.drop.photos.here") : uiText("uploadForm.drop.files.here")), removeFileAriaLabel: (i) => uiText("sentences.remove.item.2", { value1: (i + 1) }), limitShowFewer: uiText("procurementItemRow.collapse"), limitShowMore: uiText('uploadForm.more'), errorIconAriaLabel: uiText("uploadForm.error") }}
        constraintText={photoOnly ? uiText("uploadForm.upload.multiple.photos.directly.from.your.phone") : uiText("uploadForm.supports.pdf.word.excel.xml.and.images")}
      />
      <ColumnLayout columns={compact ? 2 : 4}>
        {!photoOnly && (
          <FormField label={uiText("uploadForm.file.type")}>
            <Select disabled={lockType} selectedOption={typeOptions.find((o) => o.value === docType) ?? null} options={typeOptions} onChange={({ detail }) => setDocType(detail.selectedOption.value!)} />
          </FormField>
        )}
        <FormField label={uiText("uploadForm.linked.step")} description={stepKey ? uiText("uploadForm.selected.from.the.checklist") : uiText("uploadForm.linked.photos.count.toward.evidence.the.task.still.requires")}>
          <Select disabled={!!stepKey} selectedOption={stepOptions.find((o) => o.value === step) ?? null} options={[{ label: uiText("uploadForm.no.linked.step"), value: '' }, ...stepOptions]} onChange={({ detail }) => setStep(detail.selectedOption.value || null)} placeholder={uiText("uploadForm.select.a.step")} expandToViewport />
        </FormField>
        <FormField label={uiText("uploadForm.uploaded.by")} description={actor === '负责人' ? uiText("uploadForm.defaulted.by.file.type.editable") : uiText("uploadForm.you")}>
          <Select selectedOption={peopleOptions.find((o) => o.value === uploader) ?? { label: uploader, value: uploader }} options={peopleOptions} onChange={({ detail }) => setUploadedBy(detail.selectedOption.value!)} expandToViewport />
        </FormField>
        {!compact && !photoOnly && <FormField label={uiText("uploadForm.document.date")}><DatePicker value={docDate} onChange={({ detail }) => setDocDate(detail.value)} placeholder="YYYY/MM/DD" /></FormField>}
        {!compact && !photoOnly && <FormField label={uiText("uploadForm.counterparty.contractor.seller.agency")}><Input value={counterparty} onChange={({ detail }) => setCounterparty(detail.value)} /></FormField>}
        {!compact && !photoOnly && <FormField label={uiText("uploadForm.amount.usd")}><Input type="number" value={amount} onChange={({ detail }) => setAmount(detail.value)} /></FormField>}
        {!photoOnly && (docType === 'insurance' || !compact) && (
          <FormField label={uiText("uploadForm.expiration.date")} description={docType === 'insurance' ? uiText("uploadForm.the.workspace.flags.insurance.within.30.days.of.expiration") : uiText("uploadForm.only.for.time.limited.documents")}>
            <DatePicker value={expiresAt} onChange={({ detail }) => setExpiresAt(detail.value)} placeholder="YYYY/MM/DD" />
          </FormField>
        )}
      </ColumnLayout>
      <Box><Button variant="primary" loading={uploading} disabled={!picked.length} onClick={upload}>{photoOnly ? uiText("uploadForm.upload.photos") : uiText("uploadForm.upload.and.record")}</Button></Box>
    </SpaceBetween>
  );
}
