import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Tabs from '@cloudscape-design/components/tabs';
import Textarea from '@cloudscape-design/components/textarea';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, FileRow, Submission, Task } from '../api/client';
import { useFlash } from '../lib/flash';
import { dateTime } from '../lib/format';
import { useMeta } from '../lib/meta';
import { stageKeyLabel } from '../lib/stageGroups';
import { dueText, statusActions, statusIndicator } from '../lib/taskGroups';
import HelpText from './HelpText';
import PersonAvatar from './PersonAvatar';
import TaskTimeline from './TaskTimeline';
import TaskWaitModal from './TaskWaitModal';
import ExpandableSection from './ui/ExpandableSection';
import KeyValuePairs from './ui/Facts';
import FormField from './ui/FormField';
import Header from './ui/Header';
import Container from './ui/Surface';
import UploadForm from './UploadForm';

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * 任务处理组件（KAN-75 块 5，目标图 13 / 14 / 16）：详情 / 交付 / 活动记录 三个页签，
 * 负责人在「交付」里选文件、写说明、提交审核；审核人在同一处看文件、当前生效要求，退回或确认。
 * 三个入口（我的事项、总览、活动记录页）共用同一条任务，不复制状态。
 */
export default function TaskWorkbench({ task, meId, onChanged, onConflict }: { task: Task; meId: number | null; onChanged: (t: Task) => void; onConflict: () => void }) {
  const meta = useMeta();
  const flash = useFlash();
  const navigate = useNavigate();
  const isAssignee = meId != null && task.assignee?.id === meId;
  const isReviewer = meId != null && task.reviewer?.id === meId;
  const canSubmit = isAssignee && !['pending_review', 'done'].includes(task.exec_status);
  const canReview = isReviewer && task.exec_status === 'pending_review';
  const [tab, setTab] = useState<string>(canReview ? 'deliver' : 'detail');
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => { setTab(canReview || canSubmit ? 'deliver' : 'detail'); }, [task.id, canReview, canSubmit]);

  const bump = (t: Task) => { setRefreshKey((k) => k + 1); onChanged(t); };
  const handle = async (fn: () => Promise<Task>, ok: string) => {
    setBusy(true);
    try { bump(await fn()); flash({ type: 'success', content: ok }); } catch (e: any) {
      const msg = String(e.message ?? e);
      flash({ type: msg.startsWith('409') ? 'warning' : 'error', content: msg });
      if (msg.startsWith('409')) onConflict();
    } finally { setBusy(false); }
  };

  const detail = (
    <SpaceBetween size="m">
      <KeyValuePairs columns={2} items={[
        { label: '状态', value: <div><StatusIndicator type={statusIndicator(task.exec_status)}>{task.exec_status_label}</StatusIndicator>{task.exec_status === 'waiting' && <Box variant="small" color="text-body-secondary">等 {task.wait_for || '—'}：{task.wait_reason}{task.wait_until ? `，预计 ${dueText(task.wait_until)}` : ''}</Box>}{task.exec_status === 'done' && task.done_at && <Box variant="small" color="text-body-secondary">确认于 {dateTime(task.done_at)}</Box>}</div> },
        { label: '截止', value: task.due_at ? dueText(task.due_at) : <Box color="text-body-secondary">未设定</Box> },
        { label: '负责人', value: <PersonAvatar user={task.assignee} /> },
        { label: '审核人', value: task.reviewer ? <PersonAvatar user={task.reviewer} /> : '—' },
        { label: '所属位置', value: `${stageKeyLabel(meta?.stage_groups, task.stage_key, task.stage_label)}${task.stage_index > task.project_current_stage_index ? '，项目还没走到这里，可提前准备' : ''}` },
        { label: '证据判定', value: task.satisfied ? <div><StatusIndicator type="success">已满足</StatusIndicator>{task.satisfied_evidence && <Box variant="small" color="text-body-secondary">{task.satisfied_evidence}</Box>}</div> : <Box color="text-body-secondary">未满足</Box> },
      ]} />
      {task.purpose && <div><Box fontWeight="bold">这件事是</Box><Box>{task.purpose}</Box></div>}
      {task.deliverable && <div><Box fontWeight="bold">要交</Box><Box>{task.deliverable.label}{task.requires_file ? '' : '（交说明即可）'}</Box></div>}
      {task.done_when && <div><Box fontWeight="bold">怎么算满足</Box><Box>{task.done_when}</Box></div>}
      <SpaceBetween direction="horizontal" size="xs">
        {statusActions(task, meId).map((a) => (
          a === 'start' ? <Button key={a} variant="primary" loading={busy} onClick={() => handle(() => api.taskStatus(task.project_id, task.id, { version: task.version, action: 'start' }), `已开始「${task.title}」`)}>开始处理</Button>
            : a === 'resume' ? <Button key={a} variant="primary" loading={busy} onClick={() => handle(() => api.taskStatus(task.project_id, task.id, { version: task.version, action: 'resume' }), `已恢复「${task.title}」`)}>恢复处理</Button>
              : <Button key={a} onClick={() => setWaiting(true)}>记录等待</Button>
        ))}
        {canSubmit && <Button onClick={() => setTab('deliver')}>去交付</Button>}
        <Button variant="link" onClick={() => navigate(`/projects/${task.project_id}?tab=overview`)}>项目总览</Button>
      </SpaceBetween>
      {task.exec_status === 'done' && task.satisfied === false && <Alert type="warning">审核人已确认完成，但项目里还没有对应证据（{task.deliverable?.label ?? '交付物'}）。两者并列显示，不互相替代。</Alert>}
    </SpaceBetween>
  );

  return (
    <SpaceBetween size="m">
      <Tabs
        activeTabId={tab}
        onChange={({ detail }) => setTab(detail.activeTabId)}
        tabs={[
          { id: 'detail', label: '详情', content: detail },
          { id: 'deliver', label: canReview ? '审核' : '交付', content: <DeliverTab task={task} meId={meId} canSubmit={canSubmit} canReview={canReview} busy={busy} onAction={handle} /> },
          { id: 'history', label: '活动记录', content: <TaskTimeline projectId={task.project_id} taskId={task.id} refreshKey={refreshKey} /> },
        ]}
      />
      {waiting && <TaskWaitModal task={task} onDone={(t) => { setWaiting(false); bump(t); flash({ type: 'success', content: `已记录等待：${t.title}` }); }} onConflict={() => { setWaiting(false); onConflict(); }} onDismiss={() => setWaiting(false)} />}
    </SpaceBetween>
  );
}

