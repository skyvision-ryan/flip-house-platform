import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Box from '@cloudscape-design/components/box';
import BreadcrumbGroup from '@cloudscape-design/components/breadcrumb-group';
import Button from '@cloudscape-design/components/button';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Grid from '@cloudscape-design/components/grid';
import Header from '@cloudscape-design/components/header';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import Tabs from '@cloudscape-design/components/tabs';
import StatusBadge from '../../components/StatusBadge';
import CoverImage from '../../components/CoverImage';
import ReviewTag from '../../components/ReviewTag';
import OwnerTag from '../../components/OwnerTag';
import { api, Project } from '../../api/client';
import { useFlash } from '../../lib/flash';
import { dateStr, daysBetween, money, num, pct } from '../../lib/format';
import { labelOf, useMeta } from '../../lib/meta';
import { useRole } from '../../lib/role';
import OverviewTab from './OverviewTab';
import AnalysisTab from './AnalysisTab';
import DataTab from './DataTab';
import FilesTab from './FilesTab';
import BudgetTab from './BudgetTab';
import EditProjectModal from './EditProjectModal';

// 审计 #A12：原先 lead/active/portfolio 用 severity-low/medium/green，拿「严重度」表「阶段」——
// 线索项目顶着低告警色、在建顶着中告警色。阶段不是状态，区分靠 current_stage.label 的文字。

const short = (d: string | null) => (d ? d.slice(5).replace('-', '/') : '—');

/** 身份卡右侧“交易”一栏：按阶段说结论。 */
function DealSummary({ p }: { p: Project }) {
  const prop = p.property;
  if (p.money_hidden) return <Box color="text-body-secondary">金额对你的身份不显示</Box>;
  if (p.stage === 'lead') {
    return (
      <SpaceBetween size="xxs">
        <Box>挂牌 {money(prop.list_price)} <Box variant="span" color="text-body-secondary" fontWeight="normal">· 估值 {money(prop.avm_value)}</Box></Box>
        <Box color="text-body-secondary">{p.target_arv ? `目标售价 ${money(p.target_arv)}${p.purchase_price ? `，意向价 ${money(p.purchase_price)}` : ''}` : '目标售价未定，先在“分析”里算一遍'}</Box>
      </SpaceBetween>
    );
  }
  if (p.stage === 'portfolio') {
    const profit = p.sale_price != null ? p.sale_price - (p.purchase_price ?? 0) - (p.budget_spent ?? 0) : null;
    const cost = (p.purchase_price ?? 0) + (p.budget_spent ?? 0);
    return (
      <SpaceBetween size="xxs">
        <Box>买入 {money(p.purchase_price)} → 成交 {money(p.sale_price)}</Box>
        <Box color="text-body-secondary">{profit == null ? '成交价未填' : `实际利润 ${money(profit)} · 利润率 ${cost ? pct(profit / cost * 100) : '—'}${p.target_arv ? ` · 目标售价 ${money(p.target_arv)}` : ''}`}</Box>
      </SpaceBetween>
    );
  }
  const cost = (p.purchase_price ?? 0) + Math.max(p.budget_planned ?? 0, p.budget_spent ?? 0);
  const profit = p.target_arv != null ? p.target_arv - cost : null;
  return (
    <SpaceBetween size="xxs">
      <Box>买入 {money(p.purchase_price)} → 目标售价 {money(p.target_arv)}</Box>
      <Box color="text-body-secondary">{profit == null ? '目标售价未定' : `预计利润 ${money(profit)} · 利润率 ${cost ? pct(profit / cost * 100) : '—'} · 装修预算 ${money(p.budget_planned)}`}</Box>
    </SpaceBetween>
  );
}

/** 身份卡右侧“时间”一栏。 */
function Timeline({ p }: { p: Project }) {
  const steps = ([['买入', p.purchase_date], ['开工', p.construction_start], ['计划完工', p.construction_end], ['挂牌', p.list_date], ['成交', p.sale_date]] as [string, string | null][])
    .filter(([, d]) => d) as [string, string][];
  const total = daysBetween(p.construction_start, p.construction_end);
  const elapsed = daysBetween(p.construction_start, new Date().toISOString().slice(0, 10));
  return (
    <SpaceBetween size="xxs">
      <Box>{steps.length ? steps.map(([k, d]) => `${k} ${short(d)}`).join(' → ') : '还没有关键日期'}</Box>
      {p.stage === 'active' && total && elapsed != null ? (
        /* KAN-63：页头这条工期条删掉，只留一句话。总览里 StepsPanel 的两条横条
           才是工期和事项的正式刻度，页头再画一条等于同一件事量两遍。 */
        <Box color="text-body-secondary">
          第 {Math.max(0, elapsed)} / {total} 天{elapsed > total ? ` · 已超期 ${elapsed - total} 天` : ''}
        </Box>
      ) : p.stage === 'portfolio' && p.list_date && p.sale_date ? (
        <Box color="text-body-secondary">挂牌到成交 {daysBetween(p.list_date, p.sale_date)} 天{total ? `，工期 ${total} 天` : ''}</Box>
      ) : (
        <Box color="text-body-secondary">创建于 {dateStr(p.created_at)}，最近更新 {dateStr(p.updated_at)}</Box>
      )}
    </SpaceBetween>
  );
}

