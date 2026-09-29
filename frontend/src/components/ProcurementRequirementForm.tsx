import { useEffect, useRef, useState } from 'react';
import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { Choice, TextField } from './PurchaseOrderFields';
import type { NodeOption } from '../lib/orderStages';

export default function ProcurementRequirementForm({ stages, defaultStage = '', onSave, onCancel }: {
  stages: NodeOption[]; defaultStage?: string; onSave: (name: string, stage: string) => Promise<void>; onCancel: () => void;
}) {
  const form = useRef<HTMLElement>(null);
  useEffect(()=>{form.current?.querySelector('input')?.focus();},[]);
  const [name, setName] = useState(''); const [stage, setStage] = useState(defaultStage);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <section ref={form} className="ui-proc-requirement" aria-label="新增采购需求"><SpaceBetween size="s">
    <h3>补充本房采购需求</h3><div className="ui-order-grid"><TextField label="需求名称（必填）" value={name} onChange={setName} disabled={busy} />
      <Choice label="使用节点（必选）" value={stage} options={stages} onChange={setStage} disabled={busy} /></div>
    {error && <Alert type="error">{error}</Alert>}
    <SpaceBetween direction="horizontal" size="s"><Button variant="primary" loading={busy} disabled={!name.trim() || name.trim().length > 200 || !stage} onClick={async () => {
      setBusy(true); setError(''); try { await onSave(name.trim(), stage); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }}>添加需求</Button><Button disabled={busy} onClick={onCancel}>取消</Button></SpaceBetween>
  </SpaceBetween></section>;
}
