import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import DatePicker from '@cloudscape-design/components/date-picker';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';
import { useEffect, useRef, useState } from 'react';
import { api, Project } from '../../api/client';
import FormField from '../../components/ui/FormField';
import { useFlash } from '../../lib/flash';
import { useMeta } from '../../lib/meta';

interface Props { visible: boolean; project: Project; onDismiss: () => void; onSaved: () => void }

const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));
const str = (v: number | null | undefined) => (v == null ? '' : String(v));

export default function EditProjectModal({ visible, project, onDismiss, onSaved }: Props) {
  const meta = useMeta();
  const flash = useFlash();
  const [f, setF] = useState<any>({});
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [discard, setDiscard] = useState(false);
  const discardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (discard) discardRef.current?.focus(); }, [discard]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setDirty(false); setError(''); setDiscard(false);
      setF({
        name: project.name, strategy: project.strategy, stage: project.stage, substage: project.substage ?? '',
        lead_heat: project.lead_heat ?? 'warm_lead',
        purchase_price: str(project.purchase_price), target_arv: str(project.target_arv), sale_price: str(project.sale_price),
        purchase_date: project.purchase_date ?? '', construction_start: project.construction_start ?? '',
        construction_end: project.construction_end ?? '', list_date: project.list_date ?? '', sale_date: project.sale_date ?? '',
        status_override: project.status_override ?? '', status_override_reason: project.status_override_reason ?? '',
        risks: project.risks ?? '', notes: project.notes ?? '',
      });
    }
  }, [visible, project]);

  const set = (k: string, v: any) => { setDirty(true); setF((p: any) => ({ ...p, [k]: v })); };
  const close = () => { if (saving) return; if (dirty) setDiscard(true); else onDismiss(); };
  const substages = meta?.substages[f.stage] ?? [];
  const statusOptions = [{ label: '不覆盖（自动计算）', value: '' }, ...(meta?.statuses.filter((s) => s.value !== 'done') ?? [])];
  const heatOptions = [{ label: '热线索', value: 'hot_lead' }, { label: '温线索', value: 'warm_lead' }];

  const save = async () => {
    if (saving) return;
    setSaving(true); setError('');
    try {
      await api.patchProject(project.id, {
        name: f.name, strategy: f.strategy, stage: f.stage, substage: f.substage || null, lead_heat: f.lead_heat,
        purchase_price: numOrNull(f.purchase_price), target_arv: numOrNull(f.target_arv), sale_price: numOrNull(f.sale_price),
        purchase_date: f.purchase_date || null, construction_start: f.construction_start || null, construction_end: f.construction_end || null,
        list_date: f.list_date || null, sale_date: f.sale_date || null,
        status_override: f.status_override || null, status_override_reason: f.status_override ? f.status_override_reason : null,
        clear_status_override: !f.status_override,
        risks: f.risks || null, notes: f.notes || null,
      });
      flash({ type: 'success', content: '项目已更新' });
      onSaved();
    } catch (e: any) {
      setError(`未保存：${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const date = (k: string, label: string) => (
    <FormField label={label}>
      <DatePicker value={f[k] ?? ''} onChange={({ detail }) => set(k, detail.value)} placeholder="YYYY/MM/DD" />
    </FormField>
  );

  return (
    <Modal
      visible={visible}
      onDismiss={close}
      size="large"
      header="编辑项目"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={saving} onClick={close}>取消</Button>
            <Button variant="primary" loading={saving} onClick={save}>保存</Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="l">
        {error && <Alert type="error">{error}</Alert>}
        {discard && <div ref={discardRef} tabIndex={-1}><Alert type="warning" header="修改尚未保存" action={<SpaceBetween direction="horizontal" size="xs"><Button onClick={() => setDiscard(false)}>继续编辑</Button><Button onClick={onDismiss}>放弃修改</Button></SpaceBetween>}>关闭会丢弃本次输入。</Alert></div>}
        <ColumnLayout columns={3}>
          <FormField label="项目名称"><Input value={f.name ?? ''} onChange={({ detail }) => set('name', detail.value)} /></FormField>
          <FormField label="投资策略">
            <Select selectedOption={meta?.strategies.find((s) => s.value === f.strategy) ?? null} options={meta?.strategies ?? []} onChange={({ detail }) => set('strategy', detail.selectedOption.value)} />
          </FormField>
          <FormField label="阶段" description="由清单的大节点推进，不能手改">
            <Select disabled selectedOption={meta?.stages.find((s) => s.value === f.stage) ?? null} options={meta?.stages ?? []} onChange={() => undefined} />
          </FormField>
          <FormField label="子阶段" description="只有线索阶段可以手改热度与进展">
            <Select disabled={f.stage !== 'lead'} selectedOption={substages.find((s) => s.value === f.substage) ?? null} options={substages} onChange={({ detail }) => set('substage', detail.selectedOption.value)} />
          </FormField>
          {f.stage === 'lead' && (
            <FormField label="线索热度">
              <Select selectedOption={heatOptions.find((h) => h.value === f.lead_heat) ?? null} options={heatOptions} onChange={({ detail }) => set('lead_heat', detail.selectedOption.value)} />
            </FormField>
          )}
        </ColumnLayout>
        <ColumnLayout columns={3}>
          <FormField label="买入价（美元）"><Input type="number" value={f.purchase_price ?? ''} onChange={({ detail }) => set('purchase_price', detail.value)} /></FormField>
          <FormField label="目标售价 ARV（美元）"><Input type="number" value={f.target_arv ?? ''} onChange={({ detail }) => set('target_arv', detail.value)} /></FormField>
          <FormField label="实际成交价（美元）"><Input type="number" value={f.sale_price ?? ''} onChange={({ detail }) => set('sale_price', detail.value)} /></FormField>
        </ColumnLayout>
        <ColumnLayout columns={3}>
          {date('purchase_date', '买入日期')}
          {date('construction_start', '开工日期')}
          {date('construction_end', '计划完工日期')}
          {date('list_date', '挂牌日期')}
          {date('sale_date', '成交日期')}
        </ColumnLayout>
        <ColumnLayout columns={2}>
          <FormField label="状态覆盖" description="默认由预算与进度自动计算；需要人工判断时在此覆盖并写明理由。">
            <Select selectedOption={statusOptions.find((s) => s.value === f.status_override) ?? statusOptions[0]} options={statusOptions} onChange={({ detail }) => set('status_override', detail.selectedOption.value)} />
          </FormField>
          <FormField label="覆盖理由">
            <Input value={f.status_override_reason ?? ''} disabled={!f.status_override} onChange={({ detail }) => set('status_override_reason', detail.value)} />
          </FormField>
        </ColumnLayout>
        <FormField label="风险" stretch><Textarea value={f.risks ?? ''} rows={3} onChange={({ detail }) => set('risks', detail.value)} /></FormField>
        <FormField label="备注" stretch><Textarea value={f.notes ?? ''} rows={2} onChange={({ detail }) => set('notes', detail.value)} /></FormField>
      </SpaceBetween>
    </Modal>
  );
}
