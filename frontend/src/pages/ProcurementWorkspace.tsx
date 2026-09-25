import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import TextFilter from '@cloudscape-design/components/text-filter';
import { useSearchParams, useNavigate } from 'react-router-dom';
import ProcurementTracker from '../components/ProcurementTracker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ProcurementItem, type ProcurementWorkspaceData, type ProcurementImage } from '../api/client';
import ProcurementOrderFields from '../components/ProcurementOrderFields';
import ProcurementFields from '../components/ProcurementFields';
import CollaborationWorkspace from '../components/ui/CollaborationWorkspace';
import FormField from '../components/ui/FormField';
import Header from '../components/ui/Header';
import { ExpandableSection, Table } from '../components/ui/Surface';
import { useFlash } from '../lib/flash';
import { money } from '../lib/format';
import { useMeta } from '../lib/meta';
import { procurementWorkGroups, procurementWorkGroup, deliveryLabel, procurementChanges, procurementDraft, procurementError, type ProcurementDraft } from '../lib/procurement';

const tone = (status: string) => status === 'exception' ? 'error' : status === 'received' ? 'success' : status === 'na' ? 'stopped' : status === 'ordered' ? 'in-progress' : 'pending';

export default function ProcurementWorkspace() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const initialItemId = Number(params.get('item')) || undefined;
  const [house, setHouse] = useState(params.get('project') ?? '');
  const [workGroup, setWorkGroup] = useState('all');
  const [newProjectId, setNewProjectId] = useState('');
  const [trackerVersion, setTrackerVersion] = useState(0);
  const meta = useMeta();
  const flash = useFlash();
  const [data, setData] = useState<ProcurementWorkspaceData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [wave, setWave] = useState('');
  const [status, setStatus] = useState('');
  const [selectedId, setSelectedId] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<ProcurementDraft>(procurementDraft());
  const [original, setOriginal] = useState<ProcurementDraft>(procurementDraft());
  const [ordersOpen, setOrdersOpen] = useState(!!initialItemId);
  const focusedItem = useRef<number | undefined>();
  const [revision, setRevision] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [image, setImage] = useState<ProcurementImage | null>(null);
  const [removeImage, setRemoveImage] = useState<ProcurementImage | null>(null);
  const selected = data?.items.find(row => row.id === selectedId);
  const project = data?.projects.find(p => p.id === (selected?.project_id ?? Number(newProjectId)));
  const dirty = JSON.stringify(draft) !== JSON.stringify(original);
  const statusOptions = meta?.procurement_statuses ?? [];
  const waveOptions = meta?.procurement_waves ?? [];
  const label = (value: string) => statusOptions.find(s => s.value === value)?.label ?? value;
  const load = useCallback(async () => {
    try { setData(await api.procurementTracking()); setLoadError(''); }
    catch (e) { setLoadError((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!data || !initialItemId || focusedItem.current === initialItemId) return;
    const row = data.items.find(item => item.id === initialItemId);
    focusedItem.current = initialItemId;
    if (row) { setSelectedId(row.id); const d = procurementDraft(row); setDraft(d); setOriginal(d); setRevision(row.updated_at); setOrdersOpen(true); }
  }, [data, initialItemId]);
  const select = (row: ProcurementItem | null) => {
    if (busy) return;
    if (dirty) { setError('当前材料还有未保存的修改，请先保存，或点“放弃修改”后再切换。'); return; }
    const next = procurementDraft(row ?? undefined);
    if (!row) setNewProjectId(house || String(data?.projects[0]?.id ?? ''));
    setSelectedId(row?.id ?? 'new'); setDraft(next); setOriginal(next); setRevision(row?.updated_at ?? ''); setError('');
  };
  const close = () => {
    if (dirty) { setError('请先保存或放弃当前修改，再返回列表。'); return; }
    setSelectedId(null); setError('');
  };
  const visible = (data?.items ?? []).filter(row => (!house || String(row.project_id) === house) && (workGroup === 'all' || procurementWorkGroup(row) === workGroup) && (!wave || row.wave === wave) && (!status || row.status === status)
    && `${row.name} ${row.note ?? ''} ${row.specification ?? ''} ${row.delivery_address ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const groups = waveOptions.filter(group => visible.some(row => row.wave === group.value));
  const save = async (markChecked = false) => {
    if (!project) { setError('请选择有采购权限的房屋'); return; }
    const invalid = procurementError(draft);
    if (invalid) { setError(invalid); return; }
    setBusy(true); setError('');
    try {
      const changes = procurementChanges(draft, original);
      const next = selectedId === 'new'
        ? await api.addProcurement(project.id, { ...changes, name: draft.name.trim(), wave: draft.wave })
        : await api.patchProcurement(Number(selectedId), { ...changes, expected_updated_at: revision, mark_checked: markChecked });
      const saved = selectedId === 'new' ? next.items.find(row => row.id === next.created_item_id)! : next.items.find(row => row.id === selectedId)!;
      await load(); setTrackerVersion(v => v + 1); setSelectedId(saved.id); setDraft(procurementDraft(saved)); setOriginal(procurementDraft(saved)); setRevision(saved.updated_at);
      flash({ type: 'success', content: `「${saved.name}」已保存` });
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const discard = async () => {
    if (selectedId === 'new') { setDraft(original); setError(''); return; }
    setBusy(true);
    try {
      const next = await api.procurementTracking(); setData(next);
      const current = next.items.find(row => row.id === selectedId);
      if (current) { const clean = procurementDraft(current); setDraft(clean); setOriginal(clean); setRevision(current.updated_at); }
      setError('');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const upload = async (file: File) => {
    setBusy(true); setError('');
    try { await api.uploadProcurementImage(Number(selectedId), file); await load(); flash({ type: 'success', content: '材料图片已上传' }); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  if (loadError) return <Alert type="error" header="采购清单暂时无法加载" action={<Button onClick={load}>重试</Button>}>{loadError}</Alert>;
  if (!data) return <Box padding="l"><Spinner /> 正在加载采购工作台…</Box>;
  const editor = selectedId !== null ? <SpaceBetween size="m">
    <Header variant="h2" actions={<Button disabled={busy || dirty} variant="icon" iconName="close" ariaLabel="关闭采购详情" onClick={close} />}>{selectedId === 'new' ? '新增采购项' : selected?.name}</Header>
    <Box color="text-body-secondary">{project?.name ?? '请选择房屋'} · {selectedId === 'new' ? '新增材料从待选型开始' : '修改后点保存，对同项目采购同事可见'}</Box>
    {error && <Alert type="error">{error}</Alert>}
    {selectedId === 'new' && <FormField label="所属房屋"><Select disabled={busy} ariaLabel="新增采购所属房屋" options={data.projects.map(p => ({ value: String(p.id), label: p.name }))} selectedOption={project ? { value: String(project.id), label: project.name } : null} onChange={({ detail }) => {
      const id = detail.selectedOption.value!;
      setNewProjectId(id);
      if (draft.delivery_type === 'project') setDraft({ ...draft, delivery_address: data.projects.find(p => String(p.id) === id)?.address ?? '' });
    }} /></FormField>}
    <FormField label="材料名称"><Input disabled={busy} value={draft.name} onChange={({ detail }) => setDraft({ ...draft, name: detail.value })} /></FormField>
    <FormField label="使用节点"><Select disabled={busy} selectedOption={waveOptions.find(w => w.value === draft.wave) ?? null} options={waveOptions} onChange={({ detail }) => setDraft({ ...draft, wave: detail.selectedOption.value! })} /></FormField>
    {selectedId !== 'new' && <FormField label="采购状态"><Select disabled={busy} options={statusOptions} selectedOption={statusOptions.find(s => s.value === draft.status) ?? null} onChange={({ detail }) => setDraft({ ...draft, status: detail.selectedOption.value! })} /></FormField>}
    <ProcurementFields draft={draft} onChange={setDraft} projectAddress={project?.address ?? ''} disabled={busy} />
    <ExpandableSection headerText="订单与物流（人工更新）" expanded={ordersOpen} onChange={({ detail }) => setOrdersOpen(detail.expanded)}>
      <SpaceBetween size="m"><ProcurementOrderFields draft={draft} onChange={setDraft} disabled={busy} />
        {selected && <><Box color="text-body-secondary">最近人工核对：{selected.checked_at?.replace('T', ' ') ?? '未核对'}</Box><Button disabled={busy} onClick={() => save(true)}>已核对网站，保存记录</Button></>}
      </SpaceBetween>
    </ExpandableSection>
    <SpaceBetween direction="horizontal" size="s">
      <Button variant="primary" loading={busy} disabled={!dirty} onClick={() => save()}>保存采购项</Button>
      <Button disabled={busy} onClick={discard}>{dirty ? '放弃修改' : '重新载入'}</Button>
    </SpaceBetween>
    {selected && <>
      <Box color="text-body-secondary">最近更新：{selected.updated_by ?? '未记录'} · {selected.updated_at.replace('T', ' ').slice(0, 16)}</Box>
      <section className="ui-proc-images"><Header variant="h3" description="点击图片查看完整尺寸。JPG / PNG / WebP，每张不超过 8 MB，最多 12 张。">材料图片</Header>
        {selected.images.length === 0 && <Box color="text-body-secondary">尚未上传材料图片。</Box>}
        <div className="ui-proc-image-grid">{selected.images.map(img => <div key={img.id}>
          <button type="button" className="ui-proc-image-button" onClick={() => setImage(img)} aria-label={`查看完整图片：${img.filename}`}><img src={`/api/procurement-images/${img.id}`} alt={img.filename} loading="lazy" /></button>
          <Button variant="inline-link" disabled={busy} onClick={() => setRemoveImage(img)}>移除 {img.filename}</Button>
        </div>)}</div>
        <label className="ui-proc-upload">添加材料图片<input type="file" aria-label="添加材料图片" accept="image/jpeg,image/png,image/webp" disabled={busy || selected.images.length >= 12} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void upload(file); }} /></label>
      </section>
    </>}
  </SpaceBetween> : <Box color="text-body-secondary" padding="m">按使用节点核对材料。点击材料名称，维护日期、收货地点、金额、备注与图片。</Box>;
  return <SpaceBetween size="m">
    <Header variant="h1" description="Jeremy / Tristin 共用 · 在这里完成采购记录、订单跟进与收货核对。项目页同步采购概况。"
      actions={<SpaceBetween direction="horizontal" size="s"><Button disabled={busy || dirty} onClick={async () => { await load(); setTrackerVersion(v => v + 1); }}>刷新工作台</Button><Button variant="primary" disabled={busy || !data.projects.length} onClick={() => select(null)}>新增采购项</Button></SpaceBetween>}>采购工作台</Header>
    <Box color="text-body-secondary">按大类推进工作，再按房屋与使用节点核对材料。下方数量是材料记录数，不是逐件分派的任务。</Box>
    <div className="ui-proc-work-groups">{procurementWorkGroups.map(group => <Button key={group.value} variant="normal" disabled={busy} ariaLabel={`${group.label}，${data.items.filter(row => (!house || String(row.project_id) === house) && (group.value === 'all' || procurementWorkGroup(row) === group.value)).length} 项材料${workGroup === group.value ? '，已选中' : ''}`} onClick={() => setWorkGroup(group.value)}><span className={workGroup === group.value ? 'ui-proc-active-group' : ''}>{group.label} · {data.items.filter(row => (!house || String(row.project_id) === house) && (group.value === 'all' || procurementWorkGroup(row) === group.value)).length}</span></Button>)}</div>
    <ExpandableSection headerText="跨网站订单跟进" defaultExpanded={false}>
      <ProcurementTracker key={trackerVersion} onSelect={id => { const row = data.items.find(r => r.id === id); if (row) { select(row); setOrdersOpen(true); } }} />
    </ExpandableSection>
    <div className="ui-proc-toolbar ui-proc-workspace-toolbar">
      <Select ariaLabel="工作台房屋筛选" options={[{ value: '', label: '全部房屋' }, ...data.projects.map(p => ({ value: String(p.id), label: p.name }))]} selectedOption={{ value: house, label: data.projects.find(p => String(p.id) === house)?.name ?? '全部房屋' }} onChange={({ detail }) => setHouse(detail.selectedOption.value!)} />
      <TextFilter filteringText={query} filteringPlaceholder="搜索材料、规格、备注或收货地址" filteringAriaLabel="搜索项目采购" onChange={({ detail }) => setQuery(detail.filteringText)} />
      <Select ariaLabel="使用节点筛选" options={[{ value: '', label: '全部使用节点' }, ...waveOptions]} selectedOption={waveOptions.find(w => w.value === wave) ?? { value: '', label: '全部使用节点' }} onChange={({ detail }) => setWave(detail.selectedOption.value!)} />
      <Select ariaLabel="采购状态筛选" options={[{ value: '', label: '全部状态' }, ...statusOptions]} selectedOption={statusOptions.find(s => s.value === status) ?? { value: '', label: '全部状态' }} onChange={({ detail }) => setStatus(detail.selectedOption.value!)} />
    </div>
    <CollaborationWorkspace detailOpen={selectedId !== null} onBack={close} backLabel="返回材料列表" detail={editor} main={<SpaceBetween size="m">
      {data.projects.filter(p => (!house || String(p.id) === house) && (visible.some(row => row.project_id === p.id) || !data.items.some(row => row.project_id === p.id))).map(p => <section key={p.id}>
        <Header variant="h2" actions={<Button variant="inline-link" onClick={() => { if (dirty) { setError('请先保存或放弃修改'); return; } navigate(`/projects/${p.id}?tab=procurement`); }}>查看房屋概况</Button>}>{p.name}</Header>
        {!data.items.some(row => row.project_id === p.id) && <Alert type="info" action={<Button disabled={busy} onClick={async () => { setBusy(true); try { await api.initProcurement(p.id); await load(); } catch (e) { setLoadError((e as Error).message); } finally { setBusy(false); } }}>按模板建立材料清单</Button>}>这套房还没有采购记录，也可以直接新增采购项。</Alert>}
      {groups.filter(group => visible.some(row => row.project_id === p.id && row.wave === group.value)).map(group => <ExpandableSection key={group.value} defaultExpanded headerText={`${group.label} · ${visible.filter(row => row.project_id === p.id && row.wave === group.value).length} 项`}>
        <Table<ProcurementItem> variant="embedded" items={visible.filter(row => row.project_id === p.id && row.wave === group.value)} trackBy="id"
          columnDefinitions={[
            { id: 'material', header: '材料 / 备注', minWidth: 180, cell: row => <div><Button variant="inline-link" ariaLabel={`编辑采购：${row.name}`} onClick={() => select(row)}>{row.name}</Button><div className="ui-proc-note">{row.note ?? '暂无备注'}</div></div> },
            { id: 'status', header: '状态', minWidth: 90, cell: row => <StatusIndicator type={tone(row.status)}>{label(row.status)}</StatusIndicator> },
            { id: 'dates', header: '下单 / 预计到货', minWidth: 135, cell: row => <div className="ui-proc-dates"><span>下单 {row.ordered_on ?? '未填'}</span><span>预计 {row.expected_on ?? '未填'}</span></div> },
            { id: 'place', header: '收货地点', minWidth: 120, cell: row => <span title={row.delivery_address ?? undefined}>{deliveryLabel(row)}</span> },
            { id: 'amount', header: '金额（USD）', minWidth: 110, cell: row => money(row.amount, 2) },
          ]} />
      </ExpandableSection>)}
      </section>)}
      {!visible.length && <Box padding="l">没有符合筛选的材料。<Button variant="inline-link" onClick={() => { setQuery(''); setWave(''); setStatus(''); setWorkGroup('all'); setHouse(''); }}>清除筛选</Button></Box>}
    </SpaceBetween>} />
    <Modal visible={!!image} size="max" header={image?.filename ?? '材料图片'} onDismiss={() => setImage(null)}>
      {image && <SpaceBetween size="s"><a href={`/api/procurement-images/${image.id}`} target="_blank" rel="noreferrer">在新窗口查看原图</a><img className="ui-proc-full-image" src={`/api/procurement-images/${image.id}`} alt={image.filename} /></SpaceBetween>}
    </Modal>
    <Modal visible={!!removeImage} header="移除材料图片" onDismiss={() => setRemoveImage(null)} footer={<SpaceBetween direction="horizontal" size="s"><Button onClick={() => setRemoveImage(null)}>取消</Button><Button loading={busy} onClick={async () => { if (!removeImage) return; setBusy(true); try { await api.deleteProcurementImage(removeImage.id); setRemoveImage(null); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>确认移除</Button></SpaceBetween>}>
      移除「{removeImage?.filename}」后，需要重新上传才能恢复。
    </Modal>
  </SpaceBetween>;
}
