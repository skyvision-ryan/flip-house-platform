import { systemText } from '../../i18n/core.ts';
import { useLanguage } from '../../i18n/LanguageProvider';
import { m as uiText } from '../../i18n/core.ts';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, BudgetSummary, Project, TaskList, Update } from '../../api/client';
import InspectionsPanel from '../../components/InspectionsPanel';
import ProjectTasks from '../../components/ProjectTasks';
import StepsPanel, { StepsDeepLink } from '../../components/StepsPanel';
import UpdatesList from '../../components/UpdatesList';
import { BulletList, compactMoney, Meter } from '../../components/charts';
import ExpandableSection from '../../components/ui/ExpandableSection';
import KeyValuePairs from '../../components/ui/Facts';
import Header from '../../components/ui/Header';
import Container from '../../components/ui/Surface';
import { useFlash } from '../../lib/flash';
import { dateStr, money, num, text } from '../../lib/format';

export default function OverviewTab({ project, reload, deepLink, focus, tasks, tasksErr, reloadTasks }: { project: Project; reload: () => Promise<any>; deepLink?: StepsDeepLink; focus?: string | null; tasks: TaskList | null; tasksErr: string | null; reloadTasks: () => Promise<any> }) {
  useLanguage();
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
        <Alert type="info" header={<>{uiText("overviewTab.data.completeness")}</>}>
          {uiText("overviewTab.these.key.fields.are.missing")}{project.missing_fields.map(value => systemText(value)).join(' / ')}{uiText("overviewTab.add.them.in.data.or.edit.project")} </Alert>
      )}
      <ProjectTasks
        project={project}
        data={tasks}
        error={systemText(tasksErr)}
        reload={reloadTasks}
        onChanged={() => { api.projectUpdates(project.id, 12).then(setUpdates).catch(() => undefined); }}
        onGotoGates={() => { setStepsOpen(true); requestAnimationFrame(() => document.getElementById('gates')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }}
      />
      <div id="gates" />
      <ExpandableSection cardId="project-evidence"
        variant="container"
        expanded={stepsOpen}
        onChange={({ detail }) => setStepsOpen(detail.expanded)}
        headerText={<>{uiText("overviewTab.milestones.evidence.and.schedule")}</> as any}
        headerDescription={uiText("overviewTab.milestones.follow.their.configured.confirmation.rules.evidence.satisfaction.is")}
      >
        <StepsPanel projectId={project.id} deepLink={deepLink} schedule={{ start: project.construction_start, end: project.construction_end, active: project.stage === 'active' }} onChanged={() => { reload(); api.projectUpdates(project.id, 12).then(setUpdates).catch(() => undefined); }} />
      </ExpandableSection>
      <div id="inspections" />
      <Container cardId="project-inspections" header={<Header variant="h2" help={uiText("overviewTab.record.each.inspection.separately.schedule.when.work.is.ready")}>{uiText("zoeyDesign.inspection.records")}</Header>}>
        <InspectionsPanel projectId={project.id} onChanged={() => { reload(); api.projectUpdates(project.id, 12).then(setUpdates).catch(() => undefined); }} />
      </Container>

      {!project.money_hidden && overCats.length > 0 && (
        <Container cardId="project-budget" header={<Header variant="h2" description={uiText("sentences.categories.are.over.budget.see.budget.for.all.categories", { value1: (overCats.length) })}>{uiText("cardRegistry.budget.variance")}</Header>}>
          <SpaceBetween size="l">
            {summary && summary.planned_total > 0 && (
              <Meter value={summary.spent_total} max={summary.planned_total} label={uiText("overviewTab.total.budget.used")} reading={`${compactMoney(summary.spent_total)} / ${compactMoney(summary.planned_total)}`} targetLabel={uiText("updatesList.budget")} note={summary.remaining >= 0 ? uiText("sentences.remaining", { value1: (compactMoney(summary.remaining)) }) : uiText("sentences.over.budget.3", { value1: (compactMoney(-summary.remaining)) })} />
            )}
            <BulletList rows={bulletRows} format={compactMoney} overAt={1.0} labelWidth={120} targetLabel={uiText("updatesList.budget")} emptyText="" />
          </SpaceBetween>
        </Container>
      )}

      <ExpandableSection cardId="project-facts" headerText={<>{uiText("cardRegistry.project.documents")}</> as any} variant="container">
        <KeyValuePairs
          columns={project.money_hidden ? 3 : 2}
          items={[
            {label: uiText("company.label"), value: project.holding_company || uiText("company.empty")},
            ...(project.money_hidden ? [] : [
              { label: uiText("founderDesign.purchase.price"), value: money(project.purchase_price) },
              { label: uiText("overviewTab.after.repair.value.arv"), value: money(project.target_arv) },
              { label: uiText("overviewTab.renovation.budget"), value: money(project.budget_planned) },
            ]),
            { label: uiText("leadershipProjectDetail.purchase.date"), value: dateStr(project.purchase_date) },
            { label: uiText("stepActions.construction.start.date"), value: dateStr(project.construction_start) },
            { label: uiText("addProject.planned.finish"), value: dateStr(project.construction_end) },
            { label: uiText("stepActions.listing.date"), value: dateStr(project.list_date) },
            { label: uiText("stepActions.closing.date"), value: dateStr(project.sale_date) },
            ...(project.money_hidden ? [] : [{ label: uiText("overviewTab.actual.sale.price"), value: money(project.sale_price) }]),
            { label: uiText("overviewTab.building.area"), value: project.property.sqft ? `${num(project.property.sqft)} sqft` : '—' },
            { label: uiText("addProject.beds.baths"), value: project.property.beds != null ? uiText("sentences.beds.baths.2", { value1: (project.property.beds), value2: (project.property.baths_full ?? 0) }) : '—' },
            { label: uiText("overviewTab.status.explanation"), value: project.status_reason || '—' },
          ]}
        />
      </ExpandableSection>

      <Container cardId="project-risks"
        header={<Header variant="h2" actions={<Button loading={savingRisks} disabled={risks === (project.risks ?? '')} onClick={async () => { setSavingRisks(true); try { await api.patchProject(project.id, { risks: risks || null }); await reload(); flash({ type: 'success', content: uiText("overviewTab.risk.saved") }); } finally { setSavingRisks(false); } }}>{uiText("fieldWithSource.save")}</Button>}>{uiText("cardRegistry.risk")}</Header>}
      >
        <Textarea value={risks} rows={4} placeholder={uiText("overviewTab.record.known.risks.such.as.foundation.roof.or.permit")} onChange={({ detail }) => setRisks(detail.value)} />
      </Container>
      {project.notes && (
        <Container cardId="project-notes" header={<Header variant="h2">{uiText("inspectionsPanel.notes")}</Header>}>
          <Box>{text(project.notes)}</Box>
        </Container>
      )}
      <Container cardId="project-updates" header={<Header variant="h2" counter={`(${updates.length})`} help={uiText("overviewTab.file.uploads.data.changes.expenses.and.checklist.activity.appear")}>{uiText("cardRegistry.recent.updates")}</Header>}>
        <UpdatesList items={updates} onGo={(href) => navigate(href)} />
      </Container>
    </SpaceBetween>
  );
}
