import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import DatePicker from '@cloudscape-design/components/date-picker';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Textarea from '@cloudscape-design/components/textarea';
import { api, StepItem, Steps } from '../api/client';
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
  statusHint,
} from '../lib/stepActions';
import { OwnerDot } from './OwnerTag';
import UploadForm from './UploadForm';

type Stage = Steps['stages'][number];
type StageState = 'done' | 'current' | 'future';

const shortDate = (iso: string | null | undefined) => (iso ? iso.slice(5, 10).replace('-', '/') : '');
const BLUE = '#0972d3', GREEN = '#037f0c', GREY = '#8d99a8', TEXT2 = '#5f6b7a', BORDER = '#e9ebed', WARN = '#8d6605';

function StageCard({ st, index, state, selected, waitingOn, onSelect }: { st: Stage; index: number; state: StageState; selected: boolean; waitingOn: string[]; onSelect: () => void }) {
  const gateLine = () => {
    if (st.gate_done) return <span style={{ color: TEXT2 }}>◆ {st.gate_title}{st.gate_at ? ` · ${shortDate(st.gate_at)}` : ''}</span>;
    if (state === 'current') {
      const waiting = ['D', 'J'].filter((c) => !st.gate_confirmed.includes(c));
      return <span style={{ color: WARN, fontWeight: 600 }}>◆ {st.gate_confirmed.length ? `${st.gate_confirmed.join('、')} 已确认，等 ${waiting.join('、')}` : `待 D、J 确认`}</span>;
    }
    return <span style={{ color: GREY }}>◆ {st.gate_title}</span>;
  };
  return (
    <div
      role="button" tabIndex={0} onClick={onSelect} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      aria-pressed={selected}
      style={{
        position: 'relative', flex: '1 1 130px', minWidth: 120, background: '#fff', borderRadius: 12, padding: '10px 12px 10px 14px', cursor: 'pointer',
        border: `${state === 'current' ? 2 : 1}px solid ${state === 'current' ? BLUE : BORDER}`,
        boxShadow: selected ? `0 0 0 3px ${state === 'current' ? 'rgba(9,114,211,.18)' : 'rgba(9,114,211,.25)'}` : '0 1px 2px rgba(0,7,22,.06)',
        color: state === 'future' ? GREY : 'inherit', transition: 'box-shadow .15s',
      }}
    >
      {state === 'done' && <span style={{ position: 'absolute', left: 0, top: 10, bottom: 10, width: 4, borderRadius: 2, background: GREEN }} />}
      <div style={{ fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'baseline', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden' }}>
        <span>{['①', '②', '③', '④', '⑤', '⑥'][index]}</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{st.short}</span>
      </div>
      <div style={{ marginTop: 6, fontSize: 13 }}>
        {state === 'done' ? <span style={{ color: GREEN, fontWeight: 600 }}>✓ 已完成</span>
          : state === 'current' ? <span style={{ color: BLUE, fontWeight: 700 }}>● 进行中</span>
          : <span>还没到</span>}
      </div>
      <div style={{ marginTop: 2, fontSize: 13, color: state === 'future' ? GREY : TEXT2, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', overflow: 'hidden' }}>
        {state === 'current' ? <><span>{st.done_count} / {st.total} 件</span>{waitingOn.length > 0 && <span>· 轮到 {waitingOn.map((o) => <OwnerDot key={o} code={o} />)}</span>}</> : <span>{st.total} 件</span>}
      </div>
      <div style={{ marginTop: 8, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{gateLine()}</div>
    </div>
  );
}

export type StepsDeepLink = { step?: string | null; action?: string | null };

/** 总览 B：默认眼前工作；完整清单折叠。 */
export default function StepsPanel({ projectId, onChanged, deepLink }: { projectId: number; onChanged?: () => void; deepLink?: StepsDeepLink }) {
  const flash = useFlash();
  const navigate = useNavigate();
  const role = useRole();
  const [steps, setSteps] = useState<Steps | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<{ kind: 'upload'; it: StepItem } | { kind: 'field'; it: StepItem } | null>(null);
  const [fieldVal, setFieldVal] = useState('');
  const [saving, setSaving] = useState(false);
  const appliedDeep = useRef<string | null>(null);
  const gateRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(() => api.steps(projectId).then(setSteps), [projectId]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!steps || !deepLink?.step) return;
    const token = `${deepLink.step}:${deepLink.action ?? ''}`;
    if (appliedDeep.current === token) return;
    const it = findStepItem(steps, deepLink.step);
    if (!it) return;
    const sk = findStageKey(steps, deepLink.step);
    if (sk) setSelected(sk);
    appliedDeep.current = token;
    const act = deepLink.action ?? actionMode(it, { forConfirm: it.gate && it.confirm.length > 0 });
    if (act === 'upload' && (it.deliverable?.kind === 'file' || it.deliverable?.kind === 'photo')) setModal({ kind: 'upload', it });
    else if (act === 'field' && it.deliverable?.kind === 'field') { setFieldVal(''); setModal({ kind: 'field', it }); }
    else if (act === 'confirm' || it.gate) {
      requestAnimationFrame(() => gateRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }
  }, [steps, deepLink?.step, deepLink?.action]);

  if (!steps) return <Box textAlign="center" padding="m"><Spinner /></Box>;

  const cur = steps.current_stage;
  const complete = cur.key === 'done';
  const curIdx = complete ? steps.stages.length : steps.stages.findIndex((s) => s.key === cur.key);
  const stateOf = (i: number): StageState => (complete || i < curIdx ? 'done' : i === curIdx ? 'current' : 'future');
  const selKey = selected ?? (complete ? steps.stages[steps.stages.length - 1].key : cur.key);
  const selIdx = Math.max(0, steps.stages.findIndex((s) => s.key === selKey));
  const stage = steps.stages[selIdx];
  const selState = stateOf(selIdx);
  const changed = () => { load(); onChanged?.(); };

  const toggle = async (key: string, done: boolean, confirmAs?: string, doneTitle?: string) => {
    setBusy(confirmAs ? `${key}:${confirmAs}` : key);
    try {
      const next = await api.toggleStep(projectId, key, { done, confirm_as: confirmAs ?? null });
      setSteps(next);
      if (done && doneTitle) flash({ type: 'success', content: nextUpFlash(doneTitle, next) });
      else flash({ type: 'success', content: confirmAs ? `${confirmAs} ${done ? '已确认' : '取消了确认'}${confirmAs !== role.actor ? `（${role.actor} 代勾）` : ''}` : `${role.actor} ${done ? '已勾' : '已取消'}` });
      onChanged?.();
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
      onChanged?.();
    } catch (e: any) {
      flash({ type: 'error', content: e.message });
    } finally {
      setSaving(false);
    }
  };

  const openPrimary = (it: StepItem) => {
    const forConfirm = it.gate || it.deliverable?.kind === 'confirm';
    const mode = actionMode(it, { forConfirm });
    if (mode === 'navigate' || mode === 'view') {
      navigate(actionHref(projectId, it, { forConfirm }));
      return;
    }
    if (mode === 'tick') { toggle(it.key, true, undefined, it.title); return; }
    if (mode === 'upload') { setModal({ kind: 'upload', it }); return; }
    if (mode === 'field') { setFieldVal(''); setModal({ kind: 'field', it }); return; }
    if (mode === 'confirm') {
      setSelected(findStageKey(steps, it.key));
      requestAnimationFrame(() => gateRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }
  };

  const action = (it: StepItem) => {
    const dv = it.deliverable;
    if (!dv || selState === 'future') return null;
    if (it.gate) return null;
    if (!canActOn(it, role)) return <Box color="text-body-secondary" fontSize="body-s">等 {it.owners.join('、')}</Box>;
    const label = actionLabel(it, { actor: role.actor, canDo: true });
    const mode = actionMode(it);
    if (mode === 'tick') return <Checkbox checked={false} disabled={busy === it.key} onChange={() => toggle(it.key, true, undefined, it.title)}>标完成</Checkbox>;
    if (mode === 'upload') return <Button iconName="upload" onClick={() => setModal({ kind: 'upload', it })}>{label}</Button>;
    if (mode === 'field') return <Button iconName="edit" onClick={() => { setFieldVal(''); setModal({ kind: 'field', it }); }}>{label}</Button>;
    if (mode === 'navigate') {
      if (dv.record === 'inspections') return <Button onClick={() => navigate(actionHref(projectId, it))}>{label}</Button>;
      return <Button iconName="external" onClick={() => navigate(actionHref(projectId, it))}>{label}</Button>;
    }
    return null;
  };

  const segments: ({ kind: 'items'; items: StepItem[] } | { kind: 'gate'; it: StepItem })[] = [];
  for (const it of stage.items) {
    if (it.gate && it.confirm.length) segments.push({ kind: 'gate', it });   // 证据型门（如上市）当普通行
    else {
      const last = segments[segments.length - 1];
      if (last && last.kind === 'items') last.items.push(it); else segments.push({ kind: 'items', items: [it] });
    }
  }

  const section = (items: StepItem[], suffix: string) => {
    const dones = items.filter((i) => i.done);
    const todos = items.filter((i) => !i.done);
    return (
      <>
        {dones.length > 0 && (
          <>
            <Box variant="small" color="text-body-secondary" padding={{ top: 'xxs' }}>已完成{suffix && <><br />{suffix}</>}</Box>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {dones.map((it) => (
                <span key={it.key} title={it.how === 'auto' ? (it.evidence ?? '') : it.how === 'manual_override' ? (it.evidence ?? '手工确认，没有交付证据') : `${it.done_by ?? ''} 勾的${it.note ? `：${it.note}` : ''}`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px 3px 8px', borderRadius: 14, background: '#f2fcf3', border: '1px solid #cfe9d3', fontSize: 13, cursor: 'help' }}>
                  <span style={{ color: it.how === 'manual_override' ? WARN : GREEN, fontWeight: 700 }}>{it.how === 'manual_override' ? '✓?' : '✓'}</span>{it.title}
                  <span style={{ color: TEXT2, fontSize: 12 }}>{it.done_by?.replace(/（.*）/, '') ?? it.owners[0]}{it.done_at ? ` ${shortDate(it.done_at)}` : ''}</span>
                </span>
              ))}
            </div>
          </>
        )}
        {todos.length > 0 && (
          <>
            <Box variant="small" color="text-body-secondary" padding={{ top: 'xs' }}>{selState === 'future' ? '要做的' : '还差'}{suffix && <><br />{suffix}</>}</Box>
            <div>
              {todos.map((it) => (
                <div key={it.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 1fr) minmax(120px, 1fr) auto', gap: 12, alignItems: 'center', padding: '8px 4px', borderTop: `1px solid ${BORDER}` }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: selState === 'future' ? GREY : 'inherit' }}>{it.owners.map((o) => <OwnerDot key={o} code={o} />)}<span style={{ marginLeft: 2 }}>{it.title}</span></span>
                  <Box variant="small" color="text-body-secondary">{it.deliverable && it.deliverable.kind !== 'tick' ? `要交：${it.deliverable.label}` : '做完打勾'}</Box>
                  <span>{action(it)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </>
    );
  };

  const gateRow = (gate: StepItem) => (
    <>
      <Box variant="small" color="text-body-secondary" padding={{ top: 's' }}>大节点</Box>
      <div ref={deepLink?.step === gate.key ? gateRef : undefined} style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 1fr) minmax(120px, 1fr) auto', gap: 12, alignItems: 'center', padding: '10px 12px', background: gate.done ? '#f2fcf3' : '#f8f8f8', borderRadius: 8, border: `1px solid ${gate.done ? '#cfe9d3' : BORDER}` }}>
        <span style={{ fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 10, height: 10, transform: 'rotate(45deg)', background: gate.done ? GREEN : '#fff', border: `2px solid ${gate.done ? GREEN : BLUE}`, borderRadius: 1, flexShrink: 0 }} />
          {gate.title}
        </span>
        <Box variant="small" color="text-body-secondary">{gate.evidence_hint ?? (gate.deliverable?.label ? `交付物：${gate.deliverable.label}` : '')}</Box>
        <SpaceBetween direction="horizontal" size="s" alignItems="center">
          {gate.confirm.map((c) => {
            const on = gate.confirmed.includes(c);
            const allowed = selState !== 'future' && (role.actor === c || role.can('confirm_for_others'));
            return (
              <Checkbox key={c} checked={on} disabled={!allowed || busy === `${gate.key}:${c}`} onChange={({ detail }) => toggle(gate.key, detail.checked, c, gate.title)}>
                <span style={{ display: 'inline-flex', alignItems: 'center' }}><OwnerDot code={c} />{on ? '已确认' : '确认'}</span>
              </Checkbox>
            );
          })}
        </SpaceBetween>
      </div>
    </>
  );

  const firstUndoneOwners = (st: Stage) => st.items.find((i) => !i.done)?.owners ?? [];
  const nextKey = steps.next_up[0]?.key;
  const focusItem = (nextKey && findStepItem(steps, nextKey)) || null;
  const primaryCan = focusItem ? (focusItem.gate ? canConfirm(focusItem, role) : canActOn(focusItem, role)) : false;

  return (
    <SpaceBetween size="l">
      {/* 当前工作（逻辑层）：保留主操作，不替代原五步卡视觉 */}
      <div>
        <Box fontSize="heading-s" fontWeight="bold" margin={{ bottom: 's' }}>
          {complete ? '这套房全流程走完了'
            : !focusItem && steps.earlier_undone.length > 0 ? <>最后一段做完了<Box variant="span" fontWeight="normal" color="text-status-warning">，但前面还有 {steps.earlier_undone.length} 项没确认</Box></>
            : <>现在在{cur.label}{focusItem && <Box variant="span" fontWeight="normal" color="text-body-secondary"> · 轮到 {focusItem.owners.map((o) => <OwnerDot key={o} code={o} />)}{focusItem.title}</Box>}</>}
        </Box>

        {focusItem && (
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: '12px 14px', background: '#fff', marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <Box variant="small" color="text-body-secondary">{statusHint(focusItem)}</Box>
              <span>
                {focusItem.gate ? (
                  <SpaceBetween direction="horizontal" size="s">
                    {focusItem.confirm.map((c) => {
                      const on = focusItem.confirmed.includes(c);
                      const allowed = role.actor === c || role.can('confirm_for_others');
                      return (
                        <Checkbox key={c} checked={on} disabled={!allowed || busy === `${focusItem.key}:${c}`} onChange={({ detail }) => toggle(focusItem.key, detail.checked, c, focusItem.title)}>
                          <span style={{ display: 'inline-flex', alignItems: 'center' }}><OwnerDot code={c} />{on ? '已确认' : '确认'}</span>
                        </Checkbox>
                      );
                    })}
                  </SpaceBetween>
                ) : primaryCan ? (
                  <Button variant="primary" onClick={() => openPrimary(focusItem)}>
                    {actionLabel(focusItem, { actor: role.actor, canDo: true })}
                  </Button>
                ) : (
                  <Box color="text-body-secondary" fontSize="body-s">等 {focusItem.owners.join('、')} 处理</Box>
                )}
              </span>
            </div>
          </div>
        )}

        {steps.earlier_undone.length > 0 && (
          <ExpandableSection variant="footer" headerText={<StatusIndicator type="warning">前面还有 {steps.earlier_undone.length} 项没确认</StatusIndicator> as any}>
            <SpaceBetween size="xxs">
              {steps.earlier_undone.map((e) => {
                const k = steps.stages.find((s) => s.items.some((i) => i.key === e.key))?.key;
                return (
                  <Box key={e.key} fontSize="body-s">
                    {e.owners.map((o) => <OwnerDot key={o} code={o} />)}
                    <Button variant="inline-link" onClick={() => k && setSelected(k)}>{e.title}</Button>
                    <Box variant="span" color="text-body-secondary">　{e.stage}</Box>
                  </Box>
                );
              })}
            </SpaceBetween>
          </ExpandableSection>
        )}
      </div>

      {/* 原视觉：五张步卡常显；段明细默认折叠，避免与上方当前事项重复抢注意力 */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {steps.stages.map((st, i) => (
          <StageCard key={st.key} st={st} index={i} state={stateOf(i)} selected={st.key === selKey} waitingOn={stateOf(i) === 'current' ? firstUndoneOwners(st) : []} onSelect={() => setSelected(st.key)} />
        ))}
      </div>

      <ExpandableSection
        variant="container"
        headerText={`${stage.label} · 明细 ${stage.done_count}/${stage.total}`}
        defaultExpanded={Boolean(deepLink?.step)}
      >
        <div>
          <Box fontWeight="bold" fontSize="heading-xs" margin={{ bottom: 's' }}>
            {selState === 'done' ? '已完成' : selState === 'current' ? '进行中' : '还没到'}
          </Box>
          <div style={{ display: 'grid', gridTemplateColumns: '56px minmax(0, 1fr)', rowGap: 12, columnGap: 8, alignItems: 'start' }}>
            {segments.map((seg, si) => seg.kind === 'items' ? (
              <span key={`s${si}`} style={{ display: 'contents' }}>{section(seg.items, si > 0 ? '过门之后' : '')}</span>
            ) : (
              <span key={`g${si}`} style={{ display: 'contents' }}>{gateRow(seg.it)}</span>
            ))}
          </div>
          {selState === 'future' && <Box margin={{ top: 's' }} color="text-body-secondary" fontSize="body-s">这一步还没到，先把前面的走完。</Box>}
        </div>
      </ExpandableSection>

      <Modal visible={modal?.kind === 'upload'} onDismiss={() => setModal(null)} size="large"
        header={modal?.kind === 'upload' ? `${modal.it.deliverable?.kind === 'photo' ? '交照片' : '交文件'}：${modal.it.title} · ${modal.it.deliverable?.label}` : ''}>
        {modal?.kind === 'upload' && (
          <UploadForm projectId={projectId} docType={modal.it.deliverable?.doc_type ?? 'other'} lockType stepKey={modal.it.key} photoOnly={modal.it.deliverable?.kind === 'photo'} compact onDone={async () => {
            const title = modal.it.title;
            setModal(null);
            const next = await api.steps(projectId);
            setSteps(next);
            flash({ type: 'success', content: nextUpFlash(title, next) });
            onChanged?.();
          }} />
        )}
      </Modal>
      <Modal visible={modal?.kind === 'field'} onDismiss={() => setModal(null)}
        header={modal?.kind === 'field' ? `${modal.it.title}：${FIELD_LABEL[modal.it.deliverable?.field ?? ''] ?? ''}` : ''}
        footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button variant="link" onClick={() => setModal(null)}>取消</Button><Button variant="primary" loading={saving} disabled={!fieldVal} onClick={saveField}>保存</Button></SpaceBetween></Box>}>
        {modal?.kind === 'field' && (
          <FormField label={FIELD_LABEL[modal.it.deliverable?.field ?? ''] ?? ''}>
            {modal.it.deliverable?.field?.endsWith('_date') ? <DatePicker value={fieldVal} onChange={({ detail }) => setFieldVal(detail.value)} placeholder="YYYY/MM/DD" />
              : modal.it.deliverable?.field === 'risks' ? <Textarea value={fieldVal} rows={3} onChange={({ detail }) => setFieldVal(detail.value)} placeholder="死亡记录、unpermitted sqft、其他常见风险" />
              : <Input type="number" value={fieldVal} onChange={({ detail }) => setFieldVal(detail.value)} />}
          </FormField>
        )}
      </Modal>
    </SpaceBetween>
  );
}
