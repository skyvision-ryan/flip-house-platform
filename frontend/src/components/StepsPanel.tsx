import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Alert from '@cloudscape-design/components/alert';
import Badge from '@cloudscape-design/components/badge';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Cards from '@cloudscape-design/components/cards';
import Checkbox from '@cloudscape-design/components/checkbox';
import DatePicker from '@cloudscape-design/components/date-picker';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import FormField from '@cloudscape-design/components/form-field';
import Grid from '@cloudscape-design/components/grid';
import Input from '@cloudscape-design/components/input';
import Link from '@cloudscape-design/components/link';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Textarea from '@cloudscape-design/components/textarea';
import { api, FileRow, StepItem, Steps } from '../api/client';
import { useFlash } from '../lib/flash';
import { useRole } from '../lib/role';
import {
  FIELD_LABEL,
  actionHref,
  actionLabel,
  actionMode,
  canActOn,
  canConfirm,
  findStageKey,
  findStepItem,
  nextUpFlash,
} from '../lib/stepActions';
import { contextNotes, factOf, limitsOf } from '../lib/stepDisplay';
import { OwnerDot, OwnerNames } from './OwnerTag';
import TaskDetail from './TaskDetail';
import UploadForm from './UploadForm';

type Stage = Steps['stages'][number];

export type StepsDeepLink = { step?: string | null; action?: string | null };

const stageState = (i: number, curIdx: number, complete: boolean) =>
  complete || i < curIdx ? 'done' : i === curIdx ? 'current' : 'future';

/**
 * 总览 B：这套房现在怎么走。
 * 四块——当前阶段 / 我负责的 / 关键节点 / 本段其余事项。
 * 只陈述后端 compute_steps 给的事实，不推导「进行中」「等待某人」这类状态。
 */
