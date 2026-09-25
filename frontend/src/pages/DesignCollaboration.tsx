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
    if (!catalog.items.some(item => item.key === selected)) { setError('当前登录账号无权查看这个角色的设计。'); return; }
    api.designWorkspace(selected).then(data => { if (active) setLoaded(data); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [catalog, selected, me?.id]);
  if (!me) return <Alert type="info">请登录自己的账号查看职责对应的设计。</Alert>;
  return <>
    <div className="ui-rd-access"><strong>{me.display_name} · {me.role_label}</strong><span>{catalog?.can_view_all ? '可查看全部职责设计' : (catalog?.items.length ?? 0) > 1 ? '显示当前账号获授权查看的职责设计' : '仅显示当前账号职责对应的设计'}</span></div>
    {catalog && catalog.items.length > 1 && <div className="ui-rd-access-tabs" role="group" aria-label="可访问的角色设计">{catalog.items.map(item => <button key={item.key} aria-pressed={selected === item.key} onClick={() => setParams(previous => { const next = new URLSearchParams(previous); next.set('view', 'roles'); next.set('workspace', item.key); return next; })}>{item.title}{!item.available && <small>待制作</small>}</button>)}</div>}
    {error ? <Alert type="error" action={<Button onClick={() => { setParams({}); setRevision(v => v + 1); }}>返回我的设计</Button>}>{error}</Alert>
      : !catalog ? <Spinner size="large" />
      : !catalog.items.length ? <Alert type="info">这个账号的职责暂未安排专属设计。</Alert>
      : !loaded || loaded.key !== selected ? <Spinner size="large" />
      : !loaded.available || !loaded.preview ? <ContentLayout header={<Header variant="h1">{loaded.title}</Header>}><Alert type="info">这个工作区的设计比较尚未制作。请稍后重试。</Alert></ContentLayout>
      : 'kind' in loaded.preview && loaded.preview.kind === 'leadership' ? <LeadershipDesignComparison key={`${me.id}:${loaded.key}`} persona={loaded.key as LeadershipPersona} preview={loaded.preview} storageKey={`${PREF_KEY}:${me.id}:${loaded.key}`} />
      : 'records' in loaded.preview ? <SpecialistDesignComparison key={`${me.id}:${loaded.key}`} persona={loaded.key as SpecialistPersona} preview={loaded.preview} storageKey={`${PREF_KEY}:${me.id}:${loaded.key}`} />
      : <RoleDesignPreview key={`${me.id}:${loaded.key}`} persona={loaded.key as CorePersona} preview={loaded.preview as DesignPreview} storageKey={`${PREF_KEY}:${me.id}:${loaded.key}`} />}
  </>;
}

