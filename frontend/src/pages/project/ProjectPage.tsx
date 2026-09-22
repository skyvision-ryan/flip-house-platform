import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Box from '@cloudscape-design/components/box';
import BreadcrumbGroup from '@cloudscape-design/components/breadcrumb-group';
import Button from '@cloudscape-design/components/button';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Grid from '@cloudscape-design/components/grid';
import Header from '@cloudscape-design/components/header';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import Tabs from '@cloudscape-design/components/tabs';
import StatusBadge from '../../components/StatusBadge';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import CoverImage from '../../components/CoverImage';
import ReviewTag from '../../components/ReviewTag';
import { api, Project } from '../../api/client';
import { useFlash } from '../../lib/flash';
import { money, num } from '../../lib/format';
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

/**
 * 页头第二组字段：买入价、目标售价、预计利润、关键日期。
 *
 * 原先是「交易」「时间」两栏大字，每栏两句话，和下面总览的横条说同一件事。
 * 改成四个带标签的字段——同样的数，但每个值上面写清楚它是什么，缺数就写「—」。
 * 三个阶段各自取对应的口径：线索看挂牌与估值，在建看目标与预算，已售看成交与实际利润。
 */
function dealFields(p: Project): { label: string; value: string }[] {
  const dash = '—';
  if (p.money_hidden) {
    return [{ label: '交易', value: '金额对你的身份不显示' }];
  }
  if (p.stage === 'lead') {
    return [
      { label: '挂牌价', value: money(p.property.list_price) || dash },
      { label: '目标售价', value: money(p.target_arv) || dash },
      { label: '估值', value: money(p.property.avm_value) || dash },
    ];
  }
  if (p.stage === 'portfolio') {
    const profit = p.sale_price != null ? p.sale_price - (p.purchase_price ?? 0) - (p.budget_spent ?? 0) : null;
    return [
      { label: '买入价', value: money(p.purchase_price) || dash },
      { label: '成交价', value: money(p.sale_price) || dash },
      { label: '实际利润', value: profit == null ? dash : money(profit) },
    ];
  }
  // 在建：预计利润 = 目标售价 − 买入 − 装修（预算和已支出里取大的那个，别低估成本）
  const cost = (p.purchase_price ?? 0) + Math.max(p.budget_planned ?? 0, p.budget_spent ?? 0);
  const profit = p.target_arv != null ? p.target_arv - cost : null;
  return [
    { label: '买入价', value: money(p.purchase_price) || dash },
    { label: '目标售价', value: money(p.target_arv) || dash },
    { label: '预计利润', value: profit == null ? dash : money(profit) },
  ];
}

/**
 * 把若干段文字拼成一行，**每段内部不断行**，只允许在分隔符处换行。
 *
 * 中文没有词边界，浏览器可以在任意字之间折行——实测「计划完工 11/05」被折成
 * 「计划完 / 工 11/05」。整段 nowrap 又会撑破格子，所以只锁每一段。
 */
function segments(parts: string[], sep: string) {
  return (
    <span>
      {parts.map((t, i) => (
        <span key={t}>
          {i > 0 && sep}
          <span style={{ whiteSpace: 'nowrap' }}>{t}</span>
        </span>
      ))}
    </span>
  );
}

/** 关键日期一句话。工期进度只留在总览的横条上，这里不重复报「第 n / n 天」。 */
function keyDates(p: Project) {
  const steps = ([['买入', p.purchase_date], ['开工', p.construction_start], ['计划完工', p.construction_end], ['挂牌', p.list_date], ['成交', p.sale_date]] as [string, string | null][])
    .filter(([, d]) => d) as [string, string][];
  if (!steps.length) return '—';
  return segments(steps.map(([k, d]) => `${k} ${short(d)}`), ' → ');
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
  const specParts = [prop.year_built ? `${prop.year_built} 年` : null, prop.sqft ? `${num(prop.sqft)} sqft` : null, prop.beds != null ? `${prop.beds} 卧 ${prop.baths_full ?? 0} 卫` : null, prop.style].filter(Boolean) as string[];

  return (
    <ContentLayout
      breadcrumbs={<BreadcrumbGroup items={[{ text: '工作台', href: '/' }, { text: '项目', href: '/projects' }, { text: project.name, href: `/projects/${pid}` }]} onFollow={(e) => { e.preventDefault(); navigate(e.detail.href); }} />}
      header={
        <Container>
          {/* KAN-63：页头收成资源头——照片 150→96，占 2 列不是 3 列。
              页头是用来确认「我在哪个项目」的，不是展示位。窄屏仍各占 12。 */}
          <Grid gridDefinition={[{ colspan: { default: 12, s: 2 } }, { colspan: { default: 12, s: 10 } }]}>
            <CoverImage propertyId={prop.id} height={96} radius={8} showLabel={false} />
            <SpaceBetween size="m">
              <Header
                variant="h1"

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
                  <span>{project.name}</span>
                  <StatusBadge status={project.status} />
                </div>
              </Header>
              {/* 地址、户型、阶段、策略原先拼成一句用「 · 」串起来的说明，读起来像一行小字。
                  改成带标签的字段：每个值上面写清楚它是什么。 */}
              <KeyValuePairs
                columns={4}
                items={[
                  { label: '地址', value: prop.address_std },
                  { label: '房子', value: specParts.length ? segments(specParts, ' · ') : '—' },
                  { label: '阶段', value: project.current_stage?.label ?? `${labelOf(meta?.stages, project.stage)} · ${labelOf(meta?.substages[project.stage], project.substage)}` },
                  { label: '策略', value: labelOf(meta?.strategies, project.strategy) },
                ]}
              />
              {/* 第二组字段：钱和日期。原先是「交易」「时间」两栏大字，
                  每栏两句话，还和总览的工期条重复报同一件事。 */}
              <KeyValuePairs columns={4} items={[...dealFields(project), { label: '关键日期', value: keyDates(project) }]} />
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
