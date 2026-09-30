import { focusValue } from '../../i18n/taskDisplay.ts';
import { systemText } from '../../i18n/core.ts';
import { useLanguage } from '../../i18n/LanguageProvider';
import { m as uiText } from '../../i18n/core.ts';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import BreadcrumbGroup from '@cloudscape-design/components/breadcrumb-group';
import Button from '@cloudscape-design/components/button';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import Tabs from '@cloudscape-design/components/tabs';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, Project, TaskList } from '../../api/client';
import CoverImage from '../../components/CoverImage';
import StagePositionBar from '../../components/StagePositionBar';
import StatusBadge from '../../components/StatusBadge';
import ExpandableSection from '../../components/ui/ExpandableSection';
import KeyValuePairs from '../../components/ui/Facts';
import Header from '../../components/ui/Header';
import Container from '../../components/ui/Surface';
import { useFlash } from '../../lib/flash';
import { money, num } from '../../lib/format';
import { labelOf, useMeta } from '../../lib/meta';
import { useRole } from '../../lib/role';
import AnalysisTab from './AnalysisTab';
import { projectTab } from '../../lib/procurement';
import ProcurementTab from './ProcurementTab';
import BudgetTab from './BudgetTab';
import DataTab from './DataTab';
import EditProjectModal from './EditProjectModal';
import FilesTab from './FilesTab';
import OverviewTab from './OverviewTab';

// 审计 #A12：原先 lead/active/portfolio 用 severity-low/medium/green，拿「严重度」表「阶段」——
// 线索项目顶着低告警色、在建顶着中告警色。阶段不是状态，区分靠 current_stage.label 的文字。

const short = (d: string | null) => (d ? d.slice(5).replace('-', '/') : '—');

/**
 * 页头第二组字段：买入价、目标售价、预计利润、关键日期。
 *
 * 原先是「交易」「时间」两栏大字，每栏两句话，和下面总览的横条说同一件事。
 * 改成四个带标签的字段——同样的数，但每个值上面写清楚它是什么，缺数就写「—」。
 * 三个阶段各自取对应的口径：线索看挂牌与估值，在建看目标与预算，已售看成交与实际利润。
 * KAN-71：利润是缺失数据判断，不是公式——买入价或售价缺任一项就显示「—」，不把缺的当 0。
 */