function RoleDesignPreview({ persona, preview, storageKey }: { persona: CorePersona; preview: DesignPreview; storageKey: string }) {
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
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setPreferences(next); setMessage(`${person.display_name} 的方案 ${choices[persona]} 偏好已保存在此浏览器。`); }
    catch { setMessage('浏览器未允许保存；可以复制选择发给我。'); }
  };
  const copyPreference = async () => {
    try { await navigator.clipboard.writeText(`${person.display_name}：倾向方案 ${choices[persona]}「${current.title}」，参考 ${current.source}。${note ? `想调整：${note}` : ''}`); setMessage('已复制，可直接粘贴给我。'); }
    catch { setMessage('复制未成功，请直接把方案字母和想改的地方发给我。'); }
  };
  const previewTask = (t: DesignTask) => <button key={t.id} className="ui-rd-task" aria-pressed={detailType === 'task' && t.id === taskId} onClick={() => chooseTask(t)}>
    <span><small>{designHouses.find(h => h.id === t.house)?.name} · {t.category}</small><strong>{t.title}</strong><span>{t.detail}</span></span>
    <span className="ui-rd-task-meta"><span>{t.status}</span><span>{t.person} · {t.due}</span></span>
  </button>;
  const categories = current.layout === 'portfolio' || current.layout === 'register' ? ['全部', '有卡点', ...(isJessie ? ['待我审核', '装修', '预上市'] : ['装修', '售出收尾'])]
    : current.layout === 'tasks' ? ['全部', '采购', 'Permit / 设计', '保险资料', '上市准备', '待审核'] : ['全部', '等待中', '进行中', '资料待补', '提前准备'];
  const toolbar = <div className="ui-rd-toolbar"><label>搜索房屋或事项<input value={query} onChange={e => setQuery(e.target.value)} placeholder="例如 Cedar、燃气、采购" /></label><div role="group" aria-label="筛选预览内容">{categories.map(f => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f}</button>)}</div></div>;
  const houseTabs = <div className="ui-rd-tabs" role="group" aria-label="房屋业务页签">{['总览', '任务', '采购', '预算', '资料'].map(t => <button key={t} aria-pressed={houseTab === t} onClick={() => { setHouseTab(t); setFileOpen(false); }}>{t}</button>)}</div>;
  const houseContent = <>
    {houseTab === '总览' && <div className="ui-rd-house-brief"><div><small>目前位置</small><h3>{house.stage}</h3><p>{house.focus}</p></div><div><small>下一动作</small><h3>{house.next}</h3><p>示例任务截止 {house.date} · 阶段与任务执行状态分开</p></div><h3>这套房正在推进的事项</h3>{designTasks.filter(t => t.house === houseId).map(previewTask)}</div>}
    {houseTab === '任务' && <>{taskRows.length ? taskRows.map(previewTask) : <p className="ui-rd-empty">当前筛选没有事项，清除筛选后查看。</p>}</>}
    {houseTab === '采购' && <div className="ui-rd-house-brief"><h3>分阶段采购</h3><p>{houseId === 'oak' ? '厨房材料已到货，交付待核对。' : '这套示例房屋还没有采购条目。可以切换到 46 Oak 查看已有采购。'}</p>{(houseId === 'oak' ? ['厨房材料 · 已到货', '照明灯具 · 已订购', '五金配件 · 待规格'] : []).map(t => <div className="ui-rd-resource" key={t}><span>{t}</span>{t.startsWith('厨房') ? <Button onClick={() => { setDetailType('task'); setTaskId('procurement-oak'); setHouseId('oak'); setDetailOpen(true); setFileOpen(false); }}>查看交付</Button> : <span>采购记录 · 示例</span>}</div>)}</div>}
    {houseTab === '预算' && <div className="ui-rd-house-brief"><h3>预算与已记录支出</h3><p>当前房屋的合成金额，用于比较资料入口。</p><dl className="ui-rd-facts"><dt>装修计划预算</dt><dd>$80,000</dd><dt>已记录支出</dt><dd>$32,000</dd><dt>剩余预算</dt><dd>$48,000</dd></dl><p>剩余预算不等于利润；这里没有人员效率评分。</p></div>}
    {houseTab === '资料' && <div className="ui-rd-house-brief"><h3>房屋资料</h3>{['保险文件', '到货照片', 'Permit 申请资料'].map(name => <button className="ui-rd-resource" key={name} onClick={() => { setFileOpen(true); setResource(name); setDetailType(name === '保险文件' ? 'service' : 'house'); setService('保险'); setDetailOpen(true); }}>{name}<span>查看示例记录 →</span></button>)}</div>}
  </>;
  const main = <div className="ui-rd-main">
    <header className="ui-rd-work-header"><div><small>{isJessie ? '项目统筹' : '房屋服务'} / {current.title}</small><h2>{isJessie ? 'Jessie 的工作界面' : 'Kody 的工作界面'}</h2><p>{isJessie ? '全部项目 → 单套房情况 → 需要我推进的事项' : '了解全部项目位置，办理我负责的水电、燃气与保险资料'}</p></div><EmployeeAvatar user={person} /></header>
    {current.layout === 'house' || drilled ? <div className="ui-rd-house-layout"><nav aria-label="示例房屋导航">{designHouses.map(h => <button key={h.id} aria-pressed={h.id === houseId} onClick={() => { chooseHouse(h.id); setDetailOpen(false); setHouseTab('总览'); }}><strong>{h.name}</strong><small>{h.stage}</small></button>)}</nav><section>{drilled && <Button iconName="arrow-left" onClick={() => { setDrilled(false); setHouseTab('总览'); }}>返回全部房屋</Button>}<div className="ui-rd-house-title"><h2>{house.name}</h2><span>{house.stage}</span></div>{houseTabs}{houseContent}</section></div>
    : current.layout === 'portfolio' ? <>{toolbar}<div className="ui-rd-section-heading"><h3>全部房屋 <small>{houses.length} 套</small></h3><Button onClick={() => setSort(!sort)}>{sort ? '恢复默认顺序' : '按任务截止排序'}</Button></div><div className="ui-rd-portfolio"><div className="ui-rd-column-head"><span>房屋 / 位置</span><span>当前重点与下一动作</span><span>任务截止</span></div>{sortedHouses.map(h => <button key={h.id} aria-pressed={h.id === houseId} onClick={() => chooseHouse(h.id)}><span><strong>{h.name}</strong><small>{h.stage}</small></span><span><strong>{h.focus}</strong><small>{h.next}</small></span><span>{h.date}</span></button>)}</div>{!houses.length && <p className="ui-rd-empty">没有符合筛选的房屋。</p>}</>
    : current.layout === 'register' ? <>{toolbar}<div className="ui-rd-register"><div className="ui-rd-register-head"><span>房屋 / 位置</span>{(['水', '电', '燃气', '保险'] as const).map(s => <span key={s}>{s}</span>)}</div>{houses.map(h => <div key={h.id} className="ui-rd-register-row"><span><strong>{h.name}</strong><small>{h.stage}</small></span>{(['水', '电', '燃气', '保险'] as const).map(s => <button key={s} aria-label={`${h.name} · ${s} · ${serviceState(h, s)}`} aria-pressed={h.id === houseId && s === service} onClick={() => chooseService(h, s)}><small>{s}</small><strong>{serviceState(h, s)}</strong>{s === '保险' && <small>{h.expiry || '未填到期日'}</small>}</button>)}</div>)}</div>{!houses.length && <p className="ui-rd-empty">没有符合筛选的房屋。</p>}</>
    : current.layout === 'providers' ? <><div className="ui-rd-tabs" role="group" aria-label="服务类别">{(['水', '电', '燃气', '保险'] as const).map(s => <button key={s} aria-pressed={service === s} onClick={() => { setService(s); setDetailType('service'); setFileOpen(false); setEdit(false); }}>{s}</button>)}</div><p className="ui-rd-caption">{service === '保险' ? '按房屋查找现有保险文件，不把文件上传等同于保单有效。' : '联系一家服务公司时，把相关房屋账户放在一起。'}</p>{(service === '燃气' ? ['Metro Gas（示例）', 'City Gas（示例）'] : service === '保险' ? ['保险文件'] : [service === '水' ? 'City Water（示例）' : 'Metro Electric（示例）']).map(company => <section className="ui-rd-provider" key={company}><div><small>{service === '保险' ? '房屋文件' : '服务公司'}</small><h3>{company}</h3></div><div>{designHouses.filter(h => service !== '燃气' || h.company === company).map(h => <button key={h.id} aria-pressed={h.id === houseId} onClick={() => chooseService(h, service)}><strong>{h.name}</strong><span>{serviceState(h, service)}</span><small>{h.stage}</small><span>查看{service === '保险' ? '资料' : '账户'} →</span></button>)}</div></section>)}</>
    : <>{toolbar}{current.layout === 'queue' ? ['进行中', '等待中', '资料待补', '提前准备'].map(status => { const rows = taskRows.filter(t => t.status === status); return rows.length ? <section key={status} className="ui-rd-task-group"><h3>{status} <small>{rows.length}</small></h3>{rows.map(previewTask)}</section> : null; }) : <><div className="ui-rd-section-heading"><h3>跨房业务事项</h3><span>{taskRows.length} 项</span></div>{taskRows.map(previewTask)}</>}{!taskRows.length && <p className="ui-rd-empty">当前没有符合筛选的事项。</p>}</>}
  </div>;
  const selectionVisible = current.layout === 'portfolio' || current.layout === 'register' ? drilled || houses.some(h => h.id === houseId) : ['tasks', 'queue'].includes(current.layout) ? taskRows.some(t => t.id === taskId) : true;
  const detail = <div className="ui-rd-detail"><small>{house.name} · {house.stage}</small><h2>{detailType === 'task' ? task.title : detailType === 'service' ? `${service}${service === '保险' ? '资料' : '账户'}` : '房屋摘要'}</h2>
    {detailType === 'house' ? <><p>{house.focus}</p><dl className="ui-rd-facts"><dt>下一动作</dt><dd>{house.next}</dd><dt>任务截止</dt><dd>{house.date}</dd><dt>当前阶段</dt><dd>{house.stage}</dd></dl><h3>深入这套房</h3><div className="ui-rd-detail-links">{['任务', '采购', '预算', '资料'].map(t => <Button key={t} onClick={() => { setDrilled(current.layout !== 'house'); setHouseTab(t); setFilter('全部'); setQuery(''); setDetailOpen(false); setFileOpen(false); }}>查看{t}</Button>)}</div><h3>最近协作</h3><p>{house.next}。记录显示当前事项仍需跟进。</p></>
    : detailType === 'task' ? <><strong>{task.status}</strong><p>{task.detail}</p><dl className="ui-rd-facts"><dt>负责人</dt><dd>{task.person}</dd><dt>任务截止</dt><dd>{task.due}</dd><dt>记录来源</dt><dd>{task.source}</dd></dl>{task.service ? <Button variant="primary" onClick={() => { setService(task.service!); setDetailType('service'); }}>{task.service === '保险' ? '查看保险文件' : '打开服务账户'}</Button> : <Button variant="primary" onClick={() => { setResource(task.category === '采购' ? '厨房材料到货照片' : task.title); setFileOpen(!fileOpen); }}>查看交付资料</Button>}<details><summary>相关房屋与记录</summary><p>{house.name} · {house.stage}</p><p>执行记录与阶段关键确认分开保留；这里不代替 D/J 确认。</p></details></>
    : <><div className="ui-rd-tabs" role="group" aria-label="摘要服务切换">{(['水', '电', '燃气', '保险'] as const).map(s => <button key={s} aria-pressed={s === service} onClick={() => { setService(s); setFileOpen(false); setEdit(false); }}>{s}</button>)}</div>{service === '保险' ? <><strong>{house.insurance}</strong><dl className="ui-rd-facts"><dt>文件</dt><dd>{house.name} 保险.pdf（合成）</dd><dt>文件到期日</dt><dd>{house.expiry || '未填写'}</dd><dt>来源</dt><dd>房屋文件 · 保险</dd></dl><p>已上传仅表示存在文件，不等于核验了保险有效性。</p><Button variant="primary" onClick={() => setFileOpen(!fileOpen)}>{fileOpen ? '收起文件详情' : '查看文件详情'}</Button></>
    : <><strong>{serviceState(house, service)}</strong><dl className="ui-rd-facts"><dt>公司</dt><dd>{service === '燃气' ? house.company : service === '水' ? 'City Water（示例）' : 'Metro Electric（示例）'}</dd><dt>账户编号</dt><dd>DEMO-{house.id.toUpperCase()}（合成）</dd><dt>开户姓名</dt><dd>示例项目公司</dd><dt>卡点</dt><dd>{savedNotes[serviceKey] ?? (house.id === 'cedar' && service === '燃气' ? '等待燃气公司确认到场' : house.id === 'pine' && service === '燃气' ? '等待关闭申请回复' : '未记录卡点')}</dd></dl><Button variant="primary" onClick={() => { setDraftNote(savedNotes[serviceKey] ?? ''); setEdit(!edit); }}>{edit ? '取消编辑' : '编辑账户卡点'}</Button>{edit && <div className="ui-rd-edit"><label>示例账户卡点<textarea value={draftNote} maxLength={500} onChange={e => setDraftNote(e.target.value)} /></label><Button onClick={() => { setSavedNotes(v => ({ ...v, [serviceKey]: draftNote.trim() || '未记录卡点' })); setEdit(false); setMessage('示例卡点已更新，可切换其他方案查看；刷新后恢复。'); }}>保存到本次预览</Button></div>}<p className="ui-muted">账户密码不在比较稿中展示；现有账户资料权限保持不变。</p></>}</>}
    {fileOpen && <div className="ui-rd-file"><h3>资料预览</h3><p>{detailType === 'service' ? `${house.name} 保险文件` : `${house.name} · ${resource || '交付资料'}`}</p><p>合成样例 · 用于比较查找资料的路径。</p><p>{detailType === 'service' ? `记录到期日：${house.expiry || '尚未填写'}` : '文件来源、所属房屋和交付批次应在这里持续可见。'}</p><Button onClick={() => setFileOpen(false)}>关闭资料预览</Button></div>}
  </div>;
  return <ContentLayout maxContentWidth={1680} header={<Header variant="h1" description="从员工实际要做的工作出发，比较完整工作界面的组织方式。">按角色比较设计</Header>}>
    <div className="ui-rd-role-brief"><h2>{isJessie ? 'Jessie 需要先掌握全盘，再推进具体的人和事' : 'Kody 需要知道房屋进度，也要快速找到办理所需资料'}</h2><p>{isJessie ? '她不是只处理待办：要在多套房之间统筹采购、资料、团队交付和上市准备。三种方案比较的是：先看一套房、全部房，还是同类业务。' : '他协助 Jessie 处理水电、燃气与保险，维护账户并记录卡点。三种方案比较的是：先按房屋查漏、按事项办事，还是按服务公司集中处理。'}</p></div>
    <div className="ui-rd-directions" role="group" aria-label="选择参考设计">{designs.map(d => <button key={d.id} aria-pressed={d.id === choices[persona]} onClick={() => switchDesign(d.id)}><small>方案 {d.id} · {d.source}{d.id === (isJessie ? 'B' : 'A') ? ' · 建议先看' : ''}</small><strong>{d.title}</strong><span>{d.question}</span></button>)}</div>
    <div className="ui-rd-reference"><div><strong>借鉴 {current.source} 的什么？</strong><p>{current.borrowed}</p></div><div><strong>放到 {person.display_name} 的工作里</strong><p>{current.adapted}</p></div><div><strong>适合与取舍</strong><p>{current.gain} {current.cost}</p></div><a href={current.url} target="_blank" rel="noreferrer">官方参考：{current.sourceLabel} ↗</a></div>
    <div className="ui-rd-preview-caption"><strong>{current.title} · 可点击工作界面</strong><span>同一批合成房屋与资料；自由切房、筛选和看详情。沿用已选定的轻量 B 视觉。</span></div>
    <CollaborationWorkspace main={main} detail={selectionVisible ? detail : <p className="ui-rd-empty">当前选中项不在筛选结果中，请从列表重新选择。</p>} detailOpen={detailOpen && selectionVisible} onBack={() => setDetailOpen(false)} />
    <section className="ui-rd-preference" aria-label="记录设计选择"><div><h2>{person.display_name} 用哪种更顺手？</h2><p>偏好只保存在此浏览器，复制后发给我即可。预览不是实际员工账号，也不写项目数据。</p>{preferences[persona] && <p>已记录：方案 {preferences[persona]!.choice} · {designs.find(d => d.id === preferences[persona]!.choice)?.title}</p>}</div><label>哪些信息或操作应该更靠前？<textarea value={note} maxLength={1000} onChange={e => setNote(e.target.value)} placeholder="例如：Jessie 先看所有房屋的采购；Kody 要更容易找到公司账户" /></label><div className="ui-actions ui-actions-start"><Button variant="primary" onClick={savePreference}>我倾向 {choices[persona]} · {current.title}</Button><Button onClick={copyPreference}>复制选择与意见</Button></div>{message && <p role="status">{message}</p>}</section>
  </ContentLayout>;
}
