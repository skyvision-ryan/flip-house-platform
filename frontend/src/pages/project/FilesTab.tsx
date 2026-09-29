import { useCollection } from '@cloudscape-design/collection-hooks';
import TextFilter from '@cloudscape-design/components/text-filter';
import Pagination from '@cloudscape-design/components/pagination';
import { useSearchParams } from 'react-router-dom';
import ImageViewer from '../../components/ui/ImageViewer';
import { matchesRecord } from '../../lib/recordSearch';
import ExpandableSection from '../../components/ui/ExpandableSection';
import Alert from '@cloudscape-design/components/alert';
import Badge from '@cloudscape-design/components/badge';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import DatePicker from '@cloudscape-design/components/date-picker';
import Input from '@cloudscape-design/components/input';
import Link from '@cloudscape-design/components/link';
import Modal from '@cloudscape-design/components/modal';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useEffect, useState } from 'react';
import { api, ProjectFile } from '../../api/client';
import { RoleLabel } from '../../components/RoleLabel';
import FormField from '../../components/ui/FormField';
import Header from '../../components/ui/Header';
import Table from '../../components/ui/Table';
import UploadForm from '../../components/UploadForm';
import { useFlash } from '../../lib/flash';
import { dateStr, money, text } from '../../lib/format';
import { labelOf, useMeta } from '../../lib/meta';
import { useRole } from '../../lib/role';
import { fileRegistrationPatch, type FileRegistrationDraft } from '../../lib/fileRegistration';