function SubmissionList({ subs }: { subs: Submission[] }) {
  if (!subs.length) return null;
  return (
    <ExpandableSection headerText={`提交记录（${subs.length}）`} variant="footer" defaultExpanded={subs.length <= 2}>
      <SpaceBetween size="s">
        {subs.map((s) => (
          <div key={s.id} className="ui-submission">
            <div><Box variant="span" fontWeight="bold">第 {s.seq} 次</Box>　<StatusIndicator type={s.decision === 'confirmed' ? 'success' : s.decision === 'returned' ? 'error' : 'pending'}>{s.decision_label}</StatusIndicator></div>
            <Box variant="small" color="text-body-secondary">{s.submitted_by?.display_name ?? '—'} · {dateTime(s.submitted_at)}{s.note ? ` · ${s.note}` : ''}</Box>
            {s.files.length > 0 && <Box variant="small">{s.files.map((f) => <span key={f.id} className="ui-file-link"><Link href={`/api/files/${f.id}/download`} external>{f.filename}</Link></span>)}</Box>}
            {s.decision !== 'pending' && <Box variant="small" color="text-body-secondary">{s.decided_by?.display_name ?? '—'} · {dateTime(s.decided_at)}{s.decision_reason ? `：${s.decision_reason}` : ''}</Box>}
          </div>
        ))}
      </SpaceBetween>
    </ExpandableSection>
  );
}

