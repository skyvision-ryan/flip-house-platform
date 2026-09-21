import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCollection } from '@cloudscape-design/collection-hooks';
import Board, { BoardProps } from '@cloudscape-design/board-components/board';
import BoardItem from '@cloudscape-design/board-components/board-item';
import Box from '@cloudscape-design/components/box';
import BreadcrumbGroup from '@cloudscape-design/components/breadcrumb-group';
import Button from '@cloudscape-design/components/button';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import Cards from '@cloudscape-design/components/cards';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table from '@cloudscape-design/components/table';
import TextFilter from '@cloudscape-design/components/text-filter';
import StatusBadge from '../components/StatusBadge';
import { BORDER, TEXT_2, TEXT_GOOD } from '../components/charts/palette';
import CoverImage from '../components/CoverImage';
import ReviewTag from '../components/ReviewTag';
import { BulletList, DeltaBadge, HBars, InlineBar, Meter, ORDINAL_BLUE, StackedBar, StatTile, Trend, compactMoney, fullMoney } from '../components/charts';
import { api, DashboardRole, DashboardSummary, DashboardWidgets, Project, Update } from '../api/client';
import MyTodoTable from '../components/MyTodoTable';
import { useRole } from '../lib/role';
import { actionHref } from '../lib/stepActions';
import UpdatesList from '../components/UpdatesList';
import { OwnerDot } from '../components/OwnerTag';
import { dateStr, money, pct } from '../lib/format';
import { Insight, loadInsights } from '../lib/insights';
import { labelOf, useMeta } from '../lib/meta';

type WidgetId = 'attention' | 'money' | 'stages' | 'recent' | 'list' | 'upcoming' | 'capital' | 'retro' | 'weekly' | 'vendors' | 'funnel' | 'updates' | 'turns'
  | 'gates' | 'mytodo' | 'procurement' | 'site' | 'utilities' | 'permits' | 'design' | 'saledocs' | 'boss';
type ItemData = { title: string; tag: string };
type Item = BoardProps.Item<ItemData>;

const WIDGETS: Record<WidgetId, ItemData & { cols: number; rows: number }> = {
  attention: { title: '需要关注', tag: 'B', cols: 2, rows: 4 },
  money: { title: '在建项目：花了多少（灰底 = 预算）', tag: 'C', cols: 2, rows: 4 },
  stages: { title: '阶段分布', tag: 'D', cols: 1, rows: 4 },
  recent: { title: '最近更新', tag: 'E', cols: 3, rows: 4 },
  list: { title: '项目列表', tag: 'F', cols: 4, rows: 6 },
  upcoming: { title: '未来 30 天', tag: 'G', cols: 2, rows: 4 },
  capital: { title: '资金占用', tag: 'H', cols: 2, rows: 4 },
  retro: { title: '估算准不准（已完成项目）', tag: 'I', cols: 4, rows: 3 },
  weekly: { title: '近 12 周支出', tag: 'J', cols: 2, rows: 4 },
  vendors: { title: '供应商支出前五', tag: 'K', cols: 2, rows: 4 },
  funnel: { title: '线索漏斗', tag: 'L', cols: 1, rows: 4 },
  updates: { title: '谁更新了什么', tag: 'M', cols: 2, rows: 4 },
  turns: { title: '每套房轮到谁', tag: 'N', cols: 4, rows: 7 },
  gates: { title: '待我确认的门', tag: 'O', cols: 2, rows: 4 },
  mytodo: { title: '我的待办', tag: 'P', cols: 4, rows: 6 },
  procurement: { title: '采购异常与待下单', tag: 'Q', cols: 2, rows: 4 },
  site: { title: '施工现场', tag: 'R', cols: 4, rows: 4 },
  utilities: { title: '水电瓦斯与保险', tag: 'S', cols: 3, rows: 4 },
  permits: { title: 'permit 与检查', tag: 'T', cols: 3, rows: 4 },
  design: { title: '设计交付', tag: 'U', cols: 2, rows: 4 },
  saledocs: { title: '卖出文件', tag: 'V', cols: 3, rows: 4 },
  boss: { title: '老板总览', tag: 'W', cols: 4, rows: 2 },
};
const MONEY_WIDGETS: WidgetId[] = ['money', 'capital', 'weekly', 'retro', 'vendors', 'boss'];
// v8：项目表不再是看板的一项，而是页面固定的一块，所以旧存档里的 list 必须丢掉，
// 否则会和固定那块重复出现两张表。看板现在只放「额外」小组件。
const layoutKey = (actor: string) => `boardLayout.v8.${actor}`;

