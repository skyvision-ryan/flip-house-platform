import Checkbox from '@cloudscape-design/components/checkbox';
import NewTodayBadge from '../components/NewTodayBadge';
import { useBusinessDate } from '../lib/useBusinessDate';
import { compareNewToday, isNewToday } from '../lib/projectDates';
import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
import Alert from '@cloudscape-design/components/alert';
import Board, { BoardProps } from '@cloudscape-design/board-components/board';
import BoardItem from '@cloudscape-design/board-components/board-item';
import { useCollection } from '@cloudscape-design/collection-hooks';
import Box from '@cloudscape-design/components/box';
import BreadcrumbGroup from '@cloudscape-design/components/breadcrumb-group';
import Button from '@cloudscape-design/components/button';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import Cards from '@cloudscape-design/components/cards';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import TextFilter from '@cloudscape-design/components/text-filter';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, DashboardRole, DashboardSummary, DashboardWidgets, Project, Update } from '../api/client';
import CoverImage from '../components/CoverImage';
import LeadGroups from '../components/LeadGroups';
import MyTodoTable from '../components/MyTodoTable';
import ReviewTag from '../components/ReviewTag';
import { RoleLabel } from '../components/RoleLabel';
import HelpText from '../components/HelpText';
import StatusBadge from '../components/StatusBadge';
import UpdatesList from '../components/UpdatesList';
import WorkbenchFocus from '../components/WorkbenchFocus';
import { BulletList, compactMoney, DeltaBadge, fullMoney, HBars, InlineBar, Meter, StackedBar, StatTile, Trend } from '../components/charts';
import Header from '../components/ui/Header';
import { CardFrame } from '../components/ui/Surface';
import Table from '../components/ui/Table';
import { useActor } from '../lib/actor';
import { dateStr, money, pct } from '../lib/format';
import { Insight, loadInsights } from '../lib/insights';
import { isLead } from '../lib/leads';
import { useMeta } from '../lib/meta';
import { useRole } from '../lib/role';
import { filterFromParams, groupFilterOptions, matchesGroupFilter } from '../lib/stageGroups';
import { stageText } from '../lib/stepDisplay';

type WidgetId = 'attention' | 'money' | 'stages' | 'recent' | 'list' | 'upcoming' | 'capital' | 'retro' | 'weekly' | 'vendors' | 'funnel' | 'updates' | 'turns'
  | 'gates' | 'mytodo' | 'procurement' | 'site' | 'utilities' | 'permits' | 'design' | 'saledocs' | 'boss';
type ItemData = { title: string };
type Item = BoardProps.Item<ItemData>;

const WIDGETS: Record<WidgetId, ItemData & { cols: number; rows: number }> = {
  attention: { get title() { return uiText("cardRegistry.needs.attention"); }, cols: 2, rows: 4 },
  money: { get title() { return uiText("cardRegistry.active.projects.spending.gray.background.budget"); }, cols: 2, rows: 4 },
  stages: { get title() { return uiText("founderDesign.stage.distribution"); }, cols: 1, rows: 4 },
  recent: { get title() { return uiText("cardRegistry.recent.updates"); }, cols: 3, rows: 4 },
  list: { get title() { return uiText("cardRegistry.project.list"); }, cols: 4, rows: 6 },
  upcoming: { get title() { return uiText("cardRegistry.next.30.days"); }, cols: 2, rows: 4 },
  capital: { get title() { return uiText("cardRegistry.capital.committed"); }, cols: 2, rows: 4 },
  retro: { get title() { return uiText("cardRegistry.estimate.accuracy.completed.projects"); }, cols: 4, rows: 3 },
  weekly: { get title() { return uiText("cardRegistry.expenses.over.the.last.12.weeks"); }, cols: 2, rows: 4 },
  vendors: { get title() { return uiText("cardRegistry.top.five.suppliers.by.spending"); }, cols: 2, rows: 4 },
  funnel: { get title() { return uiText("cardRegistry.follow.up.stages.for.unpurchased.properties"); }, cols: 1, rows: 4 },
  updates: { get title() { return uiText("cardRegistry.who.updated.what"); }, cols: 2, rows: 4 },
  turns: { get title() { return uiText("cardRegistry.next.action.for.each.property"); }, cols: 4, rows: 7 },
  gates: { get title() { return uiText("cardRegistry.milestones.awaiting.my.confirmation"); }, cols: 2, rows: 4 },
  mytodo: { get title() { return uiText("cardRegistry.my.tasks.2"); }, cols: 4, rows: 6 },
  procurement: { get title() { return uiText("cardRegistry.procurement.order.follow.up"); }, cols: 4, rows: 6 },
  site: { get title() { return uiText("cardRegistry.construction.site"); }, cols: 4, rows: 4 },
  utilities: { get title() { return uiText("cardRegistry.utilities.and.insurance"); }, cols: 3, rows: 4 },
  permits: { get title() { return uiText("cardRegistry.permits.and.inspections"); }, cols: 3, rows: 4 },
  design: { get title() { return uiText("cardRegistry.design.deliverables"); }, cols: 2, rows: 4 },
  saledocs: { get title() { return uiText("cardRegistry.sale.documents"); }, cols: 3, rows: 4 },
  boss: { get title() { return uiText("cardRegistry.leadership.overview"); }, cols: 4, rows: 2 },
};
/** KAN-71：买入价或目标售价缺一项的项目没算进预计利润，汇总要说出来，不能把「未知」表达成 0。 */
const incompleteNote = (n: number | null | undefined) => (n ? uiText("sentences.properties.lack.purchase.or.target.sale.prices.and.are.excluded", { value1: (n) }) : null);

const MONEY_WIDGETS: WidgetId[] = ['money', 'capital', 'weekly', 'retro', 'vendors', 'boss'];
// v8：项目表不再是看板的一项，而是页面固定的一块，所以旧存档里的 list 必须丢掉，
// 否则会和固定那块重复出现两张表。看板现在只放「额外」小组件。
const layoutKey = (actor: string) => `boardLayout.v8.${actor}`;