export default function ProjectPage() {
  const { id } = useParams();
  const pid = Number(id);
  const navigate = useNavigate();
  const meta = useMeta();
  const flash = useFlash();
  const role = useRole();
  const [params, setParams] = useSearchParams();
  const [project, setProject] = useState<Project | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const reload = useCallback(() => api.project(pid).then(setProject), [pid]);
  useEffect(() => { reload(); }, [reload]);

  if (!project) return <Box padding="xxl" textAlign="center"><Spinner size="large" /></Box>;

  const tab = params.get('tab') ?? 'overview';
  const step = params.get('step');
  const action = params.get('action');
  const section = params.get('section');
  const focus = params.get('focus');
  const prop = project.property;
  const specs = [prop.year_built ? `${prop.year_built} 年` : null, prop.sqft ? `${num(prop.sqft)} sqft` : null, prop.beds != null ? `${prop.beds} 卧 ${prop.baths_full ?? 0} 卫` : null, prop.style].filter(Boolean).join(' · ');

  return (
    <ContentLayout
      breadcrumbs={<BreadcrumbGroup items={[{ text: '工作台', href: '/' }, { text: '项目', href: '/projects' }, { text: project.name, href: `/projects/${pid}` }]} onFollow={(e) => { e.preventDefault(); navigate(e.detail.href); }} />}
      header={
        <Container>
          {/* KAN-63：页头收成资源头——照片 150→96，占 2 列不是 3 列。
              页头是用来确认「我在哪个项目」的，不是展示位。窄屏仍各占 12。 */}
          <Grid gridDefinition={[{ colspan: { default: 12, s: 2 } }, { colspan: { default: 12, s: 10 } }]}>
            <CoverImage propertyId={prop.id} height={96} radius={8} />
            <SpaceBetween size="m">
              <Header
                variant="h1"
                description={<span>{prop.address_std}{specs ? ` · ${specs}` : ''}
                  {` · ${project.current_stage?.label ?? `${labelOf(meta?.stages, project.stage)} · ${labelOf(meta?.substages[project.stage], project.substage)}`}`}
                  {` · ${labelOf(meta?.strategies, project.strategy)}`}</span>}
                actions={
                  <SpaceBetween direction="horizontal" size="xs">
                    {role.can('edit_project') && <Button onClick={() => setEditing(true)}>编辑</Button>}
                    {role.can('delete_project') && <ButtonDropdown items={[{ id: 'delete', text: '删除项目' }]} onItemClick={({ detail }) => { if (detail.id === 'delete') setConfirmDelete(true); }}>操作</ButtonDropdown>}
                  </SpaceBetween>
                }
              >
                {/* 窄屏要能换行：SpaceBetween 横向不换行，这里用 flex-wrap。 */}
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <ReviewTag id="A" />
                  <OwnerTag block="project.header" />
                  <span>{project.name}</span>
                  {/* KAN-63：阶段与策略徽章移进 description，跟在地址和户型后面。
                      它们是这个项目「是什么」，属于描述，不该在标题行占两个灰胶囊。 */}
                  <StatusBadge status={project.status} />
                </div>
              </Header>
              <ColumnLayout columns={2} minColumnWidth={260} variant="text-grid">
                <div>
                  <Box variant="awsui-key-label">交易</Box>
                  <DealSummary p={project} />
                </div>
                <div>
                  <Box variant="awsui-key-label">时间</Box>
                  <Timeline p={project} />
                </div>
              </ColumnLayout>
            </SpaceBetween>
          </Grid>
        </Container>
      }
    >
      <SpaceBetween size="l">
        <Tabs
          activeTabId={tab}
          onChange={({ detail }) => setParams((prev) => { const n = new URLSearchParams(prev); n.set('tab', detail.activeTabId); return n; })}
          tabs={[
            { id: 'overview', label: '总览', content: <OverviewTab project={project} reload={reload} deepLink={{ step, action }} focus={focus} /> },
            ...(role.canReadMoney ? [{ id: 'analysis', label: '分析', content: <AnalysisTab project={project} reload={reload} /> }] : []),
            ...(role.tier !== 'grey' ? [{ id: 'data', label: '数据', content: <DataTab projectId={pid} reload={reload} section={section} /> }] : []),
            { id: 'files', label: '文件', content: <FilesTab projectId={pid} /> },
            ...(role.canReadMoney || role.can('procurement') ? [{ id: 'budget', label: '预算', content: <BudgetTab projectId={pid} reload={reload} section={section} /> }] : []),
          ]}
        />
      </SpaceBetween>
      <EditProjectModal visible={editing} project={project} onDismiss={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />
      <Modal
        visible={confirmDelete}
        onDismiss={() => setConfirmDelete(false)}
        header="删除项目"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setConfirmDelete(false)}>取消</Button>
              <Button variant="primary" onClick={async () => { await api.deleteProject(pid); flash({ type: 'success', content: `已删除“${project.name}”` }); navigate('/'); }}>删除</Button>
            </SpaceBetween>
          </Box>
        }
      >
        确定删除“{project.name}”？项目下的预算、支出、文件登记和分析会一起删除，房产记录保留。
      </Modal>
    </ContentLayout>
  );
}
