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

  const typeOptions = (meta?.file_types ?? []).map((t) => ({ label: `${t.label}（${t.stage}）`, value: t.value }));
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
      flash({ type: 'success', content: `${picked.length > 1 ? `${picked.length} 个文件` : '文件'}已上传并登记（${uploader}）` });
      onDone();
    } catch (e: any) {
      flash({ type: 'error', content: `上传失败：${e.message}` });
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
        i18nStrings={{ uploadButtonText: (m) => (m ? '选择照片' : '选择文件'), dropzoneText: (m) => (m ? '拖拽照片到这里' : '拖拽文件到这里'), removeFileAriaLabel: (i) => `移除第 ${i + 1} 个`, limitShowFewer: '收起', limitShowMore: '更多', errorIconAriaLabel: '错误' }}
        constraintText={photoOnly ? '手机拍的照片直接传，可以多张' : '支持 PDF、Word、Excel、XML、图片'}
      />
      <ColumnLayout columns={compact ? 2 : 4}>
        {!photoOnly && (
          <FormField label="文件类型">
            <Select disabled={lockType} selectedOption={typeOptions.find((o) => o.value === docType) ?? null} options={typeOptions} onChange={({ detail }) => setDocType(detail.selectedOption.value!)} />
          </FormField>
        )}
        <FormField label="关联步骤" description={stepKey ? '从清单进来的，已定' : '照片关联步骤后参与证据判定；任务仍需提交确认。'}>
          <Select disabled={!!stepKey} selectedOption={stepOptions.find((o) => o.value === step) ?? null} options={[{ label: '不挂', value: '' }, ...stepOptions]} onChange={({ detail }) => setStep(detail.selectedOption.value || null)} placeholder="选一步" expandToViewport />
        </FormField>
        <FormField label="上传人（谁传的）" description={actor === '负责人' ? '按类型给了默认值，可改' : '就是你'}>
          <Select selectedOption={peopleOptions.find((o) => o.value === uploader) ?? { label: uploader, value: uploader }} options={peopleOptions} onChange={({ detail }) => setUploadedBy(detail.selectedOption.value!)} expandToViewport />
        </FormField>
        {!compact && !photoOnly && <FormField label="文件日期"><DatePicker value={docDate} onChange={({ detail }) => setDocDate(detail.value)} placeholder="YYYY/MM/DD" /></FormField>}
        {!compact && !photoOnly && <FormField label="对方（承包商 / 卖方 / 机构）"><Input value={counterparty} onChange={({ detail }) => setCounterparty(detail.value)} /></FormField>}
        {!compact && !photoOnly && <FormField label="涉及金额（美元）"><Input type="number" value={amount} onChange={({ detail }) => setAmount(detail.value)} /></FormField>}
        {!photoOnly && (docType === 'insurance' || !compact) && (
          <FormField label="到期日" description={docType === 'insurance' ? '保险有时限，到期前 30 天工作台会提醒' : '有时限的文件才填'}>
            <DatePicker value={expiresAt} onChange={({ detail }) => setExpiresAt(detail.value)} placeholder="YYYY/MM/DD" />
          </FormField>
        )}
      </ColumnLayout>
      <Box><Button variant="primary" loading={uploading} disabled={!picked.length} onClick={upload}>{photoOnly ? '上传照片' : '上传并登记'}</Button></Box>
    </SpaceBetween>
  );
}