function mkItem(id: WidgetId, extra?: Partial<Item>): Item {
  const w = WIDGETS[id];
  return { id, columnSpan: w.cols, rowSpan: w.rows, data: { get title() { return w.title; } }, ...extra };
}
function loadLayout(actor: string, defaults: WidgetId[]): Item[] {
  try {
    const raw = localStorage.getItem(layoutKey(actor));
    if (raw) {
      const saved = JSON.parse(raw) as { id: WidgetId; columnSpan?: number; rowSpan?: number; columnOffset?: Record<number, number> }[];
      // 丢掉旧存档里的 list：它现在固定渲染在页面上，留在看板里会出现两张表
      const items = saved.filter((s) => WIDGETS[s.id] && s.id !== 'list')
        .map((s) => mkItem(s.id, { columnSpan: s.columnSpan, rowSpan: s.rowSpan, columnOffset: s.columnOffset }));
      if (items.length) return items;
    }
  } catch { /* ignore */ }
  return defaults.map((id) => mkItem(id));
}
function saveLayout(actor: string, items: ReadonlyArray<Item>) {
  try { localStorage.setItem(layoutKey(actor), JSON.stringify(items.map((i) => ({ id: i.id, columnSpan: i.columnSpan, rowSpan: i.rowSpan, columnOffset: i.columnOffset })))); } catch { /* ignore */ }
}

const boardI18n: BoardProps.I18nStrings<ItemData> = {
  liveAnnouncementDndStarted: (t) => (systemText(t === 'resize' ? '开始调整大小' : '开始拖动')),
  liveAnnouncementDndItemReordered: () => uiText("dashboard.moved"),
  liveAnnouncementDndItemResized: () => uiText("dashboard.resized"),
  liveAnnouncementDndItemInserted: () => uiText("dashboard.inserted"),
  liveAnnouncementDndCommitted: (t) => (systemText(t === 'resize' ? '大小已确定' : '位置已确定')),
  liveAnnouncementDndDiscarded: () => uiText("stepsPanel.canceled"),
  liveAnnouncementItemRemoved: (op) => uiText("sentences.removed", { value1: (op.item.data.title) }),
  get navigationAriaLabel() { return uiText("dashboard.board.navigation"); },
  navigationItemAriaLabel: (item) => (item ? item.data.title : systemText('空')),
};
const itemI18n = { get dragHandleAriaLabel() { return uiText("dashboard.drag"); }, get resizeHandleAriaLabel() { return uiText("dashboard.resize"); }, get dragHandleTooltipText() { return uiText("dashboard.drag.to.move"); }, get resizeHandleTooltipText() { return uiText("dashboard.drag.to.resize"); } };

function Stat({ label, value, sub, help }: { label: string; value: string; sub?: string; help?: string }) {
  useLanguage();
  return <StatTile label={label} value={value} sub={sub} help={help} />;
}

const shortDate = (d: string) => d.slice(5).replace('-', '/');

