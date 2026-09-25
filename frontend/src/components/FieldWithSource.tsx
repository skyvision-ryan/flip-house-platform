import Badge from '@cloudscape-design/components/badge';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import Popover from '@cloudscape-design/components/popover';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState } from 'react';
import { PropertyField } from '../api/client';
import { dateTime, pct, text } from '../lib/format';
import SourceBadge from './SourceBadge';
import FormField from './ui/FormField';
import Table from './ui/Table';

interface Props {
  field: PropertyField;
  onSave: (value: string | null) => Promise<void>;
  onSetPrimary: (sourceId: number) => Promise<void>;
}

export default function FieldWithSource({ field, onSave, onSetPrimary }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(field.value ?? '');
  const [saving, setSaving] = useState(false);
  const primary = field.sources.find((s) => s.is_primary);

  return (
    <div className="ui-field-source">
      <div className="ui-field-label"><span>{field.label}</span><Button variant="inline-icon" iconName="edit" ariaLabel={`编辑${field.label}`} onClick={() => { setDraft(field.value ?? ''); setEditing(true); }} /></div>
      <div className="ui-field-value">{text(field.value)}</div>
      <div className="ui-field-meta">
        {primary && <SourceBadge source={primary.source} fetchedAt={primary.fetched_at} confidence={primary.confidence} note={primary.note} />}
        {field.has_conflict && (
          <Popover
            header="多个来源的值不一致"
            size="large"
            triggerType="custom"
            content={
              <Table
                variant="embedded"
                items={field.sources}
                columnDefinitions={[
                  { id: 'value', header: '值', cell: (s) => text(s.value) },
                  { id: 'source', header: '来源', cell: (s) => <SourceBadge source={s.source} /> },
                  { id: 'time', header: '时间', cell: (s) => dateTime(s.fetched_at) },
                  { id: 'conf', header: '把握度', cell: (s) => (s.confidence == null ? '—' : pct(s.confidence * 100, 0)) },
                  { id: 'act', header: '', cell: (s) => (s.is_primary ? <Badge color="grey">主值</Badge> : <Button variant="inline-link" onClick={() => onSetPrimary(s.id)}>设为主值</Button>) },
                ]}
              />
            }
          >
            <Badge color="red">有冲突</Badge>
          </Popover>
        )}
      </div>
      <Modal
        visible={editing}
        onDismiss={() => setEditing(false)}
        header={`编辑：${field.label}`}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setEditing(false)}>取消</Button>
              <Button variant="primary" loading={saving} onClick={async () => { setSaving(true); try { await onSave(draft === '' ? null : draft); setEditing(false); } finally { setSaving(false); } }}>保存</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <FormField label={field.label} description="人工修改后，该值成为主值，来源标记为“人工”。原有来源记录保留，可随时切换回去。">
          <Input value={draft} type={field.type === 'int' ? 'number' : 'text'} onChange={({ detail }) => setDraft(detail.value)} />
        </FormField>
      </Modal>
    </div>
  );
}