function sizeStr(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function FilesTab({ projectId }: { projectId: number }) {
  const meta = useMeta();
  const flash = useFlash();
  const role = useRole();
  const canManageMetadata = role.can('upload_any');
  const [loadError, setLoadError] = useState('');
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [params, setParams] = useSearchParams();
  const who = params.get('uploader') ?? '';
  const query = params.get('fileq') ?? '';
  const docType = params.get('filetype') ?? '';
  const filter = (key: string, value: string) => setParams(prev => { const next = new URLSearchParams(prev); if (value) next.set(key, value); else next.delete(key); return next; }, { replace: true });
  const [preview, setPreview] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [editError, setEditError] = useState('');
  const [editing, setEditing] = useState<ProjectFile | null>(null);
  const [draft, setDraft] = useState<any>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => { setLoading(true); try { setFiles(await api.files(projectId)); setLoadError(''); } catch (e) { setLoadError((e as Error).message); } finally { setLoading(false); } }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const typeOptions = meta?.file_types.map((t) => ({ label: `${t.label}（${t.stage}）`, value: t.value })) ?? [];
  const peopleOptions = (meta?.roles ?? []).map((r) => ({ label: r.label, value: r.code, description: r.duties || undefined }));
  const stepTitle = (key: string) => { for (const st of meta?.stage_checklist ?? []) { const it = st.items.find((i) => i.key === key); if (it) return `${st.label} · ${it.title}`; } return key; };
  const uploaders = Array.from(new Set(files.map((f) => f.uploaded_by).filter(Boolean))) as string[];
  const shown = files.filter(f => (!who || f.uploaded_by === who) && (!docType || f.doc_type === docType) && matchesRecord(query, [f.filename, f.counterparty, f.doc_date, f.step_key ? stepTitle(f.step_key) : null, labelOf(meta?.file_types, f.doc_type)]));
  const { items, collectionProps, paginationProps } = useCollection(shown, { pagination: { pageSize: 20 }, sorting: {} });
  const images = shown.filter(f => f.mime?.startsWith('image/')).map(f => ({ id: f.id, src: `/api/files/${f.id}/download`, label: f.filename }));
  const clear = () => setParams(prev => { const next = new URLSearchParams(prev); ['fileq', 'filetype', 'uploader'].forEach(k => next.delete(k)); return next; }, { replace: true });

  return (
    <SpaceBetween size="l">
      {loadError && <Alert type="error" action={<Button onClick={load}>重试</Button>}>{loadError}</Alert>}
      <ExpandableSection cardId="files-upload" variant="container" headerText="上传并登记文件">
        <UploadForm projectId={projectId} onDone={load} />
      </ExpandableSection>

      <Table cardId="files-list"
        header={
          <Header
            variant="h2"
            counter={`(${shown.length} / ${files.length})`}
            description="查找本房已有资料；图片可直接放大查看，其他文件保留原文件入口。"
          >
            文件登记表
          </Header>
        }
        {...collectionProps}
        items={items} loading={loading} loadingText="正在读取文件"
        pagination={<Pagination {...paginationProps} ariaLabels={{ nextPageLabel: '下一页', previousPageLabel: '上一页', pageLabel: n => `第 ${n} 页` }} />}
        filter={<SpaceBetween size="s">
          <TextFilter filteringText={query} onChange={({ detail }) => filter('fileq', detail.filteringText)} filteringAriaLabel="查找文件" filteringPlaceholder="文件名、对方、步骤或日期" countText={`${shown.length} 个匹配`} />
          <SpaceBetween direction="horizontal" size="s">
            <Select ariaLabel="筛选文件类型" selectedOption={typeOptions.find(o => o.value === docType) ?? { label: '全部类型', value: '' }} options={[{ label: '全部类型', value: '' }, ...typeOptions]} onChange={({ detail }) => filter('filetype', detail.selectedOption.value ?? '')} />
            <Select ariaLabel="筛选上传人" selectedOption={{ label: who || '全部上传人', value: who }} options={[{ label: '全部上传人', value: '' }, ...uploaders.map(u => ({ label: u, value: u }))]} onChange={({ detail }) => filter('uploader', detail.selectedOption.value ?? '')} />
            {(query || who || docType) && <Button onClick={clear}>清除筛选</Button>}
          </SpaceBetween>
        </SpaceBetween>}
        empty={<Box textAlign="center" color="inherit"><b>{loadError ? '文件尚未读取成功' : files.length ? '没有匹配的文件' : '本房尚无文件'}</b>{files.length > 0 && <Button variant="inline-link" onClick={clear}>清除筛选</Button>}</Box>}
        columnDefinitions={[
          { id: 'name', header: '文件名', minWidth: 260, sortingField: 'filename', cell: (f) => (
            <span className="ui-inline">
              {(f.mime ?? '').startsWith('image/') && <img src={`/api/files/${f.id}/download`} alt="" className="ui-thumbnail ui-thumbnail-file" onError={e => { e.currentTarget.hidden = true; }} />}
              {f.mime?.startsWith('image/') ? <Button variant="inline-link" onClick={() => setPreview(f.id)}>{f.filename} · 查看图片</Button> : <Link href={`/api/files/${f.id}/download`} external>{f.filename}</Link>}
            <Button variant="inline-link" onClick={() => { setEditError(''); setEditing(f); setDraft({ doc_type: f.doc_type ?? 'other', doc_date: f.doc_date ?? '', counterparty: f.counterparty ?? '', amount: f.amount == null ? '' : String(f.amount), uploaded_by: f.uploaded_by ?? '', expires_at: f.expires_at ?? '' }); }}>编辑登记</Button>
            </span>
          ) },
          { id: 'step', header: '挂到哪一步', cell: (f) => (f.step_key ? stepTitle(f.step_key) : '—') },
          { id: 'who', header: '谁传的', cell: (f) => (f.uploaded_by ? <RoleLabel code={f.uploaded_by} /> : '—') },
          { id: 'type', header: '类型', cell: (f) => labelOf(meta?.file_types, f.doc_type) },
          { id: 'stage', header: '阶段', cell: (f) => text(f.stage) },
          { id: 'date', header: '文件日期', sortingField: 'doc_date', cell: (f) => dateStr(f.doc_date) },
          { id: 'cp', header: '对方', cell: (f) => text(f.counterparty) },
          { id: 'amt', header: '金额', cell: (f) => money(f.amount) },
          { id: 'exp', header: '到期日', cell: (f) => (f.expires_at ? <Badge color={new Date(f.expires_at + 'T00:00:00').getTime() - Date.now() < 30 * 86400000 ? 'red' : 'grey'}>{dateStr(f.expires_at)}</Badge> : '—') },
          { id: 'src', header: '来源', cell: (f) => <Badge color="grey">{f.source === 'lark' ? 'Lark 迁入' : '上传'}</Badge> },
          { id: 'size', header: '大小', cell: (f) => sizeStr(f.size) },
          { id: 'act', header: '操作', cell: (f) => (
            <SpaceBetween direction="horizontal" size="xs">

              <Button variant="inline-link" onClick={async () => { await api.deleteFile(f.id); await load(); flash({ type: 'success', content: '文件已删除' }); }}>删除</Button>
            </SpaceBetween>
          ) },
        ]}
      />

      {preview != null && <ImageViewer images={images} selectedId={preview} onClose={() => setPreview(null)} />}
      <Modal
        visible={!!editing}
        onDismiss={() => { if (!saving) setEditing(null); }}
        header={`编辑登记信息：${editing?.filename ?? ''}`}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" disabled={saving} onClick={() => setEditing(null)}>取消</Button>
              <Button variant="primary" loading={saving} onClick={async () => {
                if (!editing || saving) return;
                setSaving(true); setEditError('');
                try {
                  await api.patchFile(editing.id, fileRegistrationPatch(draft as FileRegistrationDraft, canManageMetadata, role.canReadMoney));
                  setEditing(null); await load(); flash({ type: 'success', content: '登记信息已更新' });
                } catch (error: unknown) {
                  setEditError(`保存失败：${error instanceof Error ? error.message : String(error)}`);
                } finally { setSaving(false); }
              }}>保存</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {editError && <Alert type="error">{editError}</Alert>}
          <FormField label="文件类型">
            <Select disabled={!canManageMetadata} selectedOption={typeOptions.find((o) => o.value === draft.doc_type) ?? null} options={typeOptions} onChange={({ detail }) => setDraft((d: any) => ({ ...d, doc_type: detail.selectedOption.value }))} />
          </FormField>
          <FormField label="上传人（谁传的）">
            <Select disabled={!canManageMetadata} selectedOption={peopleOptions.find((o) => o.value === draft.uploaded_by) ?? null} options={peopleOptions} onChange={({ detail }) => setDraft((d: any) => ({ ...d, uploaded_by: detail.selectedOption.value }))} />
          </FormField>
          <FormField label="文件日期"><DatePicker value={draft.doc_date ?? ''} onChange={({ detail }) => setDraft((d: any) => ({ ...d, doc_date: detail.value }))} placeholder="YYYY/MM/DD" /></FormField>
          <FormField label="对方"><Input value={draft.counterparty ?? ''} onChange={({ detail }) => setDraft((d: any) => ({ ...d, counterparty: detail.value }))} /></FormField>
          {role.canReadMoney && <FormField label="涉及金额（美元）"><Input type="number" value={draft.amount ?? ''} onChange={({ detail }) => setDraft((d: any) => ({ ...d, amount: detail.value }))} /></FormField>}
          <FormField label="到期日（保险这类有时限的文件）"><DatePicker value={draft.expires_at ?? ''} onChange={({ detail }) => setDraft((d: any) => ({ ...d, expires_at: detail.value }))} placeholder="YYYY/MM/DD" /></FormField>
        </SpaceBetween>
      </Modal>
    </SpaceBetween>
  );
}