export default function Dashboard({ listOnly = false }: { listOnly?: boolean }) {
  useLanguage();
  const navigate = useNavigate();
  const meta = useMeta();
  const role = useRole();
  const { me } = useActor();
  // 项目表已经固定渲染在页面上，看板里只剩「额外」小组件，默认一个都没有。
  // 注意**不动** DASHBOARD_LAYOUTS 那份后端字典——它同时决定 widget_access，
  // 动了角色就加不回自己的小组件。下面 canAdd 仍然读 widget_access，
  // 所以「添加小组件」照样能把关注、门、水电加回来，加回来的出现在表下面。
  const defaults: WidgetId[] = me?.role_code === '采购' ? ['procurement'] : [];
  const canAdd = (id: WidgetId) => (role.actor === '老板' || role.actor === '负责人' || (meta?.widget_access?.[id] ?? []).includes(role.actor)) && (!MONEY_WIDGETS.includes(id) || role.canReadMoney);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [roleData, setRoleData] = useState<DashboardRole | null>(null);
  const [widgets, setWidgets] = useState<DashboardWidgets | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [updates, setUpdates] = useState<Update[]>([]);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ReadonlyArray<Item>>(() => loadLayout(role.actor, defaults));
  // KAN-75 块 2：列表按「位置」筛（买房 · 未购入 / escrow 中 / 装修 …），从 URL ?group=&sub= 取初值；
  // 旧的 /leads 入口就跳到 ?group=buying&sub=pre。工作台（非 listOnly）默认不列未购入的房。
  const [params, setParams] = useSearchParams();
  const day = useBusinessDate();
  const dayRef = useRef(day); dayRef.current = day;
  const focusId = Number(params.get('focus')) || null;
  const focusHandled = useRef<number | null>(null);
  const todayOnly = params.get('today') === '1';
  const queryText = (params.get('q') ?? '').toLowerCase();
  const defaultSorting = {sortingColumn: {sortingComparator: (a: Project, b: Project) => compareNewToday(a, b, dayRef.current)}, isDescending:false};
  const sortField = params.get('sort');
  const validSort = sortField && ['name','stage','budget_used_pct','target_arv','updated_at'].includes(sortField);
  const initialSorting = validSort ? {sortingColumn:{sortingField:sortField}, isDescending:params.get('desc') === '1'} : defaultSorting;
  const groupFilter = filterFromParams(params.get('group'), params.get('sub'));
  const setGroupFilter = (v: string) => setParams((prev) => { const n = new URLSearchParams(prev); if (!v) { n.delete('group'); n.delete('sub'); } else { const [g, sub] = v.split(':'); n.set('group', g); if (sub) n.set('sub', sub); else n.delete('sub'); } return n; }, { replace: true });

  const reloadRole = async () => { setRoleData(await api.dashboardRole().catch(() => null)); };
  useEffect(() => {
    setLoading(true); setLoadError('');
    setItems(loadLayout(role.actor, defaults));
    Promise.all([api.dashboard(), api.projects(), api.widgets(), api.updates(20).catch(() => [] as Update[]), api.dashboardRole().catch(() => null)])
      .then(async ([s, p, w, u, r]) => { setSummary(s); setProjects(p); setWidgets(w); setUpdates(u); setRoleData(r); setInsights(await loadInsights(p, role.actor)); })
      .catch(e => setLoadError(e.message)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role.actor, meta]);

  // 工作台默认不列「买房 · 未购入」的房子（没买的房不是项目）；要看它们用位置筛选，或从旧 /leads 链接跳过来。
  // **只在这里筛，不动 projects state**——下面的 recent、active、热线索计数和 loadInsights 都直接读它。
  // 判据走 lib/leads 的 isLead（current_stage 停在 s1），和分组视图是同一个函数。
  const notLead = useMemo(() => projects.filter((p) => !isLead(p)), [projects]);
  const showLeadGroups = groupFilter === 'buying:pre';
  const filtered = useMemo(() => (groupFilter ? projects.filter((p) => matchesGroupFilter(p.group_position, groupFilter)) : listOnly ? projects : notLead).filter(p => (!todayOnly || isNewToday(p.created_at, day)) && (!queryText || p.name.toLowerCase().includes(queryText) || p.property.address_std.toLowerCase().includes(queryText))), [projects, notLead, groupFilter, listOnly, todayOnly, day, queryText]);
  const { items: rows, allPageItems, actions, collectionProps, filterProps, paginationProps } = useCollection(filtered, {
    filtering: {
      defaultFilteringText: params.get('q') ?? '',
      filteringFunction: (item, s) => { const t = s.toLowerCase(); return item.name.toLowerCase().includes(t) || item.property.address_std.toLowerCase().includes(t); },
      empty: projects.length ? <Box textAlign="center" color="inherit"><b>{uiText("dashboard.no.matching.projects")}</b></Box> : <Box textAlign="center" color="inherit"><b>{uiText("dashboard.no.projects.yet")}</b><Box padding={{ bottom: 's' }} variant="p" color="inherit">{uiText("dashboard.enter.an.address.to.look.up.property.data")}</Box><span>{role.can('create_project') ? <Button variant="primary" onClick={() => navigate('/projects/new')}>{uiText("app.new.project")}</Button> : uiText("dashboard.contact.the.project.lead.to.assign.a.property")}</span></Box>,
      noMatch: <Box textAlign="center" color="inherit"><b>{uiText("dashboard.no.matching.projects")}</b></Box>,
    },
    pagination: { pageSize: 10 },
    sorting: { defaultState: initialSorting },
  });

  useEffect(() => { actions.setFiltering(params.get('q') ?? ''); }, [params.get('q')]);
  const searchProps = { ...filterProps, onChange: ({ detail }: { detail: { filteringText: string } }) => { actions.setFiltering(detail.filteringText); setParams(prev => { const next = new URLSearchParams(prev); if (detail.filteringText) next.set('q', detail.filteringText); else next.delete('q'); return next; }, { replace: true }); } };

  useEffect(() => {
    if (loading || !focusId || focusHandled.current === focusId) return;
    const index = allPageItems.findIndex(p => p.id === focusId);
    if (index >= 0) actions.setCurrentPage(Math.floor(index / 10) + 1);
    focusHandled.current = focusId;
  }, [loading, focusId, allPageItems]);
  const sortProps = {...collectionProps, onSortingChange: (event: Parameters<NonNullable<typeof collectionProps.onSortingChange>>[0]) => {
    collectionProps.onSortingChange?.(event);
    setParams(prev => {const n = new URLSearchParams(prev); const field = event.detail.sortingColumn.sortingField; field ? n.set('sort', field) : n.delete('sort'); event.detail.isDescending ? n.set('desc','1') : n.delete('desc'); return n;}, {replace:true});
  }};
  const todayFilter = <Checkbox checked={todayOnly} onChange={({detail})=>setParams(prev=>{const n=new URLSearchParams(prev);detail.checked?n.set('today','1'):n.delete('today');return n;},{replace:true})}>{uiText('newToday.filter')}</Checkbox>;
  const focusedProject = projects.find(p => p.id === focusId);
  const focusNotice = focusedProject ? <Alert type="info" action={<Button onClick={()=>navigate(`/projects/${focusedProject.id}`)}>{uiText('newToday.open')}</Button>}>{uiText(filtered.some(p=>p.id===focusId) ? 'newToday.located' : 'newToday.filtered', {name:focusedProject.name})}</Alert> : null;
  const recent = [...projects].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)).slice(0, 3);
  const groupOptions = groupFilterOptions(meta?.stage_groups);
  const groupSelected = groupOptions.find((o) => o.value === groupFilter) ?? groupOptions[0];
  const active = projects.filter((p) => p.stage === 'active');
  const go = (href: string) => navigate(href === '/projects/new' && listOnly ? `/projects/new?returnTo=${encodeURIComponent(`/projects?${params}`)}` : href);
  const projLink = (id: number, name: string) => <Link href={`/projects/${id}`} onFollow={(e) => { e.preventDefault(); go(`/projects/${id}`); }}>{name}</Link>;

  const projectColumns = [
    { id: 'name', header: uiText("app.projects"), sortingField: 'name', width: '34%', minWidth: 260, cell: (p: Project) => (
      <div className="ui-row-spaced">
        <CoverImage propertyId={p.property.id} width={56} height={40} radius={6} showLabel={false} />
        <div className="ui-stack-min" id={`project-${p.id}`}>
          {projLink(p.id, p.name)} <NewTodayBadge createdAt={p.created_at} day={day} />
          {p.id === focusId && <Box fontWeight="bold">{uiText('newToday.locatedRow')}</Box>}
          <Box variant="small" color="text-body-secondary">{p.property.address_std}</Box>
        </div>
      </div>
    ) },
    // KAN-65：阶段只认六阶段清单算出来的 current_stage。旧的 stage/substage 是派生缓存，
    // 「② 买房与过户」会被 STAGE_TO_LEGACY 映射成「在建 · 施工中」，在列表上读起来是错的。
    { id: 'stage', header: uiText("dashboard.position.status"), sortingField: 'stage', width: '20%', minWidth: 130, cell: (p: Project) => <SpaceBetween size="xs"><span>{stageText(p, meta)}</span><StatusBadge status={p.status} /></SpaceBetween> },
    // 百分比一行、金额一行。原先「99.0%（$81,660 / $82,500）」塞在一格里，
    // 把最后一列挤成「更」，表底出现横向滚动条。
    { id: 'budget', header: uiText("dashboard.budget.used"), width: '19%', sortingField: 'budget_used_pct', cell: (p: Project) => ((p.budget_planned ?? 0) > 0 ? (
      <div>
        <div>{pct(p.budget_used_pct)}</div>
        <Box variant="small" color="text-body-secondary">{money(p.budget_spent)} / {money(p.budget_planned)}</Box>
      </div>
    ) : '—') },
    { id: 'arv', header: uiText("dashboard.target.sale.price"), width: '14%', sortingField: 'target_arv', cell: (p: Project) => money(p.target_arv) },
    { id: 'updated', header: uiText("dashboard.updated"), width: '13%', sortingField: 'updated_at', cell: (p: Project) => dateStr(p.updated_at) },
  ];

  const groupSelect = <Select selectedOption={groupSelected} options={groupOptions} onChange={({ detail }) => setGroupFilter(detail.selectedOption.value ?? '')} ariaLabel={uiText("dashboard.filter.by.position")} />;
  const onLeadPatched = (updated: Project) => setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  // KAN-75 块 2：筛到「买房 · 未购入」时按跟进档位分组（原线索页的形态，复用 LeadGroups）；其余位置用表。
  const leadView = (
    <SpaceBetween size="m">
      <Header variant="h2" counter={`(${filtered.length})`} help={uiText("dashboard.properties.without.confirmed.open.escrow.are.grouped.by.follow")} actions={<SpaceBetween direction="horizontal" size="xs">{groupSelect}{listOnly && role.can('create_project') && <Button variant="primary" onClick={() => go('/projects/new')}>{uiText("app.new.project")}</Button>}</SpaceBetween>}>{uiText("projectPreplan.acquisition.not.purchased")}</Header>
      <HelpText>{uiText("dashboard.suggested.tasks.follow.checklist.order.a.responsible.role.is")}</HelpText>
      <div>{todayFilter}</div>
      <LeadGroups projects={loading ? null : allPageItems as Project[]} meta={meta} canEdit={role.can('edit_project')} onPatched={onLeadPatched} />
      <Box variant="small" color="text-body-secondary">{uiText("dashboard.list.price.and.automated.valuation.are.references.not.confirmed")}</Box>
    </SpaceBetween>
  );

  const table = showLeadGroups ? leadView : (
    <Table cardId="project-list"
      {...sortProps}
      items={rows}
      loading={loading}
      loadingText={uiText("dashboard.loading")}
      variant={listOnly ? 'container' : 'embedded'}
      resizableColumns

      header={listOnly ? <Header variant="h2" counter={`(${filtered.length})`} actions={role.can('create_project') ? <Button variant="primary" onClick={() => go('/projects/new')}>{uiText("app.new.project")}</Button> : undefined}>{uiText("cardRegistry.project.list")}</Header> : undefined}
      filter={
        <SpaceBetween direction="horizontal" size="xs">
          <TextFilter {...searchProps} filteringPlaceholder={uiText("dashboard.search.by.project.name.or.address")} countText={uiText("sentences.matches", { value1: (rows.length) })} />
          {groupSelect}{todayFilter}
        </SpaceBetween>
      }
      pagination={<Pagination {...paginationProps} />}
      columnDefinitions={role.canReadMoney ? projectColumns : projectColumns.filter(c => !['budget','arv'].includes(c.id))}
    />
  );

  if (listOnly) {
    return (
      <ContentLayout
        breadcrumbs={<BreadcrumbGroup items={[{ text: uiText("app.workspace"), href: '/' }, { text: uiText("app.projects"), href: '/projects' }]} onFollow={(e) => { e.preventDefault(); go(e.detail.href); }} />}
        header={<Header variant="h1" description={uiText("dashboard.open.a.property.to.view.progress.and.assigned.work")}>{uiText("dashboard.all.projects")}</Header>}
      >
        {loadError && <Alert type="error" header={uiText("dashboard.could.not.load.projects")}>{systemText(loadError)}</Alert>}
        <SpaceBetween size="m">{focusNotice}{table}</SpaceBetween>
      </ContentLayout>
    );
  }

  const empty = (t: string) => <Box textAlign="center" color="inherit" padding="l">{loading ? uiText("dashboard.loading.2") : systemText(t)}</Box>;

  const widget = (id: WidgetId) => {
    switch (id) {
      case 'attention': {
        // 审计 #A01 已把整块彩色底换成白底 + StatusIndicator。KAN-63 再进一步：
        // 手写的一叠圆角卡片改成 Cloudscape Table——同样的五列信息，交给组件去排，
        // 窄屏折行、表头对齐都不用自己算。
        const level: Record<string, 'error' | 'warning' | 'info'> = { error: 'error', warning: 'warning', info: 'info' };
        return insights.length ? (
          <Table
            variant="embedded"
            // 只去掉 minWidth 不够：Cloudscape 单元格默认 white-space: nowrap，
            // 文字不换行照样把表撑到 998px（卡片只有 633px）。wrapLines 才是让它折行的开关。
            wrapLines
            items={insights.slice(0, 8)}
            columnDefinitions={[
              { id: 'level', header: uiText("taskSummaryPanel.status"), cell: (i) => <StatusIndicator type={level[i.level] ?? 'info'}>{i.tag}</StatusIndicator> },
              // 不设 minWidth：这块小组件在看板里只占 2 列（约 573px），
              // 硬给两列留 140 + 180 会把内容撑到 998px，卡片里就出现横滚。让它们自己换行。
              { id: 'project', header: uiText("app.projects"), cell: (i) => projLink(i.projectId, i.projectName) },
              { id: 'headline', header: uiText("dashboard.item"), cell: (i) => i.headline },
              { id: 'detail', header: uiText("dashboard.description"), cell: (i) => (i.detail ? <Box variant="small" color="text-body-secondary">{i.detail}</Box> : '—') },
              { id: 'act', header: '', cell: (i) => <Link href={i.href} onFollow={(e) => { e.preventDefault(); go(i.href); }}>{uiText("assistantPanel.view")}</Link> },
            ]}
          />
        ) : empty(uiText("dashboard.all.projects.are.on.track.no.action.is.needed"));
      }
      case 'money':
        return (
          <BulletList
            rows={active.map((p) => ({ key: String(p.id), label: projLink(p.id, p.name), actual: p.budget_spent ?? 0, target: p.budget_planned ?? 0 }))}
            format={compactMoney}
            overAt={1.0}
            targetLabel={uiText("updatesList.budget")}
            emptyText={loading ? uiText("dashboard.loading.2") : uiText("dashboard.no.active.projects")}
          />
        );
      case 'stages':
        return (
          <StackedBar
            /* KAN-63：三段是同一条流水线的前后阶段，属有序数据，用蓝色阶而不是分类色
               （原先默认取 SERIES 前三位，里面有品红和青）。页面只给有序位置，颜色由图表组件决定。 */
            segments={[
              { label: uiText("directorDesign.not.purchased"), value: summary?.leads ?? 0, ordinalIndex: 1 },
              { label: uiText("dashboard.active"), value: summary?.active ?? 0, ordinalIndex: 3 },
              { label: uiText("stagePositionBar.complete"), value: summary?.portfolio ?? 0, ordinalIndex: 5 },
            ]}
            format={(n) => uiText("sentences.properties", { value1: (n) })}
            emptyText={loading ? uiText("dashboard.loading.2") : uiText("dashboard.no.projects.yet")}
          />
        );
      case 'recent':
        return (
          <Cards variant="full-page" cardsPerRow={[{ cards: 1 }, { minWidth: 500, cards: 3 }]} items={recent} loading={loading}
            cardDefinition={{
              header: (p) => <><ReviewTag cardId="recent-project-card" context={p.name} /><Link fontSize="heading-s" href={`/projects/${p.id}`} onFollow={(e) => { e.preventDefault(); go(`/projects/${p.id}`); }}>{p.name}</Link></>,
              sections: [
                { id: 'img', content: (p) => <CoverImage propertyId={p.property.id} height={110} radius={8} /> },
                { id: 'meta', content: (p) => (
                  <SpaceBetween size="xxs">
                    <Box variant="small" color="text-body-secondary">{p.property.address_std}</Box>
                    <SpaceBetween direction="horizontal" size="xs"><StatusBadge status={p.status} /><Box variant="small">{stageText(p, meta)}</Box></SpaceBetween>
                    {(p.budget_planned ?? 0) > 0 && <Meter value={p.budget_spent ?? 0} max={p.budget_planned ?? 0} label={uiText("dashboard.budget.used")} reading={`${compactMoney(p.budget_spent)} / ${compactMoney(p.budget_planned)}`} height={6} />}
                  </SpaceBetween>
                ) },
              ],
            }} />
        );
      case 'list':
        return table;
      case 'updates':
        return <UpdatesList items={updates} showProject onGo={go} emptyText={loading ? uiText("dashboard.loading.2") : uiText("dashboard.no.updates.yet")} />;
      case 'turns': {
        const turns = projects.filter((p) => p.stage !== 'portfolio' && (p.stage_progress?.length ?? 0) > 0);
        const goProject = (p: Project) => {
          const n = p.next_up[0];
          go(n ? `/projects/${p.id}?tab=overview&step=${n.key}` : `/projects/${p.id}?tab=overview`);
        };
        return turns.length ? (
          <Cards variant="full-page" cardsPerRow={[{ cards: 1 }, { minWidth: 520, cards: 2 }, { minWidth: 900, cards: 3 }]} items={turns} loading={loading}
            cardDefinition={{
              /* KAN-63：状态从盖在封面上的浮标挪到标题行。压在照片上的彩色胶囊
                 既挡内容又和照片抢，放回标题行跟在项目名后面就够了。 */
              header: (p) => (
                <div><ReviewTag cardId="turn-project-card" context={p.name} /><div className="ui-row-between">
                  <span className="ui-inline-baseline">
                    <Link fontSize="heading-s" href={`/projects/${p.id}`} onFollow={(e) => { e.preventDefault(); goProject(p); }}>{p.name}</Link>
                    <StatusBadge status={p.status} />
                  </span>
                  <Box variant="small" color="text-body-secondary">{systemText(p.current_stage?.label)}</Box>
                </div></div>
              ),
              sections: [
                { id: 'img', content: (p) => <CoverImage propertyId={p.property.id} height={96} radius={8} showLabel={false} /> },
                { id: 'track', content: (p) => {
                  const cur = p.stage_progress.find((s) => s.key === p.current_stage?.key);
                  return (
                    <SpaceBetween size="xxs">
                      <Box variant="small" color="text-body-secondary">{p.property.address_std}</Box>
                      <Box fontSize="body-s">{cur ? uiText("sentences.requirements.met.in.this.stage", { value1: (systemText(cur.label)), value2: (cur.done), value3: (cur.total) }) : p.current_stage?.label}<Box variant="span" color="text-body-secondary">　{uiText("dashboard.milestone.passed")} {p.stage_progress.filter((s) => s.gate_done).length}/{p.stage_progress.length}</Box></Box>
                    </SpaceBetween>
                  );
                } },
                { id: 'next', header: uiText("insights.action.by"), content: (p) => (
                  p.next_up.length ? (
                    <SpaceBetween size="xxs">
                      {p.next_up.slice(0, 2).map((n) => (
                        <span key={n.key} className="ui-inline-tight">
                          {/* 审计 #A02：菱形原先用硬编码的旧 info 蓝，改中性边框；「是不是关键节点」靠字重表示 */}
                          {n.gate && <span className="ui-gate-symbol" />}
                          {n.owners.map((o) => <RoleLabel key={o} code={o} />)}<span className={n.gate ? "ui-strong" : undefined}>{systemText(n.title)}</span>
                        </span>
                      ))}
                    </SpaceBetween>
                  ) : <Box color="text-body-secondary">{uiText("dashboard.all.tasks.in.this.stage.are.done")}</Box>
                ) },
                { id: 'warn', content: (p) => (p.earlier_undone_count > 0 ? <StatusIndicator type="warning">{uiText("dashboard.earlier")} {p.earlier_undone_count} {uiText("dashboard.items.unconfirmed")}</StatusIndicator> : <Box variant="small" color="text-status-success">{uiText("dashboard.earlier.items.confirmed")}</Box>) },
              ],
            }} />
        ) : empty(loading ? '正在读取…' : '没有在进行中的房子。');
      }
      case 'upcoming': {
        const ups = widgets?.upcoming ?? [];
        return ups.length ? (
          <SpaceBetween size="s">
            {ups.map((u, k) => (
              <div key={k} className="ui-row-baseline">
                <Box fontWeight="bold" color="text-body-secondary"><span className="ui-date-column">{shortDate(u.date)}</span></Box>
                <StatusIndicator type={u.days < 0 ? (u.overdue ? 'error' : 'stopped') : u.days <= 7 ? 'warning' : 'info'}>{u.kind}</StatusIndicator>
                <span>{projLink(u.project_id, u.project_name)} <Box variant="span" color="text-body-secondary">{u.days < 0 ? uiText("sentences.days.ago", { value1: (-u.days) }) : u.days === 0 ? uiText("updatesList.today") : uiText("sentences.in.days", { value1: (u.days) })}</Box></span>
              </div>
            ))}
          </SpaceBetween>
        ) : empty(uiText("dashboard.no.key.dates.in.the.next.30.days"));
      }
      case 'capital': {
        const caps = widgets?.capital ?? [];
        const total = caps.reduce((a, r) => a + r.total, 0);
        return caps.length ? (
          <SpaceBetween size="s">
            <Box color="text-body-secondary">{uiText("dashboard.total.committed.to.active.projects")} <b>{fullMoney(total)}</b>{uiText("dashboard.purchase.price.recorded.expenses")}</Box>
            <HBars rows={caps.map((r) => ({ key: String(r.project_id), label: projLink(r.project_id, r.project_name), values: [r.purchase_price, r.spent], tooltipTitle: r.project_name }))} series={['买入价', '已支出']} format={compactMoney} />
          </SpaceBetween>
        ) : empty(uiText("dashboard.no.active.projects"));
      }
      case 'retro': {
        const rs = widgets?.retrospectives ?? [];
        return (
          <Table variant="embedded" items={rs} empty={empty(uiText("dashboard.no.completed.projects.with.sale.prices"))}
            columnDefinitions={[
              { id: 'n', header: uiText("app.projects"), cell: (r) => projLink(r.project_id, r.project_name) },
              { id: 't', header: uiText("dashboard.target.sale.price"), cell: (r) => money(r.target_arv) },
              { id: 's', header: uiText("dashboard.sale.price"), cell: (r) => money(r.sale_price) },
              { id: 'se', header: uiText("dashboard.sale.price.variance"), cell: (r) => <DeltaBadge pct={r.arv_error_pct} goodWhenPositive /> },
              { id: 'b', header: uiText("updatesList.budget"), cell: (r) => money(r.budget_planned) },
              { id: 'a', header: uiText("dashboard.actual.expenses"), cell: (r) => money(r.spent) },
              { id: 'be', header: uiText("cardRegistry.budget.variance"), cell: (r) => <DeltaBadge pct={r.budget_error_pct} goodWhenPositive={false} /> },
              { id: 'p', header: uiText("dashboard.actual.profit"), cell: (r) => money(r.profit) },
              { id: 'd', header: uiText("stepsPanel.schedule"), cell: (r) => (r.days == null ? '—' : uiText("sentences.days", { value1: (r.days) })) },
            ]} />
        );
      }
      case 'weekly': {
        const ws = widgets?.weekly_spend ?? [];
        const total = ws.reduce((a, r) => a + r.amount, 0);
        return ws.length ? (
          <SpaceBetween size="s">
            <Box color="text-body-secondary">{uiText("dashboard.12.week.spending.total")} <b>{fullMoney(total)}</b>{uiText("dashboard.weekly.average")} {compactMoney(total / ws.length)}</Box>
            <Trend points={ws.map((r) => ({ x: shortDate(r.week_start), y: r.amount }))} format={compactMoney} height={170} />
          </SpaceBetween>
        ) : empty(uiText("dashboard.no.expense.records"));
      }
      case 'vendors': {
        const vs = widgets?.vendors ?? [];
        const vmax = Math.max(...vs.map((v) => v.amount), 1);
        return (
          <Table variant="embedded" items={vs} empty={empty(uiText("dashboard.no.supplier.spending"))}
            columnDefinitions={[
              { id: 'v', header: uiText("dashboard.supplier"), cell: (r) => r.vendor },
              { id: 'a', header: uiText("procurementItemRow.amount"), minWidth: 200, cell: (r) => <InlineBar value={r.amount} max={vmax} text={fullMoney(r.amount)} width={100} /> },
              { id: 'c', header: uiText("dashboard.record.count"), cell: (r) => r.count },
              { id: 'p', header: uiText("dashboard.project.count"), cell: (r) => r.projects },
            ]} />
        );
      }
      case 'gates': {
        const gs = roleData?.my_gates ?? [];
        return gs.length ? (
          <SpaceBetween size="xs">
            {gs.map((g) => (
              /* 审计 #A03：原先整行铺彩色底 + 彩色左边条表示「是不是当前阶段」，四个值全硬编码。
                 改中性边框，「当前」用 StatusIndicator 明说。 */
              <div key={`${g.project_id}-${g.key}`} className="ui-gate-row">
                <div className="ui-min-width">
                  {/* KAN-63：去掉行首的 ◆ 和粗体。一屏里主按钮只留页头那一个，
                      这里的「去确认」降成链接——它是导航，不是本屏的主操作。 */}
                  <div>{systemText(g.title)} <Box variant="span" color="text-body-secondary">· {g.project_name}</Box></div>
                  {g.is_current && <StatusIndicator type="in-progress">{uiText("projectPreplan.current.stage")}</StatusIndicator>}
                  <Box variant="small" color="text-body-secondary">{g.stage}{g.evidence_hint ? ` · ${g.evidence_hint}` : ''}{g.confirmed.length ? uiText("sentences.confirmed", { value1: (g.confirmed.join('、')) }) : ''}</Box>
                </div>
                <Link
                  href={`/projects/${g.project_id}?tab=overview&step=${g.key}&action=confirm`}
                  onFollow={(e) => { e.preventDefault(); go(`/projects/${g.project_id}?tab=overview&step=${g.key}&action=confirm`); }}
                >{uiText("dashboard.confirm")}</Link>
              </div>
            ))}
          </SpaceBetween>
        ) : empty(uiText("dashboard.no.milestones.await.your.confirmation"));
      }
      case 'mytodo':
        return <MyTodoTable compact rows={roleData ? (roleData.my_todo ?? []) : null} onReload={reloadRole} />;
      case 'procurement':
        return me ? <Button onClick={() => go('/procurement')}>{uiText("dashboard.open.procurement.workspace")}</Button> : empty(uiText("dashboard.sign.in.to.view.project.procurement"));
      case 'site': {
        const rs = roleData?.site ?? [];
        return rs.length ? (
          <ColumnLayout columns={3} minColumnWidth={220}>
            {rs.map((r) => (
              <div key={r.project_id}>
                <Box fontWeight="bold">{projLink(r.project_id, r.project_name)}</Box>
                <div className="ui-photo-strip">
                  {r.photo_ids.length ? r.photo_ids.map((id) => <img key={id} src={`/api/files/${id}/download`} alt="" className="ui-thumbnail ui-thumbnail-progress" />) : <Box variant="small" color="text-body-secondary">{uiText("dashboard.no.progress.photos.yet")}</Box>}
                </div>
                <Box variant="small" color="text-body-secondary">{r.photo_count} {uiText("dashboard.progress.photos")}</Box>
                {r.failed.length > 0 ? <StatusIndicator type="error">{r.failed.join('、')} {uiText("dashboard.failed")}</StatusIndicator>
                  : r.last_inspection ? <StatusIndicator type={r.last_inspection.result === 'passed' ? 'success' : 'pending'}>{r.last_inspection.name} · {r.last_inspection.result === 'passed' ? uiText("dashboard.passed") : uiText("dashboard.scheduled")}</StatusIndicator>
                  : <Box variant="small" color="text-body-secondary">{uiText("dashboard.no.inspections.yet")}</Box>}
              </div>
            ))}
          </ColumnLayout>
        ) : empty(uiText("dashboard.no.active.projects"));
      }
      case 'utilities': {
        const rs = roleData?.utilities_insurance ?? [];
        // 审计 #A04：原先是 10px 纯色圆点，含义**只靠颜色**，唯一补充是 title——
        // 而 title 要 hover 才出来，iPhone 上没有 hover，等于没有。直接违反官方
        // 「color should never be the only visual means of conveying information」。
        // 改 StatusIndicator：图标 + 文字承担含义，颜色只做强化。
        const UTIL: Record<string, { type: 'success' | 'pending' | 'stopped' | 'info'; label: string }> = {
          on: { type: 'success', label: uiText("dashboard.active.2") }, pending: { type: 'pending', label: uiText("dashboard.pending") },
          off: { type: 'stopped', label: uiText("dashboard.closed") },
        };
        const dot = (st: string) => { const u = UTIL[st] ?? { type: 'info' as const, label: uiText("dashboard.unknown") };
          return <Box variant="span" margin={{ right: 'xxs' }}><StatusIndicator type={u.type}>{systemText(u.label)}</StatusIndicator></Box>; };
        return rs.length ? (
          <Table variant="embedded" items={rs} columnDefinitions={[
            { id: 'p', header: uiText("dashboard.properties"), cell: (r) => projLink(r.project_id, r.project_name) },
            { id: 'u', header: uiText("dashboard.water.electricity.gas"), cell: (r) => <span>{dot(r.water)}{dot(r.electric)}{dot(r.gas)}{r.blocker && <Box variant="small" color="text-status-warning">{r.blocker}</Box>}</span> },
            { id: 'i', header: uiText("roleDesigns.insurance"), cell: (r) => (r.insurance_days == null ? '—' : <StatusIndicator type={r.insurance_days < 0 ? 'error' : r.insurance_days <= 30 ? 'warning' : 'success'}>{r.insurance_days < 0 ? uiText("sentences.expired.days.ago.2", { value1: (-r.insurance_days) }) : uiText("sentences.expires.in.days", { value1: (r.insurance_days) })}</StatusIndicator>) },
            { id: 'a', header: '', cell: (r) => <Link href={`/projects/${r.project_id}?tab=data&section=utilities`} onFollow={(e) => { e.preventDefault(); go(`/projects/${r.project_id}?tab=data&section=utilities`); }}>{uiText("dashboard.enter.details")}</Link> },
          ]} />
        ) : empty(uiText("dashboard.no.properties.need.utility.management"));
      }
      case 'permits': {
        const rs = roleData?.permits ?? [];
        return rs.length ? (
          <Table variant="embedded" items={rs} columnDefinitions={[
            { id: 'p', header: uiText("dashboard.properties"), cell: (r) => projLink(r.project_id, r.project_name) },
            { id: 'pm', header: uiText("terminology.permit"), cell: (r) => (r.permit === 'issued' ? <StatusIndicator type="success">{uiText("dashboard.issued")}</StatusIndicator> : r.permit === 'applied' ? <StatusIndicator type="in-progress">{uiText("dashboard.application.submitted")}{r.applied_days != null ? uiText("sentences.days.3", { value1: (r.applied_days) }) : ''}</StatusIndicator> : <StatusIndicator type="pending">{uiText("dashboard.not.applied")}</StatusIndicator>) },
            { id: 'n', header: uiText("dashboard.next.inspection"), cell: (r) => (r.final_passed ? <StatusIndicator type="success">{uiText("dashboard.final.passed")}</StatusIndicator> : r.next_inspection ? `${r.next_inspection.name}${r.next_inspection.date ? ` · ${shortDate(r.next_inspection.date)}` : ''}` : '—') },
            { id: 'f', header: uiText("dashboard.failed"), cell: (r) => (r.failed.length ? <StatusIndicator type="error">{r.failed.join('、')}</StatusIndicator> : '—') },
          ]} />
        ) : empty(uiText("dashboard.no.active.projects"));
      }
      case 'design': {
        const rs = roleData?.design ?? [];
        const ok = (b: boolean) => <StatusIndicator type={b ? 'success' : 'pending'}>{b ? uiText("dashboard.provided") : uiText("dashboard.not.provided")}</StatusIndicator>;
        return rs.length ? (
          <Table variant="embedded" items={rs} columnDefinitions={[
            { id: 'p', header: uiText("dashboard.properties"), cell: (r) => projLink(r.project_id, r.project_name) },
            { id: 'm', header: uiText("dashboard.measurement.notes"), cell: (r) => ok(r.measure_note) },
            { id: 'd', header: uiText("dashboard.design.proposal"), cell: (r) => ok(r.drawing) },
            { id: 'f', header: uiText("dashboard.final.drawings"), cell: (r) => ok(r.drawing_final) },
          ]} />
        ) : empty(uiText("dashboard.no.active.properties.2"));
      }
      case 'saledocs': {
        const rs = roleData?.sale_docs ?? [];
        // 审计 #A05：符号本身已是第二通道，只把硬编码的旧色值换成令牌
        const ok = (b: boolean) => <StatusIndicator type={b ? 'success' : 'not-started'}>{b ? uiText("dashboard.complete") : uiText("dashboard.missing")}</StatusIndicator>;
        return rs.length ? (
          <Table variant="embedded" items={rs} columnDefinitions={[
            { id: 'p', header: uiText("dashboard.properties"), cell: (r) => <span>{projLink(r.project_id, r.project_name)}<Box variant="small" color="text-body-secondary">{uiText("dashboard.listing")} {r.list_date ? shortDate(r.list_date) : '—'}</Box></span> },
            { id: 'o', header: uiText("terminology.offer"), cell: (r) => ok(r.offer) },
            { id: 's', header: uiText("dashboard.document.package"), cell: (r) => ok(r.sale_docs) },
            { id: 'd', header: uiText("dashboard.disclosures"), cell: (r) => ok(r.disclosure) },
            { id: 'g', header: uiText("dashboard.signed.copy"), cell: (r) => ok(r.sale_signed) },
            { id: 'c', header: uiText("dashboard.closing.statement"), cell: (r) => ok(r.sale_closing) },
          ]} />
        ) : empty(uiText("dashboard.no.properties.listed.for.sale"));
      }
      case 'boss': {
        const b = roleData?.boss;
        return b ? (
          <ColumnLayout columns={5} variant="text-grid">
            <StatTile label={uiText("dashboard.held")} value={`${b.active + b.leads}`} sub={uiText("sentences.active.unpurchased", { value1: (b.active), value2: (b.leads) })} />
            <StatTile label={uiText("dashboard.total.investment")} value={compactMoney(b.total_invested)} help={uiText("dashboard.active.purchase.prices.expenses")} />
            <StatTile label={uiText("dashboard.estimated.profit")} value={compactMoney(b.expected_profit)} sub={incompleteNote(b.profit_incomplete_count) ?? uiText("dashboard.active")} />
            <StatTile label={uiText("dashboard.realized.profit")} value={compactMoney(b.realized_profit)} sub={uiText("sentences.sold.properties", { value1: (b.portfolio) })} />
            <StatTile label={uiText("dashboard.over.budget")} value={`${b.over_budget_count}`} sub={uiText("directorDesign.properties")} tone={b.over_budget_count > 0 ? 'bad' : undefined} />
          </ColumnLayout>
        ) : empty(uiText("dashboard.no.data"));
      }
      case 'funnel': {
        const fs = widgets?.funnel ?? [];
        return fs.length ? (
          <HBars rows={fs.map((r) => ({ key: r.substage, label: r.label, values: [r.count] }))} ordinal format={(n) => uiText("sentences.records", { value1: (n) })} labelWidth={72} />
        ) : empty(uiText("dashboard.no.unpurchased.properties"));
      }
    }
  };

  // 看板只放额外小组件，list 不在候选里（它已经固定在页面上）
  const hidden = (Object.keys(WIDGETS) as WidgetId[])
    .filter((id) => id !== 'list' && !items.some((i) => i.id === id) && canAdd(id));

  // 页头写事实，不喊口号。紧急 = 有 error/warning 级洞察的房子数，按项目去重。
  const urgent = new Set(insights.filter((i) => i.level !== 'info').map((i) => i.projectId)).size;
  const pageDescription = [
    urgent ? uiText("sentences.properties.need.action.today", { value1: (urgent) }) : null,
    uiText("sentences.active.unpurchased.in.closeout.2", { value1: (summary?.active ?? '—'), value2: (summary?.leads ?? '—'), value3: (summary?.portfolio ?? '—') }),
  ].filter(Boolean).join('');

  return (
    <ContentLayout
      maxContentWidth={1400}
      header={
        <Header
          variant="h1"
          description={pageDescription}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <ButtonDropdown
                items={hidden.length ? hidden.map((id) => ({ id, text: WIDGETS[id].title })) : [{ id: 'none', text: uiText("dashboard.all.widgets.are.on.the.board"), disabled: true }]}
                onItemClick={({ detail }) => { if (detail.id !== 'none') { const next = [...items, mkItem(detail.id as WidgetId)]; setItems(next); saveLayout(role.actor, next); } }}
              >{uiText("dashboard.add.widget")}</ButtonDropdown>
              {role.can('create_project') && <Button variant="primary" onClick={() => go('/projects/new')}>{uiText("app.new.project")}</Button>}
            </SpaceBetween>
          }
        >
          {me ? uiText("sentences.workspace", { value1: (me.display_name) }) : uiText("app.projects")}
        </Header>
      }
    >
      <SpaceBetween size="l">
        {/* KAN-75 块 4：登录后工作台先看「项目关注」——每套房走到哪、下一动作是谁的、等我确认的交付；
            数据来自任务表。没登录（演示访客）保留原来的四个数与项目表。 */}
        {me && <WorkbenchFocus refreshKey={projects.length} />}
        {/* 四个数字直接跟在页头下面。原先套一层叫「今日概览」的 Container，
            等于给四个数字单独起了个栏目名——控制台里这层壳没有意义。 */}
        {!me && <CardFrame cardId="dashboard-metrics"><ColumnLayout columns={4} minColumnWidth={120} variant="text-grid">
              <Stat label={uiText("projectPreplan.acquisition.not.purchased")} value={String(summary?.leads ?? '—')} sub={uiText("sentences.hot.leads", { value1: (projects.filter((p) => isLead(p) && p.lead_heat === 'hot_lead').length) })} />
              <Stat label={uiText("dashboard.active")} value={String(summary?.active ?? '—')} sub={summary?.money_hidden ? uiText("dashboard.under.construction.or.listed") : uiText("sentences.over.budget.2", { value1: (summary?.over_budget_count ?? 0) })} />
              {summary?.money_hidden ? (
                <>
                  <Stat label={uiText("dashboard.my.turn")} value={String(roleData?.my_todo?.length ?? '—')} sub={uiText("sentences.items.belong.to.the.current.stage", { value1: (roleData?.my_todo?.filter((r) => r.is_current).length ?? 0) })} />
                  <Stat label={uiText("addProject.sold.closeout")} value={String(summary?.portfolio ?? '—')} help={uiText("dashboard.closed.in.closeout.or.process.complete")} />
                </>
              ) : (
                <>
                  <Stat label={uiText("dashboard.invested")} value={compactMoney(summary?.total_invested)} help={uiText("dashboard.active.project.purchase.prices.expenses")} />
                  <Stat label={uiText("dashboard.estimated.profit")} value={compactMoney(summary?.expected_profit)} sub={incompleteNote(summary?.profit_incomplete_count) ?? undefined} help={uiText("dashboard.active.target.sale.price.purchase.renovation")} />
                </>
              )}
        </ColumnLayout></CardFrame>}

        {/* 项目表固定渲染，不再是看板的一项：没有拖动手柄、没有关闭按钮。登录后由「项目关注」承担，这里只给未登录访客。 */}
        {!me && (showLeadGroups ? leadView : (
          <Table cardId="guest-projects"
            {...sortProps}
            items={rows}
            loading={loading}
            loadingText={uiText("dashboard.loading")}
            variant="container"
            resizableColumns

            header={<Header variant="h2" counter={`(${filtered.length})`}>{uiText("founderDesign.all.projects")}</Header>}
            filter={
              <SpaceBetween direction="horizontal" size="xs">
                <TextFilter {...searchProps} filteringPlaceholder={uiText("dashboard.search.by.project.name.or.address")} countText={uiText("sentences.matches", { value1: (rows.length) })} />
                {groupSelect}{todayFilter}
              </SpaceBetween>
            }
            pagination={<Pagination {...paginationProps} />}
            columnDefinitions={role.canReadMoney ? projectColumns : projectColumns.filter(c => !['budget','arv'].includes(c.id))}
          />
        ))}

        {items.length > 0 && <Board
          items={items}
          i18nStrings={boardI18n}
          onItemsChange={({ detail }) => { setItems(detail.items); saveLayout(role.actor, detail.items); }}
          empty={null}
          renderItem={(item, actions) => (
            <BoardItem
              header={<><ReviewTag cardId={`widget-${item.id as WidgetId}`} context={item.data.title} /><Header variant="h2">{item.data.title}</Header></>}
              i18nStrings={itemI18n}
              settings={<Button variant="icon" iconName="close" ariaLabel={uiText("dashboard.remove.widget")} onClick={() => actions.removeItem()} />}
            >
              {widget(item.id as WidgetId)}
            </BoardItem>
          )}
        />}
      </SpaceBetween>
    </ContentLayout>
  );
}