function mkItem(id: WidgetId, extra?: Partial<Item>): Item {
  const w = WIDGETS[id];
  return { id, columnSpan: w.cols, rowSpan: w.rows, data: { title: w.title, tag: w.tag }, ...extra };
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
  liveAnnouncementDndStarted: (t) => (t === 'resize' ? '开始调整大小' : '开始拖动'),
  liveAnnouncementDndItemReordered: () => '已移动',
  liveAnnouncementDndItemResized: () => '已调整大小',
  liveAnnouncementDndItemInserted: () => '已插入',
  liveAnnouncementDndCommitted: (t) => (t === 'resize' ? '大小已确定' : '位置已确定'),
  liveAnnouncementDndDiscarded: () => '已取消',
  liveAnnouncementItemRemoved: (op) => `已移除 ${op.item.data.title}`,
  navigationAriaLabel: '看板导航',
  navigationItemAriaLabel: (item) => (item ? item.data.title : '空'),
};
const itemI18n = { dragHandleAriaLabel: '拖动', resizeHandleAriaLabel: '调整大小', dragHandleTooltipText: '拖动改变位置', resizeHandleTooltipText: '拖动改变大小' };

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <StatTile label={label} value={value} sub={sub} />;
}

const shortDate = (d: string) => d.slice(5).replace('-', '/');

