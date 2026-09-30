import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
import { useEffect, useState } from 'react';
import Button from '@cloudscape-design/components/button';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Alert from '@cloudscape-design/components/alert';
import Spinner from '@cloudscape-design/components/spinner';
import { useSearchParams } from 'react-router-dom';
import { api, type DesignWorkspaceSummary } from '../api/client';
import { useActor } from '../lib/actor';
import Header from '../components/ui/Header';
import EmployeeAvatar from '../components/ui/EmployeeAvatar';
import LeadershipDesignComparison from '../components/design/LeadershipDesignComparison';
import type { LeadershipPreview, LeadershipPersona } from '../lib/leadershipDesign';
import SpecialistDesignComparison from '../components/design/SpecialistDesignComparison';
import CollaborationWorkspace from '../components/ui/CollaborationWorkspace';
import { visibleDesignTasks, parseDesignPreferences, type DesignPersona, type CorePersona, type SpecialistPersona, type SpecialistPreview, type DesignId, type DesignHouse, type DesignTask, type ServiceKind, type DesignPreview } from '../lib/roleDesigns';

const PREF_KEY = 'fh-role-design-preferences-v1';
type Preference = { choice: DesignId; note: string };
function readPreferences(storageKey: string): Partial<Record<DesignPersona, Preference>> {
  try { return parseDesignPreferences(localStorage.getItem(storageKey)); } catch { return {}; }
}
export default function DesignCollaboration() {
  useLanguage();
  const { me } = useActor();
  const [params, setParams] = useSearchParams();
  const requested = params.get('workspace');
  const [catalog, setCatalog] = useState<{ items: DesignWorkspaceSummary[]; can_view_all: boolean } | null>(null);
  const [loaded, setLoaded] = useState<(DesignWorkspaceSummary & { preview: DesignPreview | SpecialistPreview | LeadershipPreview | null }) | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setCatalog(null); setLoaded(null); setError('');
    if (!me) return;
    api.designWorkspaces().then(data => { if (active) setCatalog(data); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [me?.id, me?.role_code, me?.is_admin, revision]);
  const preferred = me?.is_admin ? 'admin' : me?.role_code === 'D' ? 'david' : me?.role_code === 'J' ? 'jessie' : undefined;
  const selected = requested ?? catalog?.items.find(item => item.key === preferred && item.available)?.key ?? catalog?.items.find(item => item.available)?.key ?? catalog?.items[0]?.key;
  useEffect(() => {
    let active = true;
    setLoaded(null); setError('');
    if (!me || !catalog || !selected) return;
    if (!catalog.items.some(item => item.key === selected)) { setError(uiText("designCollaboration.your.account.cannot.view.designs.for.this.role")); return; }
    api.designWorkspace(selected).then(data => { if (active) setLoaded(data); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [catalog, selected, me?.id]);
  if (!me) return <Alert type="info">{uiText("designCollaboration.sign.in.with.your.own.account.to.view.designs")}</Alert>;
  return <>
    <div className="ui-rd-access"><strong>{me.display_name} · {systemText(me.role_label)}</strong><span>{catalog?.can_view_all ? uiText("designCollaboration.can.view.designs.for.all.roles") : (catalog?.items.length ?? 0) > 1 ? uiText("designCollaboration.showing.designs.authorized.for.this.account") : uiText("designCollaboration.showing.designs.for.this.account.s.role.only")}</span></div>
    {catalog && catalog.items.length > 1 && <div className="ui-rd-access-tabs" role="group" aria-label={uiText("designCollaboration.accessible.role.designs")}>{catalog.items.map(item => <button key={item.key} aria-pressed={selected === item.key} onClick={() => setParams(previous => { const next = new URLSearchParams(previous); next.set('view', 'roles'); next.set('workspace', item.key); return next; })}>{systemText(item.title)}{!item.available && <small>{uiText("designCollaboration.not.yet.available")}</small>}</button>)}</div>}
    {error ? <Alert type="error" action={<Button onClick={() => { setParams({}); setRevision(v => v + 1); }}>{uiText("designCollaboration.back.to.my.designs")}</Button>}>{systemText(error)}</Alert>
      : !catalog ? <Spinner size="large" />
      : !catalog.items.length ? <Alert type="info">{uiText("designCollaboration.no.dedicated.design.is.assigned.to.this.account.s")}</Alert>
      : !loaded || loaded.key !== selected ? <Spinner size="large" />
      : !loaded.available || !loaded.preview ? <ContentLayout header={<Header variant="h1">{systemText(loaded.title)}</Header>}><Alert type="info">{uiText("designCollaboration.this.workspace.s.design.comparison.is.not.available.yet")}</Alert></ContentLayout>
      : 'kind' in loaded.preview && loaded.preview.kind === 'leadership' ? <LeadershipDesignComparison key={`${me.id}:${loaded.key}`} persona={loaded.key as LeadershipPersona} preview={loaded.preview} storageKey={`${PREF_KEY}:${me.id}:${loaded.key}`} />
      : 'records' in loaded.preview ? <SpecialistDesignComparison key={`${me.id}:${loaded.key}`} persona={loaded.key as SpecialistPersona} preview={loaded.preview} storageKey={`${PREF_KEY}:${me.id}:${loaded.key}`} />
      : <RoleDesignPreview key={`${me.id}:${loaded.key}`} persona={loaded.key as CorePersona} preview={loaded.preview as DesignPreview} storageKey={`${PREF_KEY}:${me.id}:${loaded.key}`} />}
  </>;
}

function RoleDesignPreview({ persona, preview, storageKey }: { persona: CorePersona; preview: DesignPreview; storageKey: string }) {
  useLanguage();
  const { person, designs, houses: designHouses, tasks: designTasks } = preview;
  const [choices, setChoices] = useState<Record<CorePersona, DesignId>>({ jessie: 'B', kody: 'A' });
  const [houseId, setHouseId] = useState('cedar');
  const [taskId, setTaskId] = useState('gas-cedar');
  const [service, setService] = useState<ServiceKind>('燃气');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('全部');
  const [drilled, setDrilled] = useState(false);
  const [houseTab, setHouseTab] = useState('总览');
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailType, setDetailType] = useState<'house' | 'task' | 'service'>(persona === 'jessie' ? 'house' : 'service');
  const [resource, setResource] = useState('');
  const [fileOpen, setFileOpen] = useState(false);
  const [edit, setEdit] = useState(false);
  const [draftNote, setDraftNote] = useState('');
  const [savedNotes, setSavedNotes] = useState<Record<string, string>>({});
  const [preferences, setPreferences] = useState(() => readPreferences(storageKey));
  const [note, setNote] = useState(preferences[persona]?.note ?? '');
  const [message, setMessage] = useState('');
  const [sort, setSort] = useState(false);
  const current = designs.find(d => d.id === choices[persona])!;
  const house = designHouses.find(h => h.id === houseId)!;
  const task = designTasks.find(t => t.id === taskId)!;
  const isJessie = persona === 'jessie';
  const serviceKey = `${houseId}:${service}`;
  const serviceState = (h: DesignHouse, kind: ServiceKind) => ({ 水: h.water, 电: h.electric, 燃气: h.gas, 保险: h.insurance })[kind];
  const taskRows = visibleDesignTasks(designTasks, designHouses, persona, query, filter, current.layout === 'house' || drilled ? houseId : 'all');
  const houses = designHouses.filter(h => `${h.name} ${h.stage} ${h.focus}`.toLowerCase().includes(query.trim().toLowerCase())
    && (filter === '全部' || filter === '待我审核' && h.id === 'oak' || filter === '有卡点' && ['cedar', 'maple', 'pine'].includes(h.id) || h.stage.includes(filter)));
  const sortedHouses = sort ? [...houses].sort((a, b) => a.date.localeCompare(b.date)) : houses;
  const chooseHouse = (id: string, type: 'house' | 'task' | 'service' = 'house') => {
    setHouseId(id); setDetailType(type); setDetailOpen(true); setFileOpen(false); setEdit(false); setMessage('');
    const first = designTasks.find(t => t.house === id && (isJessie || t.person === 'Kody'));
    if (first) setTaskId(first.id);
  };
  const chooseTask = (t: DesignTask) => { chooseHouse(t.house, 'task'); setTaskId(t.id); if (t.service) setService(t.service); };
  const chooseService = (h: DesignHouse, kind: ServiceKind) => { chooseHouse(h.id, 'service'); setService(kind); };
  const switchDesign = (id: DesignId) => { setChoices(c => ({ ...c, [persona]: id })); setFilter('全部'); setQuery(''); setDetailOpen(false); setDetailType(isJessie ? 'house' : 'service'); setFileOpen(false); setEdit(false); setMessage(''); setDrilled(false); };
  const savePreference = () => {
    const next = { ...preferences, [persona]: { choice: choices[persona], note } };
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setPreferences(next); setMessage(uiText("sentences.option.preference.is.saved.in.this.browser", { value1: (person.display_name), value2: (choices[persona]) })); }
    catch { setMessage(uiText("designCollaboration.browser.storage.is.unavailable.copy.your.selection.to.share")); }
  };
  const copyPreference = async () => {
    try { await navigator.clipboard.writeText(uiText("sentences.prefers.option.referencing", { value1: (person.display_name), value2: (choices[persona]), value3: (current.title), value4: (current.source), value5: (note ? uiText("sentences.requested.changes", { value1: (note) }) : '') })); setMessage(uiText("leadershipDesignComparison.copied.you.can.paste.it.now")); }
    catch { setMessage(uiText("designCollaboration.copy.failed.send.the.option.letter.and.requested.changes")); }
  };
  const previewTask = (t: DesignTask) => <button key={t.id} className="ui-rd-task" aria-pressed={detailType === 'task' && t.id === taskId} onClick={() => chooseTask(t)}>
    <span><small>{designHouses.find(h => h.id === t.house)?.name} · {systemText(t.category)}</small><strong>{systemText(t.title)}</strong><span>{systemText(t.detail)}</span></span>
    <span className="ui-rd-task-meta"><span>{systemText(t.status)}</span><span>{t.person} · {t.due}</span></span>
  </button>;
  const categories = current.layout === 'portfolio' || current.layout === 'register' ? ['全部', '有卡点', ...(isJessie ? ['待我审核', '装修', '预上市'] : ['装修', '售出收尾'])]
    : current.layout === 'tasks' ? ['全部', '采购', 'Permit / 设计', '保险资料', '上市准备', '待审核'] : ['全部', '等待中', '进行中', '资料待补', '提前准备'];
  const toolbar = <div className="ui-rd-toolbar"><label>{uiText("designCollaboration.search.property.or.task")}<input value={query} onChange={e => setQuery(e.target.value)} placeholder={uiText("designCollaboration.for.example.cedar.gas.or.procurement")} /></label><div role="group" aria-label={uiText("designCollaboration.filter.preview.content")}>{categories.map(f => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f}</button>)}</div></div>;
  const houseTabs = <div className="ui-rd-tabs" role="group" aria-label={uiText("designCollaboration.property.business.tabs")}>{['总览', '任务', '采购', '预算', '资料'].map(t => <button key={t} aria-pressed={houseTab === t} onClick={() => { setHouseTab(t); setFileOpen(false); }}>{systemText(t)}</button>)}</div>;
  const houseContent = <>
    {houseTab === '总览' && <div className="ui-rd-house-brief"><div><small>{uiText("designCollaboration.current.position")}</small><h3>{systemText(house.stage)}</h3><p>{systemText(house.focus)}</p></div><div><small>{uiText("workbenchFocus.next.action")}</small><h3>{systemText(house.next)}</h3><p>{uiText("designCollaboration.sample.task.due.date")} {house.date} {uiText("designCollaboration.stage.and.task.execution.status.are.separate")}</p></div><h3>{uiText("designCollaboration.work.underway.for.this.property")}</h3>{designTasks.filter(t => t.house === houseId).map(previewTask)}</div>}
    {houseTab === '任务' && <>{taskRows.length ? taskRows.map(previewTask) : <p className="ui-rd-empty">{uiText("designCollaboration.no.tasks.match.clear.filters.to.view.tasks")}</p>}</>}
    {houseTab === '采购' && <div className="ui-rd-house-brief"><h3>{uiText("designCollaboration.procurement.by.stage")}</h3><p>{houseId === 'oak' ? uiText("designCollaboration.kitchen.materials.received.delivery.needs.verification") : uiText("designCollaboration.this.sample.property.has.no.procurement.items.switch.to")}</p>{(houseId === 'oak' ? ['厨房材料 · 已到货', '照明灯具 · 已订购', '五金配件 · 待规格'] : []).map(t => <div className="ui-rd-resource" key={t}><span>{systemText(t)}</span>{t.startsWith('厨房') ? <Button onClick={() => { setDetailType('task'); setTaskId('procurement-oak'); setHouseId('oak'); setDetailOpen(true); setFileOpen(false); }}>{uiText("designCollaboration.view.deliverables")}</Button> : <span>{uiText("designCollaboration.procurement.records.sample")}</span>}</div>)}</div>}
    {houseTab === '预算' && <div className="ui-rd-house-brief"><h3>{uiText("designCollaboration.budget.and.recorded.expenses")}</h3><p>{uiText("designCollaboration.synthetic.amounts.for.the.current.property.used.to.compare")}</p><dl className="ui-rd-facts"><dt>{uiText("designCollaboration.planned.renovation.budget")}</dt><dd>$80,000</dd><dt>{uiText("designCollaboration.recorded.expenses")}</dt><dd>$32,000</dd><dt>{uiText("designCollaboration.remaining.budget")}</dt><dd>$48,000</dd></dl><p>{uiText("designCollaboration.remaining.budget.is.not.profit.no.employee.efficiency.scores")}</p></div>}
    {houseTab === '资料' && <div className="ui-rd-house-brief"><h3>{uiText("designCollaboration.property.documents")}</h3>{['保险文件', '到货照片', 'Permit 申请资料'].map(name => <button className="ui-rd-resource" key={name} onClick={() => { setFileOpen(true); setResource(name); setDetailType(name === '保险文件' ? 'service' : 'house'); setService('保险'); setDetailOpen(true); }}>{systemText(name)}<span>{uiText("designCollaboration.view.sample.record")}</span></button>)}</div>}
  </>;
  const main = <div className="ui-rd-main">
    <header className="ui-rd-work-header"><div><small>{isJessie ? uiText("designCollaboration.project.coordination") : uiText("designCollaboration.property.services")} / {systemText(current.title)}</small><h2>{isJessie ? uiText("designCollaboration.jessie.s.workspace") : uiText("designCollaboration.kody.s.workspace")}</h2><p>{isJessie ? uiText("designCollaboration.all.projects.property.details.work.i.need.to.advance") : uiText("designCollaboration.understand.every.property.s.position.and.handle.my.utilities")}</p></div><EmployeeAvatar user={person} /></header>
    {current.layout === 'house' || drilled ? <div className="ui-rd-house-layout"><nav aria-label={uiText("designCollaboration.sample.property.navigation")}>{designHouses.map(h => <button key={h.id} aria-pressed={h.id === houseId} onClick={() => { chooseHouse(h.id); setDetailOpen(false); setHouseTab('总览'); }}><strong>{h.name}</strong><small>{systemText(h.stage)}</small></button>)}</nav><section>{drilled && <Button iconName="arrow-left" onClick={() => { setDrilled(false); setHouseTab('总览'); }}>{uiText("designCollaboration.back.to.all.properties")}</Button>}<div className="ui-rd-house-title"><h2>{house.name}</h2><span>{systemText(house.stage)}</span></div>{houseTabs}{houseContent}</section></div>
    : current.layout === 'portfolio' ? <>{toolbar}<div className="ui-rd-section-heading"><h3>{uiText("directorDesign.all.properties")} <small>{houses.length} {uiText("directorDesign.properties")}</small></h3><Button onClick={() => setSort(!sort)}>{sort ? uiText("designCollaboration.restore.default.order") : uiText("designCollaboration.sort.by.task.due.date")}</Button></div><div className="ui-rd-portfolio"><div className="ui-rd-column-head"><span>{uiText("designCollaboration.property.position")}</span><span>{uiText("designCollaboration.current.focus.and.next.action")}</span><span>{uiText("designCollaboration.task.due.date")}</span></div>{sortedHouses.map(h => <button key={h.id} aria-pressed={h.id === houseId} onClick={() => chooseHouse(h.id)}><span><strong>{h.name}</strong><small>{systemText(h.stage)}</small></span><span><strong>{systemText(h.focus)}</strong><small>{systemText(h.next)}</small></span><span>{h.date}</span></button>)}</div>{!houses.length && <p className="ui-rd-empty">{uiText("designCollaboration.no.properties.match.these.filters")}</p>}</>
    : current.layout === 'register' ? <>{toolbar}<div className="ui-rd-register"><div className="ui-rd-register-head"><span>{uiText("designCollaboration.property.position")}</span>{(['水', '电', '燃气', '保险'] as const).map(s => <span key={s}>{systemText(s)}</span>)}</div>{houses.map(h => <div key={h.id} className="ui-rd-register-row"><span><strong>{h.name}</strong><small>{systemText(h.stage)}</small></span>{(['水', '电', '燃气', '保险'] as const).map(s => <button key={s} aria-label={`${h.name} · ${s} · ${systemText(serviceState(h, s))}`} aria-pressed={h.id === houseId && s === service} onClick={() => chooseService(h, s)}><small>{systemText(s)}</small><strong>{systemText(serviceState(h, s))}</strong>{s === '保险' && <small>{h.expiry || uiText("designCollaboration.expiration.date.not.entered")}</small>}</button>)}</div>)}</div>{!houses.length && <p className="ui-rd-empty">{uiText("designCollaboration.no.properties.match.these.filters")}</p>}</>
    : current.layout === 'providers' ? <><div className="ui-rd-tabs" role="group" aria-label={uiText("designCollaboration.service.category")}>{(['水', '电', '燃气', '保险'] as const).map(s => <button key={s} aria-pressed={service === s} onClick={() => { setService(s); setDetailType('service'); setFileOpen(false); setEdit(false); }}>{systemText(s)}</button>)}</div><p className="ui-rd-caption">{service === '保险' ? uiText("designCollaboration.find.existing.insurance.files.by.property.uploading.a.file") : uiText("designCollaboration.group.relevant.property.accounts.when.contacting.a.service.provider")}</p>{(service === '燃气' ? ['Metro Gas（示例）', 'City Gas（示例）'] : service === '保险' ? ['保险文件'] : [service === '水' ? uiText("designCollaboration.city.water.sample") : uiText("designCollaboration.metro.electric.sample")]).map(company => <section className="ui-rd-provider" key={company}><div><small>{service === '保险' ? uiText("designCollaboration.property.files") : uiText("designCollaboration.service.provider")}</small><h3>{systemText(company)}</h3></div><div>{designHouses.filter(h => service !== '燃气' || h.company === company).map(h => <button key={h.id} aria-pressed={h.id === houseId} onClick={() => chooseService(h, service)}><strong>{h.name}</strong><span>{systemText(serviceState(h, service))}</span><small>{systemText(h.stage)}</small><span>{uiText("procurementItemRow.view")}{service === '保险' ? uiText("designCollaboration.documents") : uiText("designCollaboration.account")} →</span></button>)}</div></section>)}</>
    : <>{toolbar}{current.layout === 'queue' ? ['进行中', '等待中', '资料待补', '提前准备'].map(status => { const rows = taskRows.filter(t => t.status === status); return rows.length ? <section key={status} className="ui-rd-task-group"><h3>{systemText(status)} <small>{rows.length}</small></h3>{rows.map(previewTask)}</section> : null; }) : <><div className="ui-rd-section-heading"><h3>{uiText("designCollaboration.tasks.across.properties")}</h3><span>{taskRows.length} {uiText("projectPreplan.items")}</span></div>{taskRows.map(previewTask)}</>}{!taskRows.length && <p className="ui-rd-empty">{uiText("designCollaboration.no.tasks.match.these.filters")}</p>}</>}
  </div>;
  const selectionVisible = current.layout === 'portfolio' || current.layout === 'register' ? drilled || houses.some(h => h.id === houseId) : ['tasks', 'queue'].includes(current.layout) ? taskRows.some(t => t.id === taskId) : true;
  const detail = <div className="ui-rd-detail"><small>{house.name} · {systemText(house.stage)}</small><h2>{detailType === 'task' ? systemText(task.title) : detailType === 'service' ? `${systemText(service)}${service === '保险' ? uiText("designCollaboration.documents") : uiText("designCollaboration.account")}` : uiText("cardRegistry.property.summary")}</h2>
    {detailType === 'house' ? <><p>{systemText(house.focus)}</p><dl className="ui-rd-facts"><dt>{uiText("workbenchFocus.next.action")}</dt><dd>{systemText(house.next)}</dd><dt>{uiText("designCollaboration.task.due.date")}</dt><dd>{house.date}</dd><dt>{uiText("projectPreplan.current.stage")}</dt><dd>{systemText(house.stage)}</dd></dl><h3>{uiText("designCollaboration.open.property.details")}</h3><div className="ui-rd-detail-links">{['任务', '采购', '预算', '资料'].map(t => <Button key={t} onClick={() => { setDrilled(current.layout !== 'house'); setHouseTab(t); setFilter('全部'); setQuery(''); setDetailOpen(false); setFileOpen(false); }}>{uiText("procurementItemRow.view")}{systemText(t)}</Button>)}</div><h3>{uiText("designCollaboration.recent.collaboration")}</h3><p>{systemText(house.next)}{uiText("designCollaboration.records.show.this.task.still.needs.follow.up")}</p></>
    : detailType === 'task' ? <><strong>{systemText(task.status)}</strong><p>{systemText(task.detail)}</p><dl className="ui-rd-facts"><dt>{uiText('task.assignee')}</dt><dd>{task.person}</dd><dt>{uiText("designCollaboration.task.due.date")}</dt><dd>{task.due}</dd><dt>{uiText("sabrinaDesign.record.source")}</dt><dd>{systemText(task.source)}</dd></dl>{task.service ? <Button variant="primary" onClick={() => { setService(task.service!); setDetailType('service'); }}>{task.service === '保险' ? uiText("designCollaboration.view.insurance.file") : uiText("designCollaboration.open.service.account")}</Button> : <Button variant="primary" onClick={() => { setResource(task.category === '采购' ? '厨房材料到货照片' : task.title); setFileOpen(!fileOpen); }}>{uiText("designCollaboration.view.delivery.documents")}</Button>}<details><summary>{uiText("designCollaboration.related.properties.and.records")}</summary><p>{house.name} · {systemText(house.stage)}</p><p>{uiText("designCollaboration.execution.records.and.milestone.confirmations.remain.separate.this.does")}</p></details></>
    : <><div className="ui-rd-tabs" role="group" aria-label={uiText("designCollaboration.switch.summary.service")}>{(['水', '电', '燃气', '保险'] as const).map(s => <button key={s} aria-pressed={s === service} onClick={() => { setService(s); setFileOpen(false); setEdit(false); }}>{systemText(s)}</button>)}</div>{service === '保险' ? <><strong>{systemText(house.insurance)}</strong><dl className="ui-rd-facts"><dt>{uiText("updatesList.files")}</dt><dd>{house.name} {uiText("designCollaboration.insurance.pdf.synthetic")}</dd><dt>{uiText("designCollaboration.document.expiration.date")}</dt><dd>{house.expiry || uiText("procurementItemRow.not.entered")}</dd><dt>{uiText("fieldWithSource.source")}</dt><dd>{uiText("designCollaboration.property.files.insurance")}</dd></dl><p>{uiText("designCollaboration.uploaded.means.a.file.exists.it.does.not.verify")}</p><Button variant="primary" onClick={() => setFileOpen(!fileOpen)}>{fileOpen ? uiText("designCollaboration.collapse.file.details") : uiText("designCollaboration.view.file.details")}</Button></>
    : <><strong>{systemText(serviceState(house, service))}</strong><dl className="ui-rd-facts"><dt>{uiText("procurementItemRow.company")}</dt><dd>{service === '燃气' ? house.company : service === '水' ? uiText("designCollaboration.city.water.sample") : uiText("designCollaboration.metro.electric.sample")}</dd><dt>{uiText("designCollaboration.account.number")}</dt><dd>DEMO-{house.id.toUpperCase()}{uiText("designCollaboration.synthetic")}</dd><dt>{uiText("designCollaboration.account.holder")}</dt><dd>{uiText("designCollaboration.sample.project.company")}</dd><dt>{uiText("designCollaboration.issue")}</dt><dd>{savedNotes[serviceKey] ?? (house.id === 'cedar' && service === '燃气' ? uiText("designCollaboration.awaiting.gas.company.visit.confirmation") : house.id === 'pine' && service === '燃气' ? uiText("designCollaboration.awaiting.response.to.closure.request") : uiText("designCollaboration.no.issue.recorded"))}</dd></dl><Button variant="primary" onClick={() => { setDraftNote(savedNotes[serviceKey] ?? ''); setEdit(!edit); }}>{edit ? uiText("leadershipProjectDetail.cancel.editing") : uiText("designCollaboration.edit.account.issue")}</Button>{edit && <div className="ui-rd-edit"><label>{uiText("designCollaboration.sample.account.issue")}<textarea value={draftNote} maxLength={500} onChange={e => setDraftNote(e.target.value)} /></label><Button onClick={() => { setSavedNotes(v => ({ ...v, [serviceKey]: draftNote.trim() || '未记录卡点' })); setEdit(false); setMessage(uiText("designCollaboration.sample.issue.updated.it.persists.across.preview.options.and")); }}>{uiText("leadershipProjectDetail.save.to.this.preview")}</Button></div>}<p className="ui-muted">{uiText("designCollaboration.account.passwords.are.not.shown.in.this.comparison.existing")}</p></>}</>}
    {fileOpen && <div className="ui-rd-file"><h3>{uiText("designCollaboration.document.preview")}</h3><p>{detailType === 'service' ? uiText("sentences.insurance.file", { value1: (house.name) }) : `${house.name} · ${resource || uiText("designCollaboration.delivery.documents")}`}</p><p>{uiText("designCollaboration.synthetic.sample.for.comparing.document.navigation")}</p><p>{detailType === 'service' ? uiText("sentences.recorded.expiration.date", { value1: (house.expiry || uiText("designCollaboration.not.entered")) }) : uiText("designCollaboration.file.source.property.and.submission.batch.should.remain.visible")}</p><Button onClick={() => setFileOpen(false)}>{uiText("sabrinaDesign.close.document.preview")}</Button></div>}
  </div>;
  return <ContentLayout maxContentWidth={1680} header={<Header variant="h1" description={uiText("designCollaboration.compare.complete.workspaces.around.the.work.employees.actually.do")}>{uiText("designCollaboration.compare.designs.by.role")}</Header>}>
    <div className="ui-rd-role-brief"><h2>{isJessie ? uiText("designCollaboration.jessie.needs.the.full.picture.before.advancing.specific.people") : uiText("designCollaboration.kody.needs.project.context.and.quick.access.to.service")}</h2><p>{isJessie ? uiText("designCollaboration.her.work.extends.beyond.personal.tasks.she.coordinates.procurement") : uiText("designCollaboration.he.helps.jessie.with.utilities.gas.and.insurance.maintains")}</p></div>
    <div className="ui-rd-directions" role="group" aria-label={uiText("leadershipDesignComparison.select.a.reference.design")}>{designs.map(d => <button key={d.id} aria-pressed={d.id === choices[persona]} onClick={() => switchDesign(d.id)}><small>{uiText("leadershipDesignComparison.option")} {d.id} · {systemText(d.source)}{d.id === (isJessie ? 'B' : 'A') ? uiText("leadershipDesignComparison.suggested.starting.point") : ''}</small><strong>{systemText(d.title)}</strong><span>{systemText(d.question)}</span></button>)}</div>
    <details className="ui-rd-reference-disclosure"><summary>{uiText("designCollaboration.design.rationale.and.tradeoffs")}</summary><div className="ui-rd-reference"><div><strong>{uiText("leadershipDesignComparison.reference")} {systemText(current.source)} {uiText("leadershipDesignComparison.features.to.adopt")}</strong><p>{systemText(current.borrowed)}</p></div><div><strong>{uiText("designCollaboration.apply.to")} {person.display_name} {uiText("designCollaboration.s.work")}</strong><p>{systemText(current.adapted)}</p></div><div><strong>{uiText("leadershipDesignComparison.benefits.and.tradeoffs")}</strong><p>{systemText(current.gain)} {systemText(current.cost)}</p></div><a href={current.url} target="_blank" rel="noreferrer">{uiText("leadershipDesignComparison.official.reference")}{current.sourceLabel} ↗</a></div></details>
    <div className="ui-rd-preview-caption"><strong>{systemText(current.title)} {uiText("designCollaboration.interactive.preview.synthetic.data")}</strong><span>{uiText("designCollaboration.for.comparing.workflows.only.actual.projects.are.unchanged.feedback")}</span></div>
    <CollaborationWorkspace main={main} detail={selectionVisible ? detail : <p className="ui-rd-empty">{uiText("designCollaboration.the.selected.item.is.outside.the.filter.select.another")}</p>} detailOpen={detailOpen && selectionVisible} onBack={() => setDetailOpen(false)} />
    <section className="ui-rd-preference" aria-label={uiText("leadershipDesignComparison.record.design.preference")}><div><h2>{person.display_name} {uiText("designCollaboration.which.works.best")}</h2><p>{uiText("designCollaboration.preferences.stay.in.this.browser.copy.them.to.share")}</p>{preferences[persona] && <p>{uiText("leadershipDesignComparison.recorded.option")} {preferences[persona]!.choice} · {systemText(designs.find(d => d.id === preferences[persona]!.choice)?.title)}</p>}</div><label>{uiText("leadershipDesignComparison.what.information.or.actions.should.be.more.prominent")}<textarea value={note} maxLength={1000} onChange={e => setNote(e.target.value)} placeholder={uiText("designCollaboration.for.example.jessie.wants.procurement.across.all.properties.first")} /></label><div className="ui-actions ui-actions-start"><Button variant="primary" onClick={savePreference}>{uiText("designCollaboration.save.device.preference.option")} {choices[persona]}</Button><Button onClick={copyPreference}>{uiText("leadershipDesignComparison.copy.preference.and.feedback")}</Button></div>{message && <p role="status">{message}</p>}</section>
  </ContentLayout>;
}
