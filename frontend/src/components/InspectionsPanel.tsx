import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import DatePicker from '@cloudscape-design/components/date-picker';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useCallback, useEffect, useState } from 'react';
import { api, Inspection } from '../api/client';
import { useActor } from '../lib/actor';
import { useFlash } from '../lib/flash';
import { dateStr, text } from '../lib/format';
import { labelOf, useMeta } from '../lib/meta';
import { RoleLabel } from './RoleLabel';
import FormField from './ui/FormField';
import Table from './ui/Table';

const RESULT_KIND: Record<string, 'success' | 'error' | 'pending'> = { passed: 'success', failed: 'error', scheduled: 'pending' };
const EMPTY = { name: '', date: '', result: 'scheduled', is_final: false, fixer: '', note: '' };

/** 总览里的“检查记录”：一次检查一行，次数不固定。最后一次标 final，通过了清单里的“final”大节点自动过。 */
export default function InspectionsPanel({ projectId, onChanged }: { projectId: number; onChanged?: () => void }) {
  const meta = useMeta();
  const flash = useFlash();
  const { actor } = useActor();
  const [rows, setRows] = useState<Inspection[] | null>(null);
  const [editing, setEditing] = useState<Inspection | 'new' | null>(null);
  const [draft, setDraft] = useState<typeof EMPTY>(EMPTY);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.inspections(projectId).then(setRows), [projectId]);
  useEffect(() => { load(); }, [load]);

  if (!rows) return <Box textAlign="center" padding="m"><Spinner /></Box>;

  const resultOptions = meta?.inspection_results ?? [];
  const open = (i: Inspection | 'new') => {
    setEditing(i);
    setDraft(i === 'new' ? EMPTY : { name: i.name, date: i.date ?? '', result: i.result, is_final: i.is_final, fixer: i.fixer ?? '', note: i.note ?? '' });
  };
  const submit = async () => {
    if (!draft.name.trim()) { flash({ type: 'error', content: '先写查什么' }); return; }
    setBusy(true);
    try {
      const body = { name: draft.name.trim(), date: draft.date || null, result: draft.result, is_final: draft.is_final, fixer: draft.fixer || null, note: draft.note || null };
      setRows(editing === 'new' ? await api.addInspection(projectId, body) : await api.patchInspection((editing as Inspection).id, body));
      setEditing(null);
      flash({ type: 'success', content: `检查记录已保存（${actor}）` });
      onChanged?.();
    } catch (e: any) {
      flash({ type: 'error', content: `没保存上：${e.message}` });
    } finally {
      setBusy(false);
    }
  };

  const passed = rows.filter((r) => r.result === 'passed').length;
  const failed = rows.filter((r) => r.result === 'failed');
  const finalOk = rows.some((r) => r.is_final && r.result === 'passed');
  return (
    <SpaceBetween size="s">
      <Box color="text-body-secondary">
        {rows.length === 0 ? '还没有检查记录。'
          : finalOk ? <StatusIndicator type="success">final 已通过，施工结束</StatusIndicator>
          : failed.length ? <StatusIndicator type="error">{failed.length} 次没过，整改中</StatusIndicator>
          : <StatusIndicator type="in-progress">已通过 {passed} 次，还没到 final</StatusIndicator>}
      </Box>
      <Table
        variant="embedded"
        items={rows}
        empty={<Box textAlign="center" color="inherit">师傅做到一个程度，Z 约一次检查，就在这里记一行。</Box>}
        columnDefinitions={[
          { id: 'n', header: '第几次', width: 70, cell: (i) => rows.indexOf(i) + 1 },
          { id: 'name', header: '查什么', cell: (i) => <span>{i.name}{i.is_final && <b className="ui-final-label">final</b>}</span> },
          { id: 'date', header: '日期', width: 110, cell: (i) => dateStr(i.date) },
          { id: 'res', header: '结果', width: 130, cell: (i) => <StatusIndicator type={RESULT_KIND[i.result] ?? 'pending'}>{labelOf(resultOptions, i.result)}</StatusIndicator> },
          { id: 'fixer', header: '没过谁整改', cell: (i) => (i.result === 'failed' ? text(i.fixer) || <Box color="text-status-error">还没写</Box> : '—') },
          { id: 'note', header: '备注', cell: (i) => text(i.note) },
          { id: 'who', header: '谁记的', width: 80, cell: (i) => (i.recorded_by ? <RoleLabel code={i.recorded_by} /> : '—') },
          { id: 'act', header: '', width: 120, cell: (i) => (
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="inline-link" onClick={() => open(i)}>改</Button>
              <Button variant="inline-link" onClick={async () => { setRows(await api.deleteInspection(i.id)); onChanged?.(); }}>删</Button>
            </SpaceBetween>
          ) },
        ]}
      />
      <Box><Button iconName="add-plus" onClick={() => open('new')}>记一次检查</Button></Box>

      <Modal
        visible={editing !== null}
        onDismiss={() => setEditing(null)}
        header={editing === 'new' ? '记一次检查' : '改检查记录'}
        footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button variant="link" onClick={() => setEditing(null)}>取消</Button><Button variant="primary" loading={busy} onClick={submit}>保存</Button></SpaceBetween></Box>}
      >
        <SpaceBetween size="m">
          <ColumnLayout columns={2}>
            <FormField label="查什么" description="比如 框架、水电粗装、屋顶、final">
              <Input value={draft.name} onChange={({ detail }) => setDraft((d) => ({ ...d, name: detail.value }))} />
            </FormField>
            <FormField label="日期"><DatePicker value={draft.date} onChange={({ detail }) => setDraft((d) => ({ ...d, date: detail.value }))} placeholder="YYYY/MM/DD" /></FormField>
            <FormField label="结果">
              <Select selectedOption={resultOptions.find((o) => o.value === draft.result) ?? null} options={resultOptions} onChange={({ detail }) => setDraft((d) => ({ ...d, result: detail.selectedOption.value! }))} />
            </FormField>
            <FormField label="没过谁整改" description="一般是 PM 加施工方">
              <Input value={draft.fixer} disabled={draft.result !== 'failed'} placeholder="PM + 承包商名字" onChange={({ detail }) => setDraft((d) => ({ ...d, fixer: detail.value }))} />
            </FormField>
          </ColumnLayout>
          <Checkbox checked={draft.is_final} onChange={({ detail }) => setDraft((d) => ({ ...d, is_final: detail.checked }))}>这是最后一次（final）。通过后清单里的“final”大节点自动过。</Checkbox>
          <FormField label="备注"><Input value={draft.note} onChange={({ detail }) => setDraft((d) => ({ ...d, note: detail.value }))} /></FormField>
        </SpaceBetween>
      </Modal>
    </SpaceBetween>
  );
}