function DeliverTab({ task, meId, canSubmit, canReview, busy, onAction }: { task: Task; meId: number | null; canSubmit: boolean; canReview: boolean; busy: boolean; onAction: (fn: () => Promise<Task>, ok: string) => Promise<void> }) {
  const [files, setFiles] = useState<FileRow[] | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const docType = task.deliverable?.doc_type ?? null;
  const loadFiles = () => api.files(task.project_id).then(setFiles).catch(() => setFiles([]));
  useEffect(() => { setPicked([]); setNote(''); setReason(''); if (canSubmit) loadFiles(); }, [task.id, canSubmit]); // eslint-disable-line react-hooks/exhaustive-deps
  const latest = task.submissions[0] ?? null;
  const candidates = (files ?? []).filter((f) => f.step_key === task.step_key || (docType && f.doc_type === docType));
  const others = (files ?? []).filter((f) => !candidates.includes(f));
  const requirement = (
    <Container embedded cardId="task-requirement" cardContext={task.title} header={<Header variant="h3">当前生效要求</Header>}>
      <SpaceBetween size="xs">
        <Box>{task.deliverable ? task.deliverable.label : '按任务说明处理'}{task.requires_file ? '' : '（交说明即可）'}</Box>
        {task.done_when && <Box variant="small" color="text-body-secondary">{task.done_when}</Box>}
      </SpaceBetween>
    </Container>
  );

  if (canReview && latest) {
    return (
      <SpaceBetween size="m">
        <Container embedded cardId="task-submission" cardContext={task.title} header={<Header variant="h2" description={`${latest.submitted_by?.display_name ?? '—'} · ${dateTime(latest.submitted_at)}`}>第 {latest.seq} 次提交</Header>}>
          <SpaceBetween size="s">
            {latest.note && <Box>{latest.note}</Box>}
            {latest.files.length ? latest.files.map((f) => (
              <div key={f.id} className="ui-file-choice">
                {(f.mime ?? '').startsWith('image/') && <img src={`/api/files/${f.id}/download`} alt="" className="ui-thumbnail ui-thumbnail-delivery" />}
                <div><Link href={`/api/files/${f.id}/download`} external>{f.filename}</Link><Box variant="small" color="text-body-secondary">{kb(f.size)}{f.uploaded_at ? ` · ${dateTime(f.uploaded_at)}` : ''}</Box></div>
              </div>
            )) : <Box color="text-body-secondary">没有文件，只交了说明。</Box>}
          </SpaceBetween>
        </Container>
        {requirement}
        <FormField label="审核意见（退回时必填）" description="写清修改要求，确认通过时可不填。" stretch>
          <Textarea value={reason} rows={3} onChange={({ detail }) => setReason(detail.value)} />
        </FormField>
        <SpaceBetween direction="horizontal" size="xs">
          <Button loading={busy} onClick={() => { if (!reason.trim()) { return; } onAction(() => api.returnTask(task.project_id, task.id, { version: task.version, reason: reason.trim() }), `已退回「${task.title}」`); }} disabled={!reason.trim()}>退回修改</Button>
          <Button variant="primary" loading={busy} onClick={() => onAction(() => api.confirmTask(task.project_id, task.id, { version: task.version, reason: reason.trim() || null }), `已确认「${task.title}」完成`)}>确认本次交付</Button>
        </SpaceBetween>
        <HelpText>确认后任务完成，工作台、项目总览、负责人的我的事项一起更新；关键节点的 D/J 确认不受影响。</HelpText>
        <SubmissionList subs={task.submissions.slice(1)} />
      </SpaceBetween>
    );
  }

  if (canSubmit) {
    return (
      <SpaceBetween size="m">
        {requirement}
        {latest?.decision === 'returned' && <Alert type="warning" header={`第 ${latest.seq} 次提交被退回`}>{latest.decision_reason}</Alert>}
        <FormField label={task.requires_file ? '本次交付的文件（至少一个）' : '附文件（可选）'} description="从这套房已上传的文件里勾，或现在上传。">
          {files === null ? <Box color="text-body-secondary">读取文件中…</Box> : (
            <SpaceBetween size="xs">
              {candidates.length === 0 && others.length === 0 && <Box color="text-body-secondary">这套房还没有文件。</Box>}
              {candidates.map((f) => <Checkbox key={f.id} checked={picked.includes(f.id)} onChange={({ detail }) => setPicked((p) => detail.checked ? [...p, f.id] : p.filter((x) => x !== f.id))}>{f.filename}<Box variant="span" color="text-body-secondary" fontSize="body-s">　{f.uploaded_by ?? '—'} · {dateTime(f.uploaded_at)}</Box></Checkbox>)}
              {others.length > 0 && (
                <ExpandableSection headerText={`这套房的其他文件（${others.length}）`} variant="footer">
                  <SpaceBetween size="xxs">
                    {others.map((f) => <Checkbox key={f.id} checked={picked.includes(f.id)} onChange={({ detail }) => setPicked((p) => detail.checked ? [...p, f.id] : p.filter((x) => x !== f.id))}>{f.filename}<Box variant="span" color="text-body-secondary" fontSize="body-s">　{f.doc_type ?? ''} · {dateTime(f.uploaded_at)}</Box></Checkbox>)}
                  </SpaceBetween>
                </ExpandableSection>
              )}
              <Button variant="normal" iconName="upload" onClick={() => setShowUpload((v) => !v)}>{showUpload ? '收起上传' : '上传新文件'}</Button>
              {showUpload && <Container embedded cardId="task-upload" cardContext={task.title}><UploadForm projectId={task.project_id} docType={docType ?? 'other'} lockType={!!docType} stepKey={task.step_key} photoOnly={task.deliverable?.kind === 'photo'} compact onDone={async () => { const before = new Set((files ?? []).map((f) => f.id)); const after = await api.files(task.project_id); setFiles(after); setPicked((p) => [...p, ...after.filter((f) => !before.has(f.id)).map((f) => f.id)]); setShowUpload(false); }} /></Container>}
            </SpaceBetween>
          )}
        </FormField>
        <FormField label={task.requires_file ? '交付说明（可选）' : '交付说明（必填）'} stretch>
          <Textarea value={note} rows={3} onChange={({ detail }) => setNote(detail.value)} placeholder={task.requires_file ? '例如：已补齐入口尺寸' : '写清做了什么、结果是什么'} />
        </FormField>
        <SpaceBetween direction="horizontal" size="xs">
          <Button variant="primary" loading={busy} disabled={(task.requires_file && !picked.length) || (!task.requires_file && !note.trim() && !picked.length)} onClick={() => onAction(() => api.submitTask(task.project_id, task.id, { version: task.version, note: note.trim() || null, file_ids: picked }), `已提交「${task.title}」，等 ${task.reviewer?.display_name ?? '审核人'} 确认`)}>提交审核</Button>
          <HelpText>上传不等于提交；提交后进入待确认，由 {task.reviewer?.display_name ?? '审核人'} 退回或确认。</HelpText>
        </SpaceBetween>
        <SubmissionList subs={task.submissions} />
      </SpaceBetween>
    );
  }

  return (
    <SpaceBetween size="m">
      {requirement}
      {task.exec_status === 'pending_review' && <Alert type="info">已提交，等 {task.reviewer?.display_name ?? '审核人'} 确认。</Alert>}
      {task.exec_status === 'done' && <Alert type="success">已由 {latest?.decided_by?.display_name ?? '审核人'} 确认完成{task.done_at ? `（${dateTime(task.done_at)}）` : ''}。</Alert>}
      {meId != null && !canSubmit && !canReview && task.exec_status !== 'done' && task.exec_status !== 'pending_review' && <Box color="text-body-secondary">这项任务由 {task.assignee?.display_name ?? '待分派'} 负责、{task.reviewer?.display_name ?? '未指定'} 审核；你只能看。</Box>}
      <SubmissionList subs={task.submissions} />
    </SpaceBetween>
  );
}
