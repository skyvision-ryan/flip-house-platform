import { useEffect, useState } from 'react';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';
import { useNavigate } from 'react-router-dom';
import StepsPanel, { StepsDeepLink } from '../../components/StepsPanel';
import ProjectTasks from '../../components/ProjectTasks';
import InspectionsPanel from '../../components/InspectionsPanel';
import UpdatesList from '../../components/UpdatesList';
import OwnerTag from '../../components/OwnerTag';
import { BulletList, Meter, compactMoney } from '../../components/charts';
import { api, BudgetSummary, Project, TaskList, Update } from '../../api/client';
import { useFlash } from '../../lib/flash';
import { dateStr, money, num, text } from '../../lib/format';
import ReviewTag from '../../components/ReviewTag';

export default function OverviewTab({ project, reload, deepLink, focus, tasks, tasksErr, reloadTasks }: { project: Project; reload: () => Promise<any>; deepLink?: StepsDeepLink; focus?: string | null; tasks: TaskList | null; tasksErr: string | null; reloadTasks: () => Promise<any> }) {
  const flash = useFlash();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<BudgetSummary | null>(null);
  const [updates, setUpdates] = useState<Update[]>([]);
  const [risks, setRisks] = useState(project.risks ?? '');
  const [savingRisks, setSavingRisks] = useState(false);
  // KAN-75：任务区是唯一的任务入口；原 B 区（证据清单 + 关键节点 D/J + 工期条）收进下方可展开区，
  // 有深链（?step=）或点了「去确认」时自动展开。
  const [stepsOpen, setStepsOpen] = useState<boolean>(Boolean(deepLink?.step));
  useEffect(() => { if (deepLink?.step) setStepsOpen(true); }, [deepLink?.step]);

  useEffect(() => { if (!project.money_hidden) api.budgetSummary(project.id).then(setSummary).catch(() => setSummary(null)); }, [project.id, project.updated_at, project.money_hidden]);
  useEffect(() => { api.projectUpdates(project.id, 12).then(setUpdates).catch(() => setUpdates([])); }, [project.id, project.updated_at]);
  useEffect(() => { setRisks(project.risks ?? ''); }, [project.risks]);
  useEffect(() => {
    if (focus !== 'inspections') return;
    const el = document.getElementById('inspections');
    requestAnimationFrame(() => el?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [focus, project.id]);

  const cats = [...(summary?.categories ?? [])].sort((a, b) => b.planned - a.planned || b.spent - a.spent);
  const overCats = cats.filter((c) => c.planned > 0 && c.spent > c.planned * 1.05);
  const bulletRows = overCats.slice(0, 6).map((c) => ({ key: c.category, label: c.category, actual: c.spent, target: c.planned }));

  return (
    <SpaceBetween size="l">
      {project.missing_fields.length > 0 && (
        <Alert type="info" header={<><ReviewTag id="A" />数据完整度</>}>
          以下关键字段还没有值：{project.missing_fields.join('、')}。可在“数据”页或“编辑”中补充。
        </Alert>
      )}
      <ProjectTasks
        project={project}
        data={tasks}
        error={tasksErr}
        reload={reloadTasks}
        onChanged={() => { api.projectUpdates(project.id, 12).then(setUpdates).catch(() => undefined); }}
        onGotoGates={() => { setStepsOpen(true); requestAnimationFrame(() => document.getElementById('gates')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }}
      />
      <div id="gates" />
      <ExpandableSection
        variant="container"
        expanded={stepsOpen}
        onChange={({ detail }) => setStepsOpen(detail.expanded)}
        headerText={<><ReviewTag id="B" />关键节点、证据清单与工期</> as any}
        headerDescription="关键节点要 D、J 各确认一次。事项满足只表示证据齐了，不是验收；上面任务表的「满足」列就来自这里。"
      >
        <StepsPanel projectId={project.id} deepLink={deepLink} schedule={{ start: project.construction_start, end: project.construction_end, active: project.stage === 'active' }} onChanged={() => { reload(); api.projectUpdates(project.id, 12).then(setUpdates).catch(() => undefined); }} />
      </ExpandableSection>
      <div id="inspections" />
      <Container header={<Header variant="h2" description="一次检查一行，次数每套房不同。做到一个程度约一次；没过写谁整改；最后一次标 final，通过了施工就算结束。"><ReviewTag id="I" /><OwnerTag block="overview.inspections" />检查记录</Header>}>
        <InspectionsPanel projectId={project.id} onChanged={() => { reload(); api.projectUpdates(project.id, 12).then(setUpdates).catch(() => undefined); }} />
      </Container>

      {!project.money_hidden && overCats.length > 0 && (
        <Container header={<Header variant="h2" description={`${overCats.length} 个类别超支；完整分类在预算页。`}><ReviewTag id="D" /><OwnerTag block="overview.budget" />预算偏差</Header>}>
          <SpaceBetween size="l">
            {summary && summary.planned_total > 0 && (
              <Meter value={summary.spent_total} max={summary.planned_total} label="总预算已用" reading={`${compactMoney(summary.spent_total)} / ${compactMoney(summary.planned_total)}`} targetLabel="预算" note={summary.remaining >= 0 ? `剩余 ${compactMoney(summary.remaining)}` : `已超支 ${compactMoney(-summary.remaining)}`} />
            )}
            <BulletList rows={bulletRows} format={compactMoney} overAt={1.0} labelWidth={120} targetLabel="预算" emptyText="" />
          </SpaceBetween>
        </Container>
      )}

      <ExpandableSection headerText={<><ReviewTag id="C" />项目资料</> as any} variant="container">
        <KeyValuePairs
          columns={project.money_hidden ? 3 : 2}
          items={[
            ...(project.money_hidden ? [] : [
              { label: '买入价', value: money(project.purchase_price) },
              { label: '目标售价（ARV）', value: money(project.target_arv) },
              { label: '装修预算', value: money(project.budget_planned) },
            ]),
            { label: '买入日期', value: dateStr(project.purchase_date) },
            { label: '开工日期', value: dateStr(project.construction_start) },
            { label: '计划完工', value: dateStr(project.construction_end) },
            { label: '挂牌日期', value: dateStr(project.list_date) },
            { label: '成交日期', value: dateStr(project.sale_date) },
            ...(project.money_hidden ? [] : [{ label: '实际成交价', value: money(project.sale_price) }]),
            { label: '建筑面积', value: project.property.sqft ? `${num(project.property.sqft)} sqft` : '—' },
            { label: '户型', value: project.property.beds != null ? `${project.property.beds} 卧 ${project.property.baths_full ?? 0} 卫` : '—' },
            { label: '状态说明', value: project.status_reason || '—' },
          ]}
        />
      </ExpandableSection>

      <Container
        header={<Header variant="h2" actions={<Button loading={savingRisks} disabled={risks === (project.risks ?? '')} onClick={async () => { setSavingRisks(true); try { await api.patchProject(project.id, { risks: risks || null }); await reload(); flash({ type: 'success', content: '风险已保存' }); } finally { setSavingRisks(false); } }}>保存</Button>}><ReviewTag id="F" /><OwnerTag block="overview.risks" />风险</Header>}
      >
        <Textarea value={risks} rows={4} placeholder="记录已知风险，例如地基、屋顶、许可证问题。" onChange={({ detail }) => setRisks(detail.value)} />
      </Container>
      {project.notes && (
        <Container header={<Header variant="h2"><ReviewTag id="G" /><OwnerTag block="overview.notes" />备注</Header>}>
          <Box>{text(project.notes)}</Box>
        </Container>
      )}
      <Container header={<Header variant="h2" counter={`(${updates.length})`} description="谁上传了文件、改了数据、记了支出、勾了清单，都在这里。"><ReviewTag id="H" /><OwnerTag block="overview.updates" />最近更新</Header>}>
        <UpdatesList items={updates} onGo={(href) => navigate(href)} />
      </Container>
    </SpaceBetween>
  );
}