function dealFields(p: Project): { label: string; value: string }[] {
  const dash = '—';
  if (p.money_hidden) {
    return [{ label: uiText("projectPage.transaction"), value: systemText('金额对你的身份不显示') }];
  }
  if (p.stage === 'lead') {
    return [
      { label: uiText("leadGroups.list.price"), value: money(p.property.list_price) },
      { label: uiText("dashboard.target.sale.price"), value: money(p.target_arv) },
      { label: uiText("projectPage.valuation"), value: money(p.property.avm_value) },
    ];
  }
  if (p.stage === 'portfolio') {
    const profit = p.sale_price != null && p.purchase_price != null ? p.sale_price - p.purchase_price - (p.budget_spent ?? 0) : null;
    return [
      { label: uiText("founderDesign.purchase.price"), value: money(p.purchase_price) },
      { label: uiText("dashboard.sale.price"), value: money(p.sale_price) },
      { label: uiText("dashboard.actual.profit"), value: profit == null ? dash : money(profit) },
    ];
  }
  // 在建：预计利润 = 目标售价 − 买入 − 装修（预算和已支出里取大的那个，别低估成本）
  const profit = p.target_arv != null && p.purchase_price != null
    ? p.target_arv - p.purchase_price - Math.max(p.budget_planned ?? 0, p.budget_spent ?? 0)
    : null;
  return [
    { label: uiText("founderDesign.purchase.price"), value: money(p.purchase_price) },
    { label: uiText("dashboard.target.sale.price"), value: money(p.target_arv) },
    { label: uiText("dashboard.estimated.profit"), value: profit == null ? dash : money(profit) },
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
          <span className="ui-nowrap">{t}</span>
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
  useLanguage();
  const { id } = useParams();
  const pid = Number(id);
  const navigate = useNavigate();
  const meta = useMeta();
  const flash = useFlash();
  const role = useRole();
  const [params, setParams] = useSearchParams();
  const [project, setProject] = useState<Project | null>(null);
  // KAN-75 块 4：任务表在页面层加载一次，头卡三条事实与总览任务区共用同一份数据
  const [tasks, setTasks] = useState<TaskList | null>(null);
  const [tasksErr, setTasksErr] = useState<string | null>(null);
  const reloadTasks = useCallback(() => api.projectTasks(pid).then((d) => { setTasks(d); setTasksErr(null); }).catch((e) => setTasksErr(e.message)), [pid]);
  useEffect(() => { reloadTasks(); }, [reloadTasks]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const reload = useCallback(() => api.project(pid).then(p => { setProject(p); setLoadError(null); }).then(() => reloadTasks()).catch(e => setLoadError(e.message)), [pid, reloadTasks]);
  useEffect(() => { reload(); }, [reload]);

  if (loadError) return <Alert type="error" header={uiText("projectPage.cannot.open.this.property")} action={<Button onClick={reload}>{uiText("addProject.retry")}</Button>}>{systemText(loadError)} <Button variant="inline-link" onClick={() => navigate('/')}>{uiText("app.back.to.workspace")}</Button></Alert>;
  if (!project) return <Box padding="xxl" textAlign="center"><Spinner size="large" /></Box>;

  const canAnalyze = !!meta && role.can('analysis');
  const tab = projectTab(params.get('tab'), params.get('section'), { money: role.canReadMoney, procurement: role.can('procurement_read'), analysis: canAnalyze, data: role.tier !== 'grey' });
  const step = params.get('step');
  const action = params.get('action');
  const section = params.get('section');
  const focus = params.get('focus');
  const prop = project.property;
  const specParts = [prop.year_built ? uiText("sentences.year", { value1: (prop.year_built) }) : null, prop.sqft ? `${num(prop.sqft)} sqft` : null, prop.beds != null ? uiText("sentences.beds.baths.2", { value1: (prop.beds), value2: (prop.baths_full ?? 0) }) : null, prop.style].filter(Boolean) as string[];

  return (
    <ContentLayout maxContentWidth={1440}
      breadcrumbs={<BreadcrumbGroup items={[{ text: uiText("app.workspace"), href: '/' }, { text: uiText("app.projects"), href: '/projects' }, { text: project.name, href: `/projects/${pid}` }]} onFollow={(e) => { e.preventDefault(); navigate(e.detail.href); }} />}
      header={
        <Container embedded cardId="project-header" cardContext={project.name}>
          <SpaceBetween size="l">
            <div className="ui-project-identity">
              <CoverImage propertyId={prop.id} width={96} height={96} radius={8} showLabel={false} />
              <SpaceBetween size="s">
                <Header variant="h1" actions={
                  <SpaceBetween direction="horizontal" size="xs">
                    {role.can('edit_project') && <Button iconName="edit" onClick={() => setEditing(true)}>{uiText("projectPage.edit")}</Button>}
                    {role.can('delete_project') && <ButtonDropdown items={[{ id: 'delete', text: uiText("projectPage.delete.project") }]} onItemClick={({ detail }) => { if (detail.id === 'delete') setConfirmDelete(true); }}>{uiText("filesTab.actions")}</ButtonDropdown>}
                  </SpaceBetween>
                }>
                  <div className="ui-row-wrap">
                    <span>{project.name}</span><StatusBadge status={project.status} />
                  </div>
                </Header>
                <Box color="text-body-secondary">{prop.address_std}{specParts.length ? ` · ${specParts.join(' · ')}` : ''}</Box>
              </SpaceBetween>
            </div>
            {/* 当前事实与房屋身份分层；仍只陈述任务、日期和关键节点已有的数据。 */}
            {tasks && tasks.focus.length > 0 && (
              <div className="ui-project-focus"><KeyValuePairs columns={3} items={tasks.focus.map((f) => ({ label: systemText(f.label), value: f.tone === 'warning' ? <Box color="text-status-warning" fontWeight="bold">{focusValue(f)}</Box> : <Box fontWeight="bold">{focusValue(f)}</Box> }))} /></div>
            )}
            <StagePositionBar position={project.group_position} />
            {project.group_position?.history_pending && <Alert type="info">{uiText("projectPage.this.property.was.entered.mid.process.earlier.tasks.and")}</Alert>}
            <ExpandableSection headerText={uiText("projectPage.property.and.transaction.details")}>
              <KeyValuePairs columns={4} items={[{ label: uiText("projectPage.strategy"), value: labelOf(meta?.strategies, project.strategy) }, ...dealFields(project), { label: uiText("projectPage.key.dates"), value: keyDates(project) }]} />
            </ExpandableSection>
          </SpaceBetween>
        </Container>
      }
    >
      <SpaceBetween size="l">
        <Tabs
          activeTabId={tab}
          onChange={({ detail }) => setParams((prev) => { const n = new URLSearchParams(prev); n.set('tab', detail.activeTabId); n.delete('section'); return n; })}
          tabs={[
            { id: 'overview', label: uiText("designCollaboration.overview"), content: <OverviewTab project={project} reload={reload} deepLink={{ step, action }} focus={focus} tasks={tasks} tasksErr={systemText(tasksErr)} reloadTasks={reloadTasks} /> },
            ...(canAnalyze ? [{ id: 'analysis', label: uiText("updatesList.analysis"), content: <AnalysisTab project={project} reload={reload} /> }] : []),
            ...(role.tier !== 'grey' ? [{ id: 'data', label: uiText("updatesList.data"), content: <DataTab projectId={pid} reload={reload} section={section} /> }] : []),
            { id: 'files', label: uiText("updatesList.files"), content: <FilesTab projectId={pid} /> },
            ...(role.can('procurement_read') ? [{ id: 'procurement', label: uiText("projectPage.project.procurement"), content: <ProcurementTab key={pid} project={project} initialItemId={Number(params.get('item')) || undefined} /> }] : []),
            ...(role.canReadMoney ? [{ id: 'budget', label: uiText("updatesList.budget"), content: <BudgetTab projectId={pid} reload={reload} /> }] : []),
          ]}
        />
      </SpaceBetween>
      <EditProjectModal visible={editing} project={project} onDismiss={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />
      <Modal
        visible={confirmDelete}
        onDismiss={() => setConfirmDelete(false)}
        header={uiText("projectPage.delete.project")}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setConfirmDelete(false)}>{uiText("fieldWithSource.cancel")}</Button>
              <Button variant="primary" onClick={async () => { await api.deleteProject(pid); flash({ type: 'success', content: uiText("sentences.deleted", { value1: (project.name) }) }); navigate('/'); }}>{uiText("analysisTab.delete")}</Button>
            </SpaceBetween>
          </Box>
        }
      >
        {uiText("projectPage.delete")}{project.name}{uiText("projectPage.its.budgets.expenses.file.registrations.and.analyses.will.also")} </Modal>
    </ContentLayout>
  );
}