export default function StepsPanel({
  projectId,
  onChanged,
  deepLink,
}: {
  projectId: number;
  onChanged?: () => void;
  deepLink?: StepsDeepLink;
}) {
  const flash = useFlash();
  const navigate = useNavigate();
  const role = useRole();
  const [steps, setSteps] = useState<Steps | null>(null);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<StepItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<{ kind: 'upload' | 'field'; it: StepItem } | null>(null);
  const [fieldVal, setFieldVal] = useState('');
  const [saving, setSaving] = useState(false);
  const appliedDeep = useRef<string | null>(null);
  const gateRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(() => api.steps(projectId).then(setSteps), [projectId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.files(projectId).then(setFiles).catch(() => setFiles([])); }, [projectId]);

  // 深链：工作台「轮到谁」「待我确认的门」和我的待办都靠 ?step=&action= 落到这里。
  useEffect(() => {
    if (!steps || !deepLink?.step) return;
    const token = `${deepLink.step}:${deepLink.action ?? ''}`;
    if (appliedDeep.current === token) return;
    const it = findStepItem(steps, deepLink.step);
    if (!it) return;
    const sk = findStageKey(steps, deepLink.step);
    if (sk) setSelected(sk);
    appliedDeep.current = token;
    const act = deepLink.action;
    if (act === 'upload' && (it.deliverable?.kind === 'file' || it.deliverable?.kind === 'photo')) setModal({ kind: 'upload', it });
    else if (act === 'field' && it.deliverable?.kind === 'field') { setFieldVal(''); setModal({ kind: 'field', it }); }
    else if (act === 'confirm') requestAnimationFrame(() => gateRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    else setDetail(it);
  }, [steps, deepLink?.step, deepLink?.action]);

  if (!steps) return <Box textAlign="center" padding="m"><Spinner /></Box>;

  const cur = steps.current_stage;
  const complete = cur.key === 'done';
  const curIdx = complete ? steps.stages.length : steps.stages.findIndex((s) => s.key === cur.key);
  const selKey = selected ?? (complete ? steps.stages[steps.stages.length - 1].key : cur.key);
  const selIdx = Math.max(0, steps.stages.findIndex((s) => s.key === selKey));
  const stage: Stage = steps.stages[selIdx];
  const isFuture = stageState(selIdx, curIdx, complete) === 'future';

  const reloadAll = () => {
    load();
    api.files(projectId).then(setFiles).catch(() => undefined);
    onChanged?.();
  };

  const toggle = async (key: string, done: boolean, confirmAs?: string, doneTitle?: string) => {
    setBusy(confirmAs ? `${key}:${confirmAs}` : key);
    try {
      const next = await api.toggleStep(projectId, key, { done, confirm_as: confirmAs ?? null });
      setSteps(next);
      if (done && doneTitle) flash({ type: 'success', content: nextUpFlash(doneTitle, next) });
      else flash({ type: 'success', content: confirmAs ? `${confirmAs} ${done ? '已确认' : '取消了确认'}` : `${role.actor} ${done ? '已勾' : '已取消'}` });
      setDetail(null);
      reloadAll();
    } catch (e: any) {
      flash({ type: 'error', content: e.message });
    } finally {
      setBusy(null);
    }
  };

  const saveField = async () => {
    if (modal?.kind !== 'field' || !modal.it.deliverable?.field) return;
    setSaving(true);
    try {
      const f = modal.it.deliverable.field;
      await api.patchProject(projectId, { [f]: f === 'purchase_price' ? Number(fieldVal) : fieldVal || null });
      const next = await api.steps(projectId);
      setSteps(next);
      flash({ type: 'success', content: nextUpFlash(modal.it.title, next) });
      setModal(null);
      setDetail(null);
      reloadAll();
    } catch (e: any) {
      flash({ type: 'error', content: e.message });
    } finally {
      setSaving(false);
    }
  };

  const openPrimary = (it: StepItem) => {
    const forConfirm = it.gate && it.confirm.length > 0;
    const mode = actionMode(it, { forConfirm });
    if (mode === 'navigate' || mode === 'view') { navigate(actionHref(projectId, it, { forConfirm })); return; }
    if (mode === 'tick') { toggle(it.key, true, undefined, it.title); return; }
    if (mode === 'upload') { setModal({ kind: 'upload', it }); return; }
    if (mode === 'field') { setFieldVal(''); setModal({ kind: 'field', it }); return; }
    if (mode === 'confirm') {
      setDetail(null);
      requestAnimationFrame(() => gateRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }
  };

  /** 关键节点的确认框：D、J 各一个，后端仍会再校验一次。 */
  const confirmBoxes = (it: StepItem) => (
    <SpaceBetween direction="horizontal" size="s">
      {it.confirm.map((c) => {
        const on = it.confirmed.includes(c);
        const allowed = !isFuture && (role.actor === c || role.can('confirm_for_others'));
        return (
          <Checkbox
            key={c}
            checked={on}
            disabled={!allowed || busy === `${it.key}:${c}`}
            onChange={({ detail: d }) => toggle(it.key, d.checked, c, it.title)}
          >
            <Box variant="span"><OwnerDot code={c} />{on ? '已确认' : '确认'}</Box>
          </Checkbox>
        );
      })}
    </SpaceBetween>
  );

  const primaryFor = (it: StepItem) => {
    if (isFuture) return null;
    if (it.gate && it.confirm.length > 0) return confirmBoxes(it);
    if (!it.deliverable || it.done) return null;
    if (!canActOn(it, role)) return null;
    const mode = actionMode(it);
    if (mode === 'view') return null;
    return (
      <Button
        iconName={mode === 'upload' ? 'upload' : mode === 'field' ? 'edit' : undefined}
        disabled={busy === it.key}
        onClick={() => openPrimary(it)}
      >
        {actionLabel(it, { actor: role.actor, canDo: true })}
      </Button>
    );
  };

  /** 一组事项，每张卡一件事。Cards 自己按宽度收，窄屏一列。 */
  const taskCards = (items: StepItem[], empty: string) => (
    <Cards
      items={items}
      trackBy="key"
      cardsPerRow={[{ cards: 1 }, { minWidth: 820, cards: 2 }]}
      empty={<Box color="text-body-secondary" padding="s">{empty}</Box>}
      cardDefinition={{
        header: (it: StepItem) => (
          <Link href="#" onFollow={(e) => { e.preventDefault(); setDetail(it); }}>{it.title}</Link>
        ),
        sections: [
          {
            id: 'who',
            content: (it: StepItem) => (
              <SpaceBetween size="xxs">
                <OwnerNames codes={it.owners} prefix="负责角色：" />
                {it.ws && <Box fontSize="body-s" color="text-body-secondary">{it.ws}</Box>}
              </SpaceBetween>
            ),
          },
          {
            id: 'fact',
            content: (it: StepItem) => {
              const fact = factOf(it);
              return (
                <SpaceBetween size="xxs">
                  <StatusIndicator type={fact.indicator}>{fact.label}</StatusIndicator>
                  {fact.basis.map((b) => (
                    <Box key={b} fontSize="body-s" color="text-body-secondary">依据：{b}</Box>
                  ))}
                  {fact.hint && <Box fontSize="body-s" color="text-body-secondary">{fact.hint}</Box>}
                </SpaceBetween>
              );
            },
          },
          {
            id: 'act',
            content: (it: StepItem) => {
              // 已经判定满足的项不再提示操作限制——那只是取消勾会被拒，对看页面的人是噪音。
              const limits = it.done ? [] : limitsOf(it, role.actor, role.can('tick_any'), it.owners.includes(role.actor));
              const btn = primaryFor(it);
              if (!btn && !limits.length && !it.deliverable) return null;
              return (
                <SpaceBetween size="xs">
                  {it.deliverable && !it.done && it.deliverable.kind !== 'confirm' && (
                    <Box fontSize="body-s" color="text-body-secondary">要交：{it.deliverable.label}</Box>
                  )}
                  {btn}
                  {limits.map((l) => (
                    <Box key={l} fontSize="body-s" color="text-status-info">{l}</Box>
                  ))}
                </SpaceBetween>
              );
            },
          },
        ],
      }}
    />
  );

  const gates = stage.items.filter((i) => i.gate && i.confirm.length > 0);
  const mine = stage.items.filter((i) => !i.done && !i.gate && i.owners.includes(role.actor));
  const mineKeys = new Set(mine.map((i) => i.key));
  const rest = stage.items.filter((i) => !gates.includes(i) && !mineKeys.has(i.key));
  const notes = contextNotes(steps, stage.key);

  return (
    <SpaceBetween size="l">
      {/* ① 当前阶段 */}
      <SpaceBetween size="s">
        <Box fontSize="heading-s" fontWeight="bold">
          {complete ? '这套房全流程走完了' : `这套房在${cur.label}`}
          <Box variant="span" fontWeight="normal" color="text-body-secondary">
            {`　${stage.label}共 ${stage.total} 项，系统判定已满足 ${stage.done_count} 项`}
          </Box>
        </Box>
        <Grid gridDefinition={steps.stages.map(() => ({ colspan: { default: 6, xs: 4, s: 2 } }))}>
          {steps.stages.map((st, i) => {
            const state = stageState(i, curIdx, complete);
            const on = st.key === selKey;
            return (
              <SpaceBetween size="xxs" key={st.key}>
                <Box fontWeight={on ? 'bold' : 'normal'}>
                  <Link href="#" onFollow={(e) => { e.preventDefault(); setSelected(st.key); }}>{st.short}</Link>
                </Box>
                <StatusIndicator type={state === 'done' ? 'success' : state === 'current' ? 'info' : 'pending'}>
                  {state === 'done' ? '已过' : state === 'current' ? '在这一段' : '还没到'}
                </StatusIndicator>
                <Box fontSize="body-s" color="text-body-secondary">{st.done_count} / {st.total} 项</Box>
                {st.gate_title && <Badge color={st.gate_done ? 'green' : 'grey'}>{st.gate_title}</Badge>}
              </SpaceBetween>
            );
          })}
        </Grid>
      </SpaceBetween>

      {/* ② 我负责的 */}
      {mine.length > 0 && (
        <SpaceBetween size="xs">
          <Box fontSize="heading-xs" fontWeight="bold">我负责的（{mine.length}）</Box>
          {taskCards(mine, '')}
        </SpaceBetween>
      )}

      {/* ③ 关键节点 */}
      {gates.length > 0 && (
        <SpaceBetween size="xs">
          <Box fontSize="heading-xs" fontWeight="bold">关键节点</Box>
          <div ref={gateRef}>{taskCards(gates, '')}</div>
        </SpaceBetween>
      )}

      {/* ④ 本段其余事项 */}
      {rest.length > 0 && (
        <ExpandableSection
          variant="footer"
          headerText={`${stage.label}其余事项（${rest.length}）`}
          defaultExpanded={Boolean(deepLink?.step)}
        >
          {taskCards(rest, '')}
        </ExpandableSection>
      )}

      {/* 上下文提醒：不是阻塞，只是让人知道同一时间还有什么在等人确认 */}
      {notes.length > 0 && (
        <Alert type="info">
          <SpaceBetween size="xxs">
            {notes.map((n) => <Box key={n}>{n}</Box>)}
          </SpaceBetween>
        </Alert>
      )}

      <TaskDetail
        item={detail}
        stageLabel={stage.label}
        files={files}
        onPrimary={(it) => openPrimary(it)}
        onDismiss={() => setDetail(null)}
      />

      <Modal
        visible={modal?.kind === 'upload'}
        onDismiss={() => setModal(null)}
        header={modal?.kind === 'upload' ? `${modal.it.deliverable?.kind === 'photo' ? '交照片' : '交文件'}：${modal.it.title}` : ''}
      >
        {modal?.kind === 'upload' && (
          <UploadForm
            projectId={projectId}
            docType={modal.it.deliverable?.doc_type ?? 'other'}
            lockType
            stepKey={modal.it.key}
            photoOnly={modal.it.deliverable?.kind === 'photo'}
            compact
            onDone={async () => {
              const title = modal.it.title;
              setModal(null);
              setDetail(null);
              const next = await api.steps(projectId);
              setSteps(next);
              flash({ type: 'success', content: nextUpFlash(title, next) });
              reloadAll();
            }}
          />
        )}
      </Modal>

      <Modal
        visible={modal?.kind === 'field'}
        onDismiss={() => setModal(null)}
        header={modal?.kind === 'field' ? `${modal.it.title}：${FIELD_LABEL[modal.it.deliverable?.field ?? ''] ?? ''}` : ''}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setModal(null)}>取消</Button>
              <Button variant="primary" loading={saving} disabled={!fieldVal} onClick={saveField}>保存</Button>
            </SpaceBetween>
          </Box>
        }
      >
        {modal?.kind === 'field' && (
          <FormField label={FIELD_LABEL[modal.it.deliverable?.field ?? ''] ?? ''}>
            {modal.it.deliverable?.field?.endsWith('_date')
              ? <DatePicker value={fieldVal} onChange={({ detail: d }) => setFieldVal(d.value)} placeholder="YYYY/MM/DD" />
              : modal.it.deliverable?.field === 'risks'
                ? <Textarea value={fieldVal} rows={3} onChange={({ detail: d }) => setFieldVal(d.value)} placeholder="死亡记录、unpermitted sqft、其他常见风险" />
                : <Input type="number" value={fieldVal} onChange={({ detail: d }) => setFieldVal(d.value)} />}
          </FormField>
        )}
      </Modal>
    </SpaceBetween>
  );
}