export default function Dashboard({ listOnly = false }: { listOnly?: boolean }) {
  const navigate = useNavigate();
  const meta = useMeta();
  const role = useRole();
  // 项目表已经固定渲染在页面上，看板里只剩「额外」小组件，默认一个都没有。
  // 注意**不动** DASHBOARD_LAYOUTS 那份后端字典——它同时决定 widget_access，
  // 动了角色就加不回自己的小组件。下面 canAdd 仍然读 widget_access，
  // 所以「添加小组件」照样能把关注、门、水电加回来，加回来的出现在表下面。
  const defaults: WidgetId[] = [];
  const canAdd = (id: WidgetId) => (role.actor === '老板' || role.actor === '负责人' || (meta?.widget_access?.[id] ?? []).includes(role.actor)) && (!MONEY_WIDGETS.includes(id) || role.canReadMoney);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [roleData, setRoleData] = useState<DashboardRole | null>(null);
  const [widgets, setWidgets] = useState<DashboardWidgets | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [updates, setUpdates] = useState<Update[]>([]);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ReadonlyArray<Item>>(() => loadLayout(role.actor, defaults));
  const [stage, setStage] = useState<{ label: string; value: string }>({ label: '全部阶段', value: '' });

  const reloadRole = async () => { setRoleData(await api.dashboardRole().catch(() => null)); };
  useEffect(() => {
    setLoading(true);
    setItems(loadLayout(role.actor, defaults));
    Promise.all([api.dashboard(), api.projects(), api.widgets(), api.updates(20).catch(() => [] as Update[]), api.dashboardRole().catch(() => null)])
      .then(async ([s, p, w, u, r]) => { setSummary(s); setProjects(p); setWidgets(w); setUpdates(u); setRoleData(r); setInsights(await loadInsights(p, role.actor)); })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role.actor, meta]);

  const filtered = useMemo(() => (stage.value ? projects.filter((p) => p.stage === stage.value) : projects), [projects, stage]);
  const { items: rows, collectionProps, filterProps, paginationProps } = useCollection(filtered, {
    filtering: {
      filteringFunction: (item, s) => { const t = s.toLowerCase(); return item.name.toLowerCase().includes(t) || item.property.address_std.toLowerCase().includes(t); },
      empty: <Box textAlign="center" color="inherit"><b>还没有项目</b><Box padding={{ bottom: 's' }} variant="p" color="inherit">输入一个地址，系统会自动补全房产数据。</Box><Button variant="primary" onClick={() => navigate('/projects/new')}>新建项目</Button></Box>,
      noMatch: <Box textAlign="center" color="inherit"><b>没有匹配的项目</b></Box>,
    },
    pagination: { pageSize: 10 },
    sorting: { defaultState: { sortingColumn: { sortingField: 'updated_at' }, isDescending: true } },
  });

  const recent = [...projects].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)).slice(0, 3);
  const stageOptions = [{ label: '全部阶段', value: '' }, ...(meta?.stages ?? [])];
  const active = projects.filter((p) => p.stage === 'active');
  const go = (href: string) => navigate(href);
  const projLink = (id: number, name: string) => <Link href={`/projects/${id}`} onFollow={(e) => { e.preventDefault(); go(`/projects/${id}`); }}>{name}</Link>;

  const projectColumns = [
    { id: 'name', header: '项目', sortingField: 'name', minWidth: 260, cell: (p: Project) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <CoverImage propertyId={p.property.id} width={56} height={40} radius={6} showLabel={false} />
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {projLink(p.id, p.name)}
          <Box variant="small" color="text-body-secondary">{p.property.address_std}</Box>
        </div>
      </div>
    ) },
    { id: 'stage', header: '阶段', sortingField: 'stage', cell: (p: Project) => `${labelOf(meta?.stages, p.stage)} · ${labelOf(meta?.substages[p.stage], p.substage)}` },
    { id: 'status', header: '状态', sortingField: 'status', cell: (p: Project) => <StatusBadge status={p.status} /> },
    // 百分比一行、金额一行。原先「99.0%（$81,660 / $82,500）」塞在一格里，
    // 把最后一列挤成「更」，表底出现横向滚动条。
    { id: 'budget', header: '预算已用', sortingField: 'budget_used_pct', cell: (p: Project) => ((p.budget_planned ?? 0) > 0 ? (
      <div>
        <div>{pct(p.budget_used_pct)}</div>
        <Box variant="small" color="text-body-secondary">{money(p.budget_spent)} / {money(p.budget_planned)}</Box>
      </div>
    ) : '—') },
    { id: 'arv', header: '目标售价', sortingField: 'target_arv', cell: (p: Project) => money(p.target_arv) },
    { id: 'updated', header: '更新', sortingField: 'updated_at', cell: (p: Project) => dateStr(p.updated_at) },
  ];

  const table = (
    <Table
      {...collectionProps}
      items={rows}
      loading={loading}
      loadingText="加载中"
      variant={listOnly ? 'container' : 'embedded'}
      resizableColumns
      onRowClick={({ detail }) => go(`/projects/${detail.item.id}`)}
      header={listOnly ? <Header variant="h2" counter={`(${filtered.length})`} actions={<Button variant="primary" onClick={() => go('/projects/new')}>新建项目</Button>}><ReviewTag id="A" />项目列表</Header> : undefined}
      filter={
        <SpaceBetween direction="horizontal" size="xs">
          <TextFilter {...filterProps} filteringPlaceholder="按项目名或地址查找" countText={`${rows.length} 个匹配`} />
          <Select selectedOption={stage} options={stageOptions} onChange={({ detail }) => setStage(detail.selectedOption as any)} />
        </SpaceBetween>
      }
      pagination={<Pagination {...paginationProps} />}
      columnDefinitions={projectColumns}
    />
  );

  if (listOnly) {
    return (
      <ContentLayout
        breadcrumbs={<BreadcrumbGroup items={[{ text: '工作台', href: '/' }, { text: '项目', href: '/projects' }]} onFollow={(e) => { e.preventDefault(); go(e.detail.href); }} />}
        header={<Header variant="h1" description="按阶段筛选，点任意一行进入项目。">所有项目</Header>}
      >
        {table}
      </ContentLayout>
    );
  }

  const empty = (t: string) => <Box textAlign="center" color="inherit" padding="l">{loading ? '正在读取…' : t}</Box>;

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
            items={insights.slice(0, 8)}
            columnDefinitions={[
              { id: 'level', header: '状态', cell: (i) => <StatusIndicator type={level[i.level] ?? 'info'}>{i.tag}</StatusIndicator> },
              { id: 'project', header: '项目', minWidth: 140, cell: (i) => projLink(i.projectId, i.projectName) },
              { id: 'headline', header: '事项', minWidth: 180, cell: (i) => i.headline },
              { id: 'detail', header: '说明', cell: (i) => (i.detail ? <Box variant="small" color="text-body-secondary">{i.detail}</Box> : '—') },
              { id: 'act', header: '', cell: (i) => <Link href={i.href} onFollow={(e) => { e.preventDefault(); go(i.href); }}>去看看</Link> },
            ]}
          />
        ) : empty('所有项目都在正轨上，没有需要处理的事。');
      }
      case 'money':
        return (
          <BulletList
            rows={active.map((p) => ({ key: String(p.id), label: projLink(p.id, p.name), actual: p.budget_spent ?? 0, target: p.budget_planned ?? 0 }))}
            format={compactMoney}
            overAt={1.0}
            targetLabel="预算"
            emptyText={loading ? '正在读取…' : '没有在建项目'}
          />
        );
      case 'stages':
        return (
          <StackedBar
            /* KAN-63：三段是同一条流水线的前后阶段，属有序数据，用蓝色阶而不是分类色
               （原先默认取 SERIES 前三位，里面有品红和青）。StackedBar 本体不动，只在这里传色。 */
            segments={[
              { label: '线索', value: summary?.leads ?? 0, color: ORDINAL_BLUE[1] },
              { label: '在建', value: summary?.active ?? 0, color: ORDINAL_BLUE[3] },
              { label: '已完成', value: summary?.portfolio ?? 0, color: ORDINAL_BLUE[5] },
            ]}
            format={(n) => `${n} 套`}
            emptyText={loading ? '正在读取…' : '还没有项目'}
          />
        );
      case 'recent':
        return (
          <Cards variant="full-page" cardsPerRow={[{ cards: 1 }, { minWidth: 500, cards: 3 }]} items={recent} loading={loading}
            cardDefinition={{
              header: (p) => <Link fontSize="heading-s" href={`/projects/${p.id}`} onFollow={(e) => { e.preventDefault(); go(`/projects/${p.id}`); }}>{p.name}</Link>,
              sections: [
                { id: 'img', content: (p) => <CoverImage propertyId={p.property.id} height={110} radius={8} /> },
                { id: 'meta', content: (p) => (
                  <SpaceBetween size="xxs">
                    <Box variant="small" color="text-body-secondary">{p.property.address_std}</Box>
                    <SpaceBetween direction="horizontal" size="xs"><StatusBadge status={p.status} /><Box variant="small">{labelOf(meta?.stages, p.stage)} · {labelOf(meta?.substages[p.stage], p.substage)}</Box></SpaceBetween>
                    {(p.budget_planned ?? 0) > 0 && <Meter value={p.budget_spent ?? 0} max={p.budget_planned ?? 0} label="预算已用" reading={`${compactMoney(p.budget_spent)} / ${compactMoney(p.budget_planned)}`} height={6} />}
                  </SpaceBetween>
                ) },
              ],
            }} />
        );
      case 'list':
        return table;
      case 'updates':
        return <UpdatesList items={updates} showProject onGo={go} emptyText={loading ? '正在读取…' : '还没有人更新过。'} />;
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                    <Link fontSize="heading-s" href={`/projects/${p.id}`} onFollow={(e) => { e.preventDefault(); goProject(p); }}>{p.name}</Link>
                    <StatusBadge status={p.status} />
                  </span>
                  <Box variant="small" color="text-body-secondary">{p.current_stage?.label}</Box>
                </div>
              ),
              sections: [
                { id: 'img', content: (p) => <CoverImage propertyId={p.property.id} height={96} radius={8} showLabel={false} /> },
                { id: 'track', content: (p) => {
                  const cur = p.stage_progress.find((s) => s.key === p.current_stage?.key);
                  return (
                    <SpaceBetween size="xxs">
                      <Box variant="small" color="text-body-secondary">{p.property.address_std}</Box>
                      <Box fontSize="body-s">{cur ? `${cur.label} · 这段做了 ${cur.done}/${cur.total}` : p.current_stage?.label}<Box variant="span" color="text-body-secondary">　大节点过了 {p.stage_progress.filter((s) => s.gate_done).length}/5</Box></Box>
                    </SpaceBetween>
                  );
                } },
                { id: 'next', header: '轮到', content: (p) => (
                  p.next_up.length ? (
                    <SpaceBetween size="xxs">
                      {p.next_up.slice(0, 2).map((n) => (
                        <span key={n.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                          {/* 审计 #A02：菱形原先用硬编码的旧 info 蓝，改中性边框；「是不是关键节点」靠字重表示 */}
                          {n.gate && <span style={{ width: 9, height: 9, transform: 'rotate(45deg)', border: `2px solid ${TEXT_2}`, borderRadius: 2, marginRight: 6, flexShrink: 0 }} />}
                          {n.owners.map((o) => <OwnerDot key={o} code={o} />)}<span style={{ fontWeight: n.gate ? 700 : 400 }}>{n.title}</span>
                        </span>
                      ))}
                    </SpaceBetween>
                  ) : <Box color="text-body-secondary">这段的事都做完了</Box>
                ) },
                { id: 'warn', content: (p) => (p.earlier_undone_count > 0 ? <StatusIndicator type="warning">前面 {p.earlier_undone_count} 项没确认</StatusIndicator> : <Box variant="small" color="text-status-success">前面的都确认了</Box>) },
              ],
            }} />
        ) : empty(loading ? '正在读取…' : '没有在进行中的房子。');
      }
      case 'upcoming': {
        const ups = widgets?.upcoming ?? [];
        return ups.length ? (
          <SpaceBetween size="s">
            {ups.map((u, k) => (
              <div key={k} style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                <Box fontWeight="bold" color="text-body-secondary"><span style={{ display: 'inline-block', minWidth: 44 }}>{shortDate(u.date)}</span></Box>
                <StatusIndicator type={u.days < 0 ? (u.overdue ? 'error' : 'stopped') : u.days <= 7 ? 'warning' : 'info'}>{u.kind}</StatusIndicator>
                <span>{projLink(u.project_id, u.project_name)} <Box variant="span" color="text-body-secondary">{u.days < 0 ? `${-u.days} 天前` : u.days === 0 ? '今天' : `${u.days} 天后`}</Box></span>
              </div>
            ))}
          </SpaceBetween>
        ) : empty('未来 30 天没有关键日期。');
      }
      case 'capital': {
        const caps = widgets?.capital ?? [];
        const total = caps.reduce((a, r) => a + r.total, 0);
        return caps.length ? (
          <SpaceBetween size="s">
            <Box color="text-body-secondary">在建项目合计压着 <b>{fullMoney(total)}</b>（买入价 + 已支出）</Box>
            <HBars rows={caps.map((r) => ({ key: String(r.project_id), label: projLink(r.project_id, r.project_name), values: [r.purchase_price, r.spent], tooltipTitle: r.project_name }))} series={['买入价', '已支出']} format={compactMoney} />
          </SpaceBetween>
        ) : empty('没有在建项目');
      }
      case 'retro': {
        const rs = widgets?.retrospectives ?? [];
        return (
          <Table variant="embedded" items={rs} empty={empty('还没有带成交价的已完成项目')}
            columnDefinitions={[
              { id: 'n', header: '项目', cell: (r) => projLink(r.project_id, r.project_name) },
              { id: 't', header: '目标售价', cell: (r) => money(r.target_arv) },
              { id: 's', header: '成交价', cell: (r) => money(r.sale_price) },
              { id: 'se', header: '售价偏差', cell: (r) => <DeltaBadge pct={r.arv_error_pct} goodWhenPositive /> },
              { id: 'b', header: '预算', cell: (r) => money(r.budget_planned) },
              { id: 'a', header: '实际支出', cell: (r) => money(r.spent) },
              { id: 'be', header: '预算偏差', cell: (r) => <DeltaBadge pct={r.budget_error_pct} goodWhenPositive={false} /> },
              { id: 'p', header: '实际利润', cell: (r) => money(r.profit) },
              { id: 'd', header: '工期', cell: (r) => (r.days == null ? '—' : `${r.days} 天`) },
            ]} />
        );
      }
      case 'weekly': {
        const ws = widgets?.weekly_spend ?? [];
        const total = ws.reduce((a, r) => a + r.amount, 0);
        return ws.length ? (
          <SpaceBetween size="s">
            <Box color="text-body-secondary">12 周共支出 <b>{fullMoney(total)}</b>，每周平均 {compactMoney(total / ws.length)}</Box>
            <Trend points={ws.map((r) => ({ x: shortDate(r.week_start), y: r.amount }))} format={compactMoney} height={170} />
          </SpaceBetween>
        ) : empty('没有支出记录');
      }
      case 'vendors': {
        const vs = widgets?.vendors ?? [];
        const vmax = Math.max(...vs.map((v) => v.amount), 1);
        return (
          <Table variant="embedded" items={vs} empty={empty('没有供应商支出')}
            columnDefinitions={[
              { id: 'v', header: '供应商', cell: (r) => r.vendor },
              { id: 'a', header: '金额', minWidth: 200, cell: (r) => <InlineBar value={r.amount} max={vmax} text={fullMoney(r.amount)} width={100} /> },
              { id: 'c', header: '笔数', cell: (r) => r.count },
              { id: 'p', header: '项目数', cell: (r) => r.projects },
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
              <div key={`${g.project_id}-${g.key}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, alignItems: 'center', padding: '8px 10px', borderRadius: 6, border: `1px solid ${BORDER}` }}>
                <div style={{ minWidth: 0 }}>
                  {/* KAN-63：去掉行首的 ◆ 和粗体。一屏里主按钮只留页头那一个，
                      这里的「去确认」降成链接——它是导航，不是本屏的主操作。 */}
                  <div>{g.title} <Box variant="span" color="text-body-secondary">· {g.project_name}</Box></div>
                  {g.is_current && <StatusIndicator type="in-progress">当前阶段</StatusIndicator>}
                  <Box variant="small" color="text-body-secondary">{g.stage}{g.evidence_hint ? ` · ${g.evidence_hint}` : ''}{g.confirmed.length ? ` · ${g.confirmed.join('、')} 已确认` : ''}</Box>
                </div>
                <Link
                  href={`/projects/${g.project_id}?tab=overview&step=${g.key}&action=confirm`}
                  onFollow={(e) => { e.preventDefault(); go(`/projects/${g.project_id}?tab=overview&step=${g.key}&action=confirm`); }}
                >去确认</Link>
              </div>
            ))}
          </SpaceBetween>
        ) : empty('没有等你确认的大节点。');
      }
      case 'mytodo':
        return <MyTodoTable compact rows={roleData ? (roleData.my_todo ?? []) : null} onReload={reloadRole} />;
      case 'procurement': {
        const rs = roleData?.procurement_alerts ?? [];
        return rs.length ? (
          <SpaceBetween size="s">
            {rs.map((r) => (
              <div key={r.project_id}>
                <Box fontWeight="bold">{projLink(r.project_id, r.project_name)} <Link href={`/projects/${r.project_id}?tab=budget&section=procurement`} onFollow={(e) => { e.preventDefault(); go(`/projects/${r.project_id}?tab=budget&section=procurement`); }} fontSize="body-s">管采购</Link></Box>
                {r.exception.length > 0 && <Box fontSize="body-s"><StatusIndicator type="error">异常 {r.exception.length}</StatusIndicator> {r.exception.join('、')}</Box>}
                {r.pending_order.length > 0 && <Box fontSize="body-s"><StatusIndicator type="warning">待下单 {r.pending_order.length}</StatusIndicator> {r.pending_order.slice(0, 5).join('、')}{r.pending_order.length > 5 ? '…' : ''}</Box>}
                {r.pending_spec_count > 0 && <Box variant="small" color="text-body-secondary">还有 {r.pending_spec_count} 项待选型</Box>}
              </div>
            ))}
          </SpaceBetween>
        ) : empty('采购没有异常，也没有待下单的。');
      }
      case 'site': {
        const rs = roleData?.site ?? [];
        return rs.length ? (
          <ColumnLayout columns={3} minColumnWidth={220}>
            {rs.map((r) => (
              <div key={r.project_id}>
                <Box fontWeight="bold">{projLink(r.project_id, r.project_name)}</Box>
                <div style={{ display: 'flex', gap: 4, margin: '6px 0' }}>
                  {r.photo_ids.length ? r.photo_ids.map((id) => <img key={id} src={`/api/files/${id}/download`} alt="" style={{ width: 64, height: 48, objectFit: 'cover', borderRadius: 4, background: '#e9ecef' }} />) : <Box variant="small" color="text-body-secondary">还没有进度照片</Box>}
                </div>
                <Box variant="small" color="text-body-secondary">{r.photo_count} 张进度照片</Box>
                {r.failed.length > 0 ? <StatusIndicator type="error">{r.failed.join('、')} 没过</StatusIndicator>
                  : r.last_inspection ? <StatusIndicator type={r.last_inspection.result === 'passed' ? 'success' : 'pending'}>{r.last_inspection.name} · {r.last_inspection.result === 'passed' ? '通过' : '已约'}</StatusIndicator>
                  : <Box variant="small" color="text-body-secondary">还没有检查</Box>}
              </div>
            ))}
          </ColumnLayout>
        ) : empty('没有在建项目');
      }
      case 'utilities': {
        const rs = roleData?.utilities_insurance ?? [];
        // 审计 #A04：原先是 10px 纯色圆点，含义**只靠颜色**，唯一补充是 title——
        // 而 title 要 hover 才出来，iPhone 上没有 hover，等于没有。直接违反官方
        // 「color should never be the only visual means of conveying information」。
        // 改 StatusIndicator：图标 + 文字承担含义，颜色只做强化。
        const UTIL: Record<string, { type: 'success' | 'pending' | 'stopped' | 'info'; label: string }> = {
          on: { type: 'success', label: '通' }, pending: { type: 'pending', label: '待' },
          off: { type: 'stopped', label: '停' },
        };
        const dot = (st: string) => { const u = UTIL[st] ?? { type: 'info' as const, label: '未知' };
          return <Box variant="span" margin={{ right: 'xxs' }}><StatusIndicator type={u.type}>{u.label}</StatusIndicator></Box>; };
        return rs.length ? (
          <Table variant="embedded" items={rs} columnDefinitions={[
            { id: 'p', header: '房', cell: (r) => projLink(r.project_id, r.project_name) },
            { id: 'u', header: '水 · 电 · 瓦斯', cell: (r) => <span>{dot(r.water)}{dot(r.electric)}{dot(r.gas)}{r.blocker && <Box variant="small" color="text-status-warning">{r.blocker}</Box>}</span> },
            { id: 'i', header: '保险', cell: (r) => (r.insurance_days == null ? '—' : <StatusIndicator type={r.insurance_days < 0 ? 'error' : r.insurance_days <= 30 ? 'warning' : 'success'}>{r.insurance_days < 0 ? `过期 ${-r.insurance_days} 天` : `${r.insurance_days} 天后到期`}</StatusIndicator>) },
            { id: 'a', header: '', cell: (r) => <Link href={`/projects/${r.project_id}?tab=data&section=utilities`} onFollow={(e) => { e.preventDefault(); go(`/projects/${r.project_id}?tab=data&section=utilities`); }}>去填</Link> },
          ]} />
        ) : empty('没有需要管水电的房子');
      }
      case 'permits': {
        const rs = roleData?.permits ?? [];
        return rs.length ? (
          <Table variant="embedded" items={rs} columnDefinitions={[
            { id: 'p', header: '房', cell: (r) => projLink(r.project_id, r.project_name) },
            { id: 'pm', header: 'permit', cell: (r) => (r.permit === 'issued' ? <StatusIndicator type="success">已核发</StatusIndicator> : r.permit === 'applied' ? <StatusIndicator type="in-progress">已申请{r.applied_days != null ? ` ${r.applied_days} 天` : ''}</StatusIndicator> : <StatusIndicator type="pending">没申请</StatusIndicator>) },
            { id: 'n', header: '下一次检查', cell: (r) => (r.final_passed ? <StatusIndicator type="success">final 已过</StatusIndicator> : r.next_inspection ? `${r.next_inspection.name}${r.next_inspection.date ? ` · ${shortDate(r.next_inspection.date)}` : ''}` : '—') },
            { id: 'f', header: '没过', cell: (r) => (r.failed.length ? <StatusIndicator type="error">{r.failed.join('、')}</StatusIndicator> : '—') },
          ]} />
        ) : empty('没有在建项目');
      }
      case 'design': {
        const rs = roleData?.design ?? [];
        const ok = (b: boolean) => <StatusIndicator type={b ? 'success' : 'pending'}>{b ? '已交' : '没交'}</StatusIndicator>;
        return rs.length ? (
          <Table variant="embedded" items={rs} columnDefinitions={[
            { id: 'p', header: '房', cell: (r) => projLink(r.project_id, r.project_name) },
            { id: 'm', header: '量尺记录', cell: (r) => ok(r.measure_note) },
            { id: 'd', header: '设计方案', cell: (r) => ok(r.drawing) },
            { id: 'f', header: '定稿图纸', cell: (r) => ok(r.drawing_final) },
          ]} />
        ) : empty('没有在进行的房子');
      }
      case 'saledocs': {
        const rs = roleData?.sale_docs ?? [];
        // 审计 #A05：符号本身已是第二通道，只把硬编码的旧色值换成令牌
        const ok = (b: boolean) => <span style={{ color: b ? TEXT_GOOD : TEXT_2, fontWeight: 700 }}>{b ? '✓' : '○'}</span>;
        return rs.length ? (
          <Table variant="embedded" items={rs} columnDefinitions={[
            { id: 'p', header: '房', cell: (r) => <span>{projLink(r.project_id, r.project_name)}<Box variant="small" color="text-body-secondary">挂牌 {r.list_date ? shortDate(r.list_date) : '—'}</Box></span> },
            { id: 'o', header: 'offer', cell: (r) => ok(r.offer) },
            { id: 's', header: '文件包', cell: (r) => ok(r.sale_docs) },
            { id: 'd', header: '披露', cell: (r) => ok(r.disclosure) },
            { id: 'g', header: '签署版', cell: (r) => ok(r.sale_signed) },
            { id: 'c', header: '结算单', cell: (r) => ok(r.sale_closing) },
          ]} />
        ) : empty('没有在售的房子');
      }
      case 'boss': {
        const b = roleData?.boss;
        return b ? (
          <ColumnLayout columns={5} variant="text-grid">
            <StatTile label="在手" value={`${b.active + b.leads}`} sub={`${b.active} 在建 · ${b.leads} 线索`} />
            <StatTile label="总投入" value={compactMoney(b.total_invested)} sub="在建买入价 + 已支出" />
            <StatTile label="预计利润" value={compactMoney(b.expected_profit)} sub="在建" />
            <StatTile label="已实现利润" value={compactMoney(b.realized_profit)} sub={`${b.portfolio} 套已售`} />
            <StatTile label="超预算" value={`${b.over_budget_count}`} sub="套" tone={b.over_budget_count > 0 ? 'bad' : undefined} />
          </ColumnLayout>
        ) : empty('没有数据');
      }
      case 'funnel': {
        const fs = widgets?.funnel ?? [];
        return fs.length ? (
          <HBars rows={fs.map((r) => ({ key: r.substage, label: r.label, values: [r.count] }))} ordinal format={(n) => `${n} 条`} labelWidth={72} />
        ) : empty('没有线索');
      }
    }
  };

  // 看板只放额外小组件，list 不在候选里（它已经固定在页面上）
  const hidden = (Object.keys(WIDGETS) as WidgetId[])
    .filter((id) => id !== 'list' && !items.some((i) => i.id === id) && canAdd(id));

  // 页头写事实，不喊口号。紧急 = 有 error/warning 级洞察的房子数，按项目去重。
  const urgent = new Set(insights.filter((i) => i.level !== 'info').map((i) => i.projectId)).size;
  const pageDescription = [
    urgent ? `今天有 ${urgent} 套需要处理。` : null,
    `在建 ${summary?.active ?? '—'} 套，线索 ${summary?.leads ?? '—'} 条，已完成 ${summary?.portfolio ?? '—'} 套。`,
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
                items={hidden.length ? hidden.map((id) => ({ id, text: WIDGETS[id].title })) : [{ id: 'none', text: '所有小组件都在看板上', disabled: true }]}
                onItemClick={({ detail }) => { if (detail.id !== 'none') { const next = [...items, mkItem(detail.id as WidgetId)]; setItems(next); saveLayout(role.actor, next); } }}
              >添加小组件</ButtonDropdown>
              {role.can('create_project') && <Button variant="primary" onClick={() => go('/projects/new')}>新建项目</Button>}
            </SpaceBetween>
          }
        >
          项目
        </Header>
      }
    >
      <SpaceBetween size="l">
        {/* 四个数字直接跟在页头下面。原先套一层叫「今日概览」的 Container，
            等于给四个数字单独起了个栏目名——控制台里这层壳没有意义。 */}
        <ColumnLayout columns={4} minColumnWidth={120} variant="text-grid">
              <Stat label="线索" value={String(summary?.leads ?? '—')} sub={`${projects.filter((p) => p.lead_heat === 'hot_lead').length} 条热线索`} />
              <Stat label="在建" value={String(summary?.active ?? '—')} sub={summary?.money_hidden ? '正在施工或挂牌' : `${summary?.over_budget_count ?? 0} 个超预算`} />
              {summary?.money_hidden ? (
                <>
                  <Stat label="轮到我" value={String(roleData?.my_todo?.length ?? '—')} sub={`${roleData?.my_todo?.filter((r) => r.is_current).length ?? 0} 件是现在这段的`} />
                  <Stat label="已完成" value={String(summary?.portfolio ?? '—')} sub="已售出的房子" />
                </>
              ) : (
                <>
                  <Stat label="已投入" value={compactMoney(summary?.total_invested)} sub="在建项目买入价 + 已支出" />
                  <Stat label="预计利润" value={compactMoney(summary?.expected_profit)} sub="在建：目标售价 − 买入 − 装修" />
                </>
              )}
        </ColumnLayout>

        {/* 项目表固定渲染，不再是看板的一项：没有拖动手柄、没有关闭按钮。 */}
        <Table
          {...collectionProps}
          items={rows}
          loading={loading}
          loadingText="加载中"
          variant="container"
          resizableColumns
          onRowClick={({ detail }) => go(`/projects/${detail.item.id}`)}
          header={<Header variant="h2" counter={`(${filtered.length})`}>全部项目</Header>}
          filter={
            <SpaceBetween direction="horizontal" size="xs">
              <TextFilter {...filterProps} filteringPlaceholder="按项目名或地址查找" countText={`${rows.length} 个匹配`} />
              <Select selectedOption={stage} options={stageOptions} onChange={({ detail }) => setStage(detail.selectedOption as any)} />
            </SpaceBetween>
          }
          pagination={<Pagination {...paginationProps} />}
          columnDefinitions={projectColumns}
        />

        {items.length > 0 && <Board
          items={items}
          i18nStrings={boardI18n}
          onItemsChange={({ detail }) => { setItems(detail.items); saveLayout(role.actor, detail.items); }}
          empty={null}
          renderItem={(item, actions) => (
            <BoardItem
              header={<Header variant="h2"><ReviewTag id={item.data.tag} />{item.data.title}</Header>}
              i18nStrings={itemI18n}
              settings={<Button variant="icon" iconName="close" ariaLabel="移除小组件" onClick={() => actions.removeItem()} />}
            >
              {widget(item.id as WidgetId)}
            </BoardItem>
          )}
        />}
      </SpaceBetween>
    </ContentLayout>
  );
}
