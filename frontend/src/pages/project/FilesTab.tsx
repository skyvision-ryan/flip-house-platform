import { useCallback, useEffect, useState } from 'react';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import UploadForm from '../../components/UploadForm';
import DatePicker from '@cloudscape-design/components/date-picker';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import Link from '@cloudscape-design/components/link';
import Modal from '@cloudscape-design/components/modal';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import Badge from '@cloudscape-design/components/badge';
import { api, ProjectFile } from '../../api/client';
import { useFlash } from '../../lib/flash';
import { dateStr, money, text } from '../../lib/format';
import { labelOf, useMeta } from '../../lib/meta';
import ReviewTag from '../../components/ReviewTag';
import OwnerTag, { OwnerDot } from '../../components/OwnerTag';

function sizeStr(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function FilesTab({ projectId }: { projectId: number }) {
  const meta = useMeta();
  const flash = useFlash();
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [who, setWho] = useState<string>('');
  const [editing, setEditing] = useState<ProjectFile | null>(null);
  const [draft, setDraft] = useState<any>({});

  const load = useCallback(() => api.files(projectId).then(setFiles), [projectId]);
  useEffect(() => { load(); }, [load]);

  const typeOptions = meta?.file_types.map((t) => ({ label: `${t.label}（${t.stage}）`, value: t.value })) ?? [];
  const peopleOptions = (meta?.roles ?? []).map((r) => ({ label: r.label, value: r.code, description: r.duties || undefined }));
  const stepTitle = (key: string) => { for (const st of meta?.stage_checklist ?? []) { const it = st.items.find((i) => i.key === key); if (it) return `${st.label} · ${it.title}`; } return key; };
  const uploaders = Array.from(new Set(files.map((f) => f.uploaded_by).filter(Boolean))) as string[];
  const shown = who ? files.filter((f) => f.uploaded_by === who) : files;

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2" description="文件不只是存起来，而是登记：类型、挂到哪一步、日期、对方、金额。挂到步骤上的文件和照片会让清单自动打勾。"><ReviewTag id="A" /><OwnerTag block="files.upload" />上传并登记文件</Header>}>
        <UploadForm projectId={projectId} onDone={load} />
      </Container>

      <Table
        header={
          <Header
            variant="h2"
            counter={`(${shown.length}${who ? ` / ${files.length}` : ''})`}
            description="文件都放在一起，按“谁传的”可以筛。"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button variant={who ? 'normal' : 'primary'} onClick={() => setWho('')}>全部</Button>
                {uploaders.map((u) => <Button key={u} variant={who === u ? 'primary' : 'normal'} onClick={() => setWho(who === u ? '' : u)}>{u}</Button>)}
              </SpaceBetween>
            }
          >
            <ReviewTag id="B" /><OwnerTag block="files.table" />文件登记表
          </Header>
        }
        items={shown}
        empty={<Box textAlign="center" color="inherit"><b>还没有文件</b></Box>}
        columnDefinitions={[
          { id: 'name', header: '文件名', cell: (f) => (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {(f.mime ?? '').startsWith('image/') && <img src={`/api/files/${f.id}/download`} alt="" style={{ width: 40, height: 30, objectFit: 'cover', borderRadius: 4, background: '#e9ecef' }} />}
              <Link href={`/api/files/${f.id}/download`} external>{f.filename}</Link>
            </span>
          ) },
          { id: 'step', header: '挂到哪一步', cell: (f) => (f.step_key ? stepTitle(f.step_key) : '—') },
          { id: 'who', header: '谁传的', cell: (f) => (f.uploaded_by ? <OwnerDot code={f.uploaded_by} /> : '—') },
          { id: 'type', header: '类型', cell: (f) => labelOf(meta?.file_types, f.doc_type) },
          { id: 'stage', header: '阶段', cell: (f) => text(f.stage) },
          { id: 'date', header: '文件日期', cell: (f) => dateStr(f.doc_date) },
          { id: 'cp', header: '对方', cell: (f) => text(f.counterparty) },
          { id: 'amt', header: '金额', cell: (f) => money(f.amount) },
          { id: 'exp', header: '到期日', cell: (f) => (f.expires_at ? <Badge color={new Date(f.expires_at + 'T00:00:00').getTime() - Date.now() < 30 * 86400000 ? 'red' : 'grey'}>{dateStr(f.expires_at)}</Badge> : '—') },
          { id: 'src', header: '来源', cell: (f) => <Badge color="grey">{f.source === 'lark' ? 'Lark 迁入' : '上传'}</Badge> },
          { id: 'size', header: '大小', cell: (f) => sizeStr(f.size) },
          { id: 'act', header: '操作', cell: (f) => (
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="inline-link" onClick={() => { setEditing(f); setDraft({ doc_type: f.doc_type ?? 'other', doc_date: f.doc_date ?? '', counterparty: f.counterparty ?? '', amount: f.amount == null ? '' : String(f.amount), uploaded_by: f.uploaded_by ?? '', expires_at: f.expires_at ?? '' }); }}>编辑</Button>
              <Button variant="inline-link" onClick={async () => { await api.deleteFile(f.id); await load(); flash({ type: 'success', content: '文件已删除' }); }}>删除</Button>
            </SpaceBetween>
          ) },
        ]}
      />

      <Modal
        visible={!!editing}
        onDismiss={() => setEditing(null)}
        header={`编辑登记信息：${editing?.filename ?? ''}`}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setEditing(null)}>取消</Button>
              <Button variant="primary" onClick={async () => {
                if (!editing) return;
                await api.patchFile(editing.id, { doc_type: draft.doc_type, doc_date: draft.doc_date || null, counterparty: draft.counterparty || null, amount: draft.amount === '' ? null : Number(draft.amount), uploaded_by: draft.uploaded_by || null, expires_at: draft.expires_at || null });
                setEditing(null); await load(); flash({ type: 'success', content: '登记信息已更新' });
              }}>保存</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <FormField label="文件类型">
            <Select selectedOption={typeOptions.find((o) => o.value === draft.doc_type) ?? null} options={typeOptions} onChange={({ detail }) => setDraft((d: any) => ({ ...d, doc_type: detail.selectedOption.value }))} />
          </FormField>
          <FormField label="上传人（谁传的）">
            <Select selectedOption={peopleOptions.find((o) => o.value === draft.uploaded_by) ?? null} options={peopleOptions} onChange={({ detail }) => setDraft((d: any) => ({ ...d, uploaded_by: detail.selectedOption.value }))} />
          </FormField>
          <FormField label="文件日期"><DatePicker value={draft.doc_date ?? ''} onChange={({ detail }) => setDraft((d: any) => ({ ...d, doc_date: detail.value }))} placeholder="YYYY/MM/DD" /></FormField>
          <FormField label="对方"><Input value={draft.counterparty ?? ''} onChange={({ detail }) => setDraft((d: any) => ({ ...d, counterparty: detail.value }))} /></FormField>
          <FormField label="涉及金额（美元）"><Input type="number" value={draft.amount ?? ''} onChange={({ detail }) => setDraft((d: any) => ({ ...d, amount: detail.value }))} /></FormField>
          <FormField label="到期日（保险这类有时限的文件）"><DatePicker value={draft.expires_at ?? ''} onChange={({ detail }) => setDraft((d: any) => ({ ...d, expires_at: detail.value }))} placeholder="YYYY/MM/DD" /></FormField>
        </SpaceBetween>
      </Modal>
    </SpaceBetween>
  );
}
