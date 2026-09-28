import { useState } from 'react';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import SpaceBetween from '@cloudscape-design/components/space-between';
import TextFilter from '@cloudscape-design/components/text-filter';
import { api, type ProcurementItem } from '../api/client';
import { procurementNeedsAttention } from '../lib/procurement';
import Header from './ui/Header';

/** A shared working selection, not another material status or a new task. */
export default function ProcurementWorklistPicker({ projectId, items, waves, onSaved, onClose }: {
  projectId: number; items: ProcurementItem[]; waves: {value: string; label: string}[];
  onSaved: () => Promise<void>; onClose: () => void;
}) {
  // Keep the opening snapshot for conflict checks even if another view refreshes.
  const [snapshot] = useState(items);
  const [selected, setSelected] = useState(() => items.filter(i => i.in_worklist).map(i => i.id));
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const available = snapshot.filter(i => i.status !== 'na' && `${i.name} ${i.specification ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const changes = snapshot.filter(i => !!i.in_worklist !== selected.includes(i.id)).map(i => ({id: i.id, updated_at: i.updated_at, selected: selected.includes(i.id)}));
  return <section className="ui-proc-picker" aria-label="选择本次采购项"><SpaceBetween size="m">
    <Header variant="h3">选择本次采购项</Header>
    <Box color="text-body-secondary">可跨节点选择。未选项仍保留；已有订单和需处理的材料会留在清单中。</Box>
    {error && <Alert type="error">{error}</Alert>}
    <TextFilter filteringText={query} filteringPlaceholder="搜索材料或规格" filteringAriaLabel="搜索可选采购项" onChange={({detail}) => setQuery(detail.filteringText)} />
    <div className="ui-proc-picker-groups">{waves.map(w => {
      const rows = available.filter(i => i.wave === w.value);
      return rows.length > 0 && <fieldset key={w.value}><legend>{w.label}</legend>{rows.map(i => <Checkbox key={i.id} checked={selected.includes(i.id)} disabled={busy || i.order_managed || procurementNeedsAttention(i)} onChange={({detail}) => setSelected(detail.checked ? [...selected, i.id] : selected.filter(id => id !== i.id))}>{i.name}{i.order_managed ? ' · 已关联订单' : procurementNeedsAttention(i) ? ' · 需处理' : ''}</Checkbox>)}</fieldset>;
    })}</div>
    {!available.length && <Box>没有符合搜索条件的材料。本房不需要项可在全部材料中恢复。</Box>}
    <SpaceBetween direction="horizontal" size="s"><Button variant="primary" loading={busy} disabled={!changes.length} onClick={async () => {
      setBusy(true); setError('');
      try { await api.procurementWorklist(projectId, changes); await onSaved(); onClose(); }
      catch(e) { setError((e as Error).message); } finally { setBusy(false); }
    }}>保存清单（{selected.length} 项）</Button><Button disabled={busy} onClick={onClose}>取消</Button></SpaceBetween>
  </SpaceBetween></section>;
}
