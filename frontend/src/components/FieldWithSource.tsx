import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
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
  useLanguage();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(field.value ?? '');
  const [saving, setSaving] = useState(false);
  const primary = field.sources.find((s) => s.is_primary);

  return (
    <div className="ui-field-source">
      <div className="ui-field-label"><span>{systemText(systemText(field.label))}</span><Button variant="inline-icon" iconName="edit" ariaLabel={uiText("sentences.edit", { value1: (systemText(field.label)) })} onClick={() => { setDraft(field.value ?? ''); setEditing(true); }} /></div>
      <div className="ui-field-value">{text(field.value)}</div>
      <div className="ui-field-meta">
        {primary && <SourceBadge source={primary.source} fetchedAt={primary.fetched_at} confidence={primary.confidence} note={primary.note} />}
        {field.has_conflict && (
          <Popover
            header={uiText("fieldWithSource.sources.disagree.on.this.value")}
            size="large"
            triggerType="custom"
            content={
              <Table
                variant="embedded"
                items={field.sources}
                columnDefinitions={[
                  { id: 'value', header: uiText("fieldWithSource.value"), cell: (s) => text(s.value) },
                  { id: 'source', header: uiText("fieldWithSource.source"), cell: (s) => <SourceBadge source={s.source} /> },
                  { id: 'time', header: uiText("fieldWithSource.time"), cell: (s) => dateTime(s.fetched_at) },
                  { id: 'conf', header: uiText("fieldWithSource.confidence"), cell: (s) => (s.confidence == null ? '—' : pct(s.confidence * 100, 0)) },
                  { id: 'act', header: '', cell: (s) => (s.is_primary ? <Badge color="grey">{uiText("fieldWithSource.primary.value")}</Badge> : <Button variant="inline-link" onClick={() => onSetPrimary(s.id)}>{uiText("fieldWithSource.use.as.primary")}</Button>) },
                ]}
              />
            }
          >
            <Badge color="red">{uiText("fieldWithSource.conflicting.values")}</Badge>
          </Popover>
        )}
      </div>
      <Modal
        visible={editing}
        onDismiss={() => setEditing(false)}
        header={uiText("sentences.edit.2", { value1: (systemText(field.label)) })}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setEditing(false)}>{uiText("fieldWithSource.cancel")}</Button>
              <Button variant="primary" loading={saving} onClick={async () => { setSaving(true); try { await onSave(draft === '' ? null : draft); setEditing(false); } finally { setSaving(false); } }}>{uiText("fieldWithSource.save")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <FormField label={systemText(systemText(field.label))} description={uiText("fieldWithSource.an.edited.value.becomes.the.primary.value.with.a")}>
          <Input value={draft} type={field.type === 'int' ? 'number' : 'text'} onChange={({ detail }) => setDraft(detail.value)} />
        </FormField>
      </Modal>
    </div>
  );
}
