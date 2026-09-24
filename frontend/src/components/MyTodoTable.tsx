import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import DatePicker from '@cloudscape-design/components/date-picker';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, Steps, TodoRow } from '../api/client';
import { useFlash } from '../lib/flash';
import { useRole } from '../lib/role';
import {
actionHref,
actionLabel,
actionMode,
canActOn,
FIELD_LABEL,
nextUpFlash
} from '../lib/stepActions';
import { RoleLabel } from './RoleLabel';
import FormField from './ui/FormField';
import Header from './ui/Header';
import Table from './ui/Table';
import UploadForm from './UploadForm';

const KIND_LABEL: Record<string, string> = { file: '交文件', photo: '交照片', field: '填数', record: '记录', confirm: '确认', tick: '打勾' };

type Row = TodoRow;

/** “轮到我做的”表：待办页和工作台小组件共用。行由后端 /api/dashboard/role 给。 */
export default function MyTodoTable({ rows, onReload, compact = false }: { rows: Row[] | null; onReload: () => Promise<void> | void; compact?: boolean }) {
  const navigate = useNavigate();
  const role = useRole();
  const flash = useFlash();
  const [modal, setModal] = useState<{ kind: 'upload' | 'field' | 'confirm' | 'tick'; row: Row } | null>(null);
  const [fieldVal, setFieldVal] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  const afterDone = async (doneTitle: string, projectId: number) => {
    const steps = await api.steps(projectId).catch(() => null as Steps | null);
    flash({ type: 'success', content: steps ? nextUpFlash(doneTitle, steps) : `已完成「${doneTitle}」` });
    setModal(null);
    await onReload();
  };

  const openAction = (row: Row) => {
    const canDo = row.for_confirm ? true : canActOn(row.item, role);
    const mode = actionMode(row.item, { forConfirm: row.for_confirm });
    if (mode === 'navigate' || mode === 'view' || (!canDo && mode !== 'confirm')) {
      navigate(actionHref(row.project.project_id, row.item, { forConfirm: row.for_confirm }));
      return;
    }
    if (mode === 'tick') {
      setModal({ kind: 'tick', row });
      return;
    }
    if (mode === 'confirm') {
      setModal({ kind: 'confirm', row });
      return;
    }
    if (mode === 'upload') {
      setModal({ kind: 'upload', row });
      return;
    }
    if (mode === 'field') {
      setFieldVal('');
      setModal({ kind: 'field', row });
    }
  };

  const doTick = async () => {
    if (!modal || modal.kind !== 'tick') return;
    setBusy(true);
    try {
      await api.toggleStep(modal.row.project.project_id, modal.row.item.key, { done: true });
      await afterDone(modal.row.item.title, modal.row.project.project_id);
    } catch (e: any) {
      flash({ type: 'error', content: e.message });
    } finally {
      setBusy(false);
    }
  };

  const doConfirm = async (confirmAs: string) => {
    if (!modal || modal.kind !== 'confirm') return;
    setBusy(true);
    try {
      await api.toggleStep(modal.row.project.project_id, modal.row.item.key, { done: true, confirm_as: confirmAs });
      await afterDone(modal.row.item.title, modal.row.project.project_id);
    } catch (e: any) {
      flash({ type: 'error', content: e.message });
    } finally {
      setBusy(false);
    }
  };

  const saveField = async () => {
    if (!modal || modal.kind !== 'field' || !modal.row.item.deliverable?.field) return;
    setSaving(true);
    try {
      const f = modal.row.item.deliverable.field;
      await api.patchProject(modal.row.project.project_id, { [f]: f === 'purchase_price' ? Number(fieldVal) : fieldVal || null });
      await afterDone(modal.row.item.title, modal.row.project.project_id);
    } catch (e: any) {
      flash({ type: 'error', content: e.message });
    } finally {
      setSaving(false);
    }
  };

  const current = (rows ?? []).filter((r) => r.is_current);
  const confirmCodes = modal?.kind === 'confirm'
    ? modal.row.item.confirm.filter((c) => !modal.row.item.confirmed.includes(c) && (role.actor === c || role.can('confirm_for_others')))
    : [];

  return (
    <>
      <Table cardId="legacy-todo"
        variant={compact ? 'embedded' : 'container'}
        loading={rows === null}
        loadingText="正在看哪套房轮到你"
        items={rows ?? []}
        header={compact ? undefined : <Header variant="h2" counter={rows ? `(${rows.length})` : undefined} description={current.length ? `其中 ${current.length} 件是现在这段的事，其余是前面段落没交的。` : '暂时没有轮到你的事。'}>轮到我做的</Header>}
        empty={<Box textAlign="center" padding="l">暂时没有轮到你的事。</Box>}
        columnDefinitions={[
          { id: 'p', header: '哪套房', cell: (r) => <div><div>{r.project.project_name}</div><Box variant="small" color="text-body-secondary">{r.project.address}</Box></div> },
          { id: 's', header: '阶段', cell: (r) => <span>{r.stage}{r.is_current && <Box variant="span" color="text-status-info">　现在这段</Box>}{r.project.stage === 'portfolio' && <Box variant="span" color="text-body-secondary">　已售收尾</Box>}</span> },
          { id: 't', header: '要做什么', cell: (r) => <span style={{ fontWeight: r.item.gate ? 700 : 400 }}>{r.item.owners.map((o) => <RoleLabel key={o} code={o} />)}{r.item.title}</span> },
          { id: 'd', header: '要交什么', cell: (r) => (r.item.deliverable ? `${KIND_LABEL[r.item.deliverable.kind]} · ${r.item.deliverable.label}` : '—') },
          {
            id: 'a', header: '', width: 160, minWidth: 160,
            cell: (r) => {
              const canDo = r.for_confirm || canActOn(r.item, role);
              const label = actionLabel(r.item, { actor: role.actor, canDo, forConfirm: r.for_confirm });
              return (
                <span style={{ whiteSpace: 'nowrap' }}>
                  <Button variant="primary" onClick={() => openAction(r)}>{label}</Button>
                </span>
              );
            },
          },
        ]}
      />

      <Modal
        visible={modal?.kind === 'upload'}
        onDismiss={() => setModal(null)}
        size="large"
        header={modal?.kind === 'upload' ? `${modal.row.item.deliverable?.kind === 'photo' ? '交照片' : '交文件'}：${modal.row.item.title}` : ''}
      >
        {modal?.kind === 'upload' && (
          <UploadForm
            projectId={modal.row.project.project_id}
            docType={modal.row.item.deliverable?.doc_type ?? 'other'}
            lockType
            stepKey={modal.row.item.key}
            photoOnly={modal.row.item.deliverable?.kind === 'photo'}
            compact
            onDone={() => { afterDone(modal.row.item.title, modal.row.project.project_id); }}
          />
        )}
      </Modal>

      <Modal
        visible={modal?.kind === 'field'}
        onDismiss={() => setModal(null)}
        header={modal?.kind === 'field' ? `${modal.row.item.title}：${FIELD_LABEL[modal.row.item.deliverable?.field ?? ''] ?? ''}` : ''}
        footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button variant="link" onClick={() => setModal(null)}>取消</Button><Button variant="primary" loading={saving} disabled={!fieldVal} onClick={saveField}>保存</Button></SpaceBetween></Box>}
      >
        {modal?.kind === 'field' && (
          <FormField label={FIELD_LABEL[modal.row.item.deliverable?.field ?? ''] ?? ''}>
            {modal.row.item.deliverable?.field?.endsWith('_date')
              ? <DatePicker value={fieldVal} onChange={({ detail }) => setFieldVal(detail.value)} placeholder="YYYY/MM/DD" />
              : modal.row.item.deliverable?.field === 'risks'
                ? <Textarea value={fieldVal} rows={3} onChange={({ detail }) => setFieldVal(detail.value)} placeholder="死亡记录、unpermitted sqft、其他常见风险" />
                : <Input type="number" value={fieldVal} onChange={({ detail }) => setFieldVal(detail.value)} />}
          </FormField>
        )}
      </Modal>

      <Modal
        visible={modal?.kind === 'tick'}
        onDismiss={() => setModal(null)}
        header={modal?.kind === 'tick' ? `标完成：${modal.row.item.title}` : ''}
        footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button variant="link" onClick={() => setModal(null)}>取消</Button><Button variant="primary" loading={busy} onClick={doTick}>确认完成</Button></SpaceBetween></Box>}
      >
        {modal?.kind === 'tick' && (
          <Box>确认「{modal.row.item.title}」已完成？完成后会告诉你下一位是谁。</Box>
        )}
      </Modal>

      <Modal
        visible={modal?.kind === 'confirm'}
        onDismiss={() => setModal(null)}
        header={modal?.kind === 'confirm' ? `确认节点：${modal.row.item.title}` : ''}
        footer={<Box float="right"><Button variant="link" onClick={() => setModal(null)}>关闭</Button></Box>}
      >
        {modal?.kind === 'confirm' && (
          <SpaceBetween size="m">
            <Box>{modal.row.item.evidence_hint ?? '请确认该节点的证据与条件已满足。'}</Box>
            <Box variant="small" color="text-body-secondary">{modal.row.project.project_name} · {modal.row.stage}</Box>
            <SpaceBetween direction="horizontal" size="s">
              {confirmCodes.map((c) => (
                <Checkbox key={c} checked={false} disabled={busy} onChange={() => doConfirm(c)}>
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>以 {c} 确认</span>
                </Checkbox>
              ))}
              {!confirmCodes.length && <Box color="text-body-secondary">你这边已经确认过了，或无权代确认。</Box>}
            </SpaceBetween>
          </SpaceBetween>
        )}
      </Modal>
    </>
  );
}
