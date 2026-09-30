import { sourceNote } from '../../i18n/sourceNotes.ts';
import { analysisName, materialName } from '../../i18n/templateNames.ts';
import { systemText } from '../../i18n/core.ts';
import { useLanguage } from '../../i18n/LanguageProvider';
import { m as uiText } from '../../i18n/core.ts';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import Checkbox from '@cloudscape-design/components/checkbox';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Grid from '@cloudscape-design/components/grid';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import RadioGroup from '@cloudscape-design/components/radio-group';
import Select from '@cloudscape-design/components/select';
import Slider from '@cloudscape-design/components/slider';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Toggle from '@cloudscape-design/components/toggle';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Analysis, api, Project } from '../../api/client';
import HelpText from '../../components/HelpText';
import SourceBadge from '../../components/SourceBadge';
import { BulletList, compactMoney, StackedBar, StatTile } from '../../components/charts';
import ExpandableSection from '../../components/ui/ExpandableSection';
import FormField from '../../components/ui/FormField';
import Header from '../../components/ui/Header';
import Container from '../../components/ui/Surface';
import { AnalysisInputs, fullOutputs, RehabRow, Row } from '../../lib/analysis';
import { useActor } from '../../lib/actor';
import { useFlash } from '../../lib/flash';
import { money, pct } from '../../lib/format';
import { useMeta } from '../../lib/meta';

const analysisDrafts = new Map<string, AnalysisInputs>();

const num = (v: unknown) => { const x = typeof v === 'string' ? parseFloat(v) : (v as number); return Number.isFinite(x) ? x : 0; };
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

function Metric({ label, value, sub, help, tone }: { label: string; value: string; sub?: string; help?: string; tone?: 'good' | 'bad' }) {
  useLanguage();
  return <StatTile label={label} value={value} sub={sub} help={help} tone={tone} size="m" />;
}

function RowsEditor({ rows, onChange, sources, prefix, addLabel }: { rows: Row[]; onChange: (r: Row[]) => void; sources?: Record<string, any>; prefix?: string; addLabel: string }) {
  useLanguage();
  return (
    <SpaceBetween size="xs">
      {rows.map((r, i) => (
        <Grid key={i} gridDefinition={[{ colspan: 6 }, { colspan: 4 }, { colspan: 2 }]}>
          <FormField label={r.template_key ? materialName({ ...r, name: r.label }) : undefined} constraintText={r.template_key ? uiText("analysisTemplate.originalLabel") : undefined}><Input value={r.label} placeholder={uiText("analysisTab.item")} onChange={({ detail }) => onChange(rows.map((x, j) => (j === i ? { ...x, label: detail.value } : x)))} /></FormField>
          <SpaceBetween direction="horizontal" size="xxs" alignItems="center">
            <Input type="number" value={str(r.amount)} onChange={({ detail }) => onChange(rows.map((x, j) => (j === i ? { ...x, amount: detail.value } : x)))} />
            {sources && prefix && sources[`${prefix}.${r.label}`] && <SourceBadge {...sources[`${prefix}.${r.label}`]} fetchedAt={sources[`${prefix}.${r.label}`].fetched_at} />}
          </SpaceBetween>
          <Button variant="icon" iconName="close" ariaLabel={uiText("analysisTab.delete")} onClick={() => onChange(rows.filter((_, j) => j !== i))} />
        </Grid>
      ))}
      <Button iconName="add-plus" variant="inline-link" onClick={() => onChange([...rows, { label: '', amount: '' }])}>{addLabel}</Button>
    </SpaceBetween>
  );
}

export default function AnalysisTab({ project, reload }: { project: Project; reload: () => Promise<any> }) {
  useLanguage();
  const meta = useMeta();
  const { me } = useActor();
  const draftPrefix = `${me?.id ?? 'demo'}:${project.id}:`;
  const flash = useFlash();
  const [list, setList] = useState<Analysis[] | null>(null);
  const [aid, setAid] = useState<number | null>(null);
  const [inputs, setInputs] = useState<AnalysisInputs | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyMode, setApplyMode] = useState<'replace' | 'append'>('replace');
  const [applyPrices, setApplyPrices] = useState(true);
  const [applying, setApplying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [retry, setRetry] = useState(0);
  const latestInputs = useRef(inputs); latestInputs.current = inputs;
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);

  const load = useCallback(async (selectId?: number) => {
    if (dirty.current && !window.confirm(systemText('分析修改尚未保存。在本次浏览期间保留修改并切换方案？'))) return;
    const rows = await api.analyses(project.id);
    setList(rows);
    const pick = rows.find((a) => a.id === selectId) ?? rows.find((a) => a.is_current) ?? rows[0] ?? null;
    setAid(pick?.id ?? null);
    const cached = pick ? analysisDrafts.get(`${draftPrefix}${pick.id}`) : undefined;
    setInputs(cached ?? pick?.inputs ?? null);
    dirty.current = !!cached;
  }, [project.id, draftPrefix]);
  useEffect(() => { load().catch(e => setSaveError(e.message)); }, [load]);

  const out = useMemo(() => (inputs ? fullOutputs(inputs) : null), [inputs]);
  const sources = inputs?.sources ?? {};

  const update = (patch: Partial<AnalysisInputs>) => {
    setInputs((prev) => { if (!prev) return prev; const next = { ...prev, ...patch }; if (aid) analysisDrafts.set(`${draftPrefix}${aid}`, next); return next; });
    dirty.current = true; setSaveError('');
  };

  // 停顿 700ms 后保存到后端
  useEffect(() => {
    if (!inputs || !aid || !dirty.current) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      setSaving(true); setSaveError('');
      try { const saved = await api.patchAnalysis(aid, { inputs }); setList((l) => l?.map((a) => (a.id === saved.id ? saved : a)) ?? null); if (latestInputs.current === inputs) { dirty.current = false; analysisDrafts.delete(`${draftPrefix}${aid}`); } }
      catch (e: any) { setSaveError(e.message); }
      finally { setSaving(false); }
    }, 700);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [inputs, aid, retry]);
  useEffect(() => {
    const prevent = (e: BeforeUnloadEvent) => { if (dirty.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, []);

  const create = async (tier: string) => {
    const a = await api.createAnalysis(project.id, { tier, use_default_name: true });
    await load(a.id);
    await reload();
    flash({ type: 'success', content: uiText("sentences.created.prefilled.from.known.data.and.industry.defaults", { value1: (analysisName(a)) }) });
  };

  const remove = async () => {
    if (!aid) return;
    await api.deleteAnalysis(aid);
    await load();
    await reload();
    flash({ type: 'success', content: uiText("analysisTab.version.deleted") });
  };

  const apply = async () => {
    if (!aid) return;
    setApplying(true);
    try {
      await api.applyAnalysis(aid, { mode: applyMode, apply_prices: applyPrices });
      await reload();
      setApplyOpen(false);
      flash({ type: 'success', content: uiText("sentences.applied.to.project.renovation.line.items.budget.lines", { value1: (applyPrices ? uiText("analysisTab.target.sale.price.and.purchase.price.updated") : ''), value2: (applyMode === 'replace' ? uiText("analysisTab.replace") : uiText("analysisTab.append.to")) }) });
    } finally { setApplying(false); }
  };

  if (list === null && saveError) return <Alert type="error" action={<Button onClick={() => load().catch(e => setSaveError(e.message))}>{uiText("analysisTab.reload")}</Button>}>{systemText(saveError)}</Alert>;
  if (list === null) return <Box padding="l" textAlign="center"><Spinner /></Box>;

  if (!inputs || !out || !aid) {
    return (
      <Container cardId="analysis-empty" header={<Header variant="h2">{uiText("cardRegistry.deal.analysis")}</Header>}>
        <SpaceBetween size="m">
          <Box>{uiText("analysisTab.no.analysis.yet.known.valuation.list.price.property.tax")}</Box>
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="primary" onClick={() => create('medium')}>{uiText("analysisTab.prefill.medium.renovation")}</Button>
            <Button onClick={() => create('light')}>{uiText("analysisTab.light.renovation")}</Button>
            <Button onClick={() => create('heavy')}>{uiText("analysisTab.heavy.renovation")}</Button>
          </SpaceBetween>
        </SpaceBetween>
      </Container>
    );
  }

  const current = list.find((a) => a.id === aid)!;
  const fin = inputs.financing ?? { enabled: true, down_pct: 20, rate_pct: 7, years: 30 };
  const profitable = out.total_profit > 0;
  const priceOk = num(inputs.purchase_price) <= out.mao;
  const catOptions = meta?.budget_categories.map((c) => ({ label: systemText(c), value: c })) ?? [];
  const costSegments = [
    { label: uiText("analysisTab.acquisition"), value: out.purchase_total },
    { label: uiText("analysisTab.holding"), value: out.holding_total },
    { label: uiText("designCollaboration.renovation"), value: out.rehab_total },
    { label: uiText("analysisTab.sale"), value: out.selling_total },
  ];

  return (
    <SpaceBetween size="l">
      {saveError && <Alert type="error" header={uiText("analysisTab.unsaved.changes")} action={<Button onClick={() => setRetry(v => v + 1)}>{uiText("analysisTab.retry.saving")}</Button>}>{systemText(saveError)} {uiText("analysisTab.inputs.remain.in.this.browser.session.including.when.you")}</Alert>}
      <Container cardId="analysis-inputs"
        header={
          <Header
            variant="h2"
            description={inputs.note || undefined}
            help={uiText("analysisTab.changing.inputs.recalculates.results.prefilled.fields.retain.their.sources")}
            actions={
              <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                {saveError ? <StatusIndicator type="error">{uiText("analysisTab.save.failed")}</StatusIndicator> : saving || dirty.current ? <StatusIndicator type="loading">{uiText("analysisTab.saving")}</StatusIndicator> : <StatusIndicator type="success">{uiText("analysisTab.saved")}</StatusIndicator>}
                <Select
                  selectedOption={{ label: analysisName(current) + (current.is_current ? uiText("analysisTab.current") : ''), value: String(current.id) }}
                  options={list.map((a) => ({ label: analysisName(a) + (a.is_current ? uiText("analysisTab.current") : ''), value: String(a.id) }))}
                  onChange={({ detail }) => load(Number(detail.selectedOption.value))}
                />
                <ButtonDropdown
                  items={[
                    { id: 'light', text: uiText("analysisTab.new.version.light.renovation") }, { id: 'medium', text: uiText("analysisTab.new.version.medium.renovation") }, { id: 'heavy', text: uiText("analysisTab.new.version.heavy.renovation") },
                    { id: 'current', text: uiText("analysisTab.set.as.current.version"), disabled: current.is_current },
                    { id: 'delete', text: uiText("analysisTab.delete.this.version"), disabled: list.length <= 1 },
                  ]}
                  onItemClick={async ({ detail }) => {
                    if (['light', 'medium', 'heavy'].includes(detail.id)) create(detail.id);
                    else if (detail.id === 'current') { await api.patchAnalysis(aid, { is_current: true }); await load(aid); }
                    else if (detail.id === 'delete') remove();
                  }}
                >{uiText("analysisTab.version")}</ButtonDropdown>
                <Button variant="primary" disabled={saving || dirty.current || !!saveError} disabledReason={uiText("analysisTab.wait.for.the.analysis.to.save.before.applying.it")} onClick={() => setApplyOpen(true)}>{uiText("analysisTab.apply.to.project")}</Button>
              </SpaceBetween>
            }
          >
            {uiText("cardRegistry.deal.analysis")} </Header>
        }
      >
        <Box margin={{ bottom: 's' }}><Box variant="h3" display="inline">{uiText("analysisTab.key.metrics")}</Box></Box>
        <ColumnLayout columns={4} minColumnWidth={160} variant="text-grid">
          <Metric label={uiText("analysisTab.total.profit")} value={money(out.total_profit)} sub={profitable ? undefined : uiText("analysisTab.loss.costs.exceed.sale.price")} help={uiText("analysisTab.sale.price.less.all.costs")} tone={profitable ? 'good' : 'bad'} />
          <Metric label={uiText("analysisTab.return.on.total.cost")} value={pct(out.profit_margin_pct)} help={uiText("analysisTab.profit.total.cost")} />
          <Metric label={uiText("analysisTab.return.on.cash.invested")} value={pct(out.roi_pct)} help={uiText("analysisTab.profit.cash.invested")} />
          <Metric label={uiText("analysisTab.equity.multiple")} value={out.equity_multiple == null ? '—' : `${out.equity_multiple.toFixed(2)}×`} help={uiText("analysisTab.cash.returned.after.loan.payoff.cash.invested")} />
          <Metric label={uiText("analysisTab.total.cost")} value={money(out.total_costs)} help={uiText("analysisTab.acquisition.holding.renovation.sale")} />
          <Metric label={uiText("analysisTab.cash.invested")} value={money(out.cash_invested)} sub={fin.enabled ? uiText("sentences.down.payment.charges.renovation.holding.principal.repaid", { value1: (money(out.down_payment)), value2: (money(out.principal_paid)) }) : uiText("analysisTab.all.cash.purchase.charges.renovation.holding")} />
          <Metric label={uiText("cardRegistry.sale.price")} value={money(out.sale_price)} help={uiText("analysisTab.expected.sale.price.after.renovation")} />
          <Metric label={uiText("analysisTab.renovation.total")} value={money(out.rehab_total)} sub={uiText("sentences.line.items", { value1: (inputs.rehab_items.length) })} />
        </ColumnLayout>
      </Container>

      <Grid gridDefinition={[{ colspan: { default: 12, m: 5 } }, { colspan: { default: 12, m: 7 } }]}>
        <SpaceBetween size="m">
          <ExpandableSection cardId="analysis-purchase" variant="container" header={<Header variant="h3" counter={money(out.purchase_total)}>{uiText("cardRegistry.acquisition.costs")}</Header>} defaultExpanded>
            <SpaceBetween size="m">
              <FormField label={<span>{uiText("founderDesign.purchase.price")} {sources.purchase_price && <SourceBadge source={sources.purchase_price.source} fetchedAt={sources.purchase_price.fetched_at} confidence={sources.purchase_price.confidence} note={sourceNote(sources.purchase_price)} />}</span>}>
                <Input type="number" value={str(inputs.purchase_price)} onChange={({ detail }) => update({ purchase_price: detail.value })} />
              </FormField>
              <FormField label={<span>{uiText("analysisTab.additional.charges")} {sources.purchase_extras && <SourceBadge source={sources.purchase_extras.source} note={sourceNote(sources.purchase_extras)} />}</span>} description={uiText("analysisTab.inspection.appraisal.legal.closing.etc")}>
                <RowsEditor rows={inputs.purchase_extras} onChange={(r) => update({ purchase_extras: r })} addLabel={uiText("analysisTab.add.item")} />
              </FormField>
            </SpaceBetween>
          </ExpandableSection>

          <ExpandableSection cardId="analysis-holding" variant="container" header={<Header variant="h3" counter={money(out.holding_total)}>{uiText("cardRegistry.holding.costs")}</Header>}>
            <SpaceBetween size="m">
              <FormField label={<span>{uiText("analysisTab.holding.months")} {sources.holding_months && <SourceBadge source={sources.holding_months.source} note={sourceNote(sources.holding_months)} />}</span>}>
                <Input type="number" value={str(inputs.holding_months)} onChange={({ detail }) => update({ holding_months: detail.value })} />
              </FormField>
              <FormField label={uiText("analysisTab.monthly.expenses")} description={uiText("analysisTab.taxes.insurance.utilities.hoa.fees.etc")}>
                <RowsEditor rows={inputs.monthly_costs} onChange={(r) => update({ monthly_costs: r })} sources={sources} prefix="monthly_costs" addLabel={uiText("analysisTab.add.item")} />
              </FormField>
              <Toggle checked={fin.enabled} onChange={({ detail }) => update({ financing: { ...fin, enabled: detail.checked } })}>
                {uiText("analysisTab.finance.the.purchase.monthly.payments.included.in.holding.cash")} </Toggle>
              {fin.enabled && (
                <ColumnLayout columns={3}>
                  <FormField label={uiText("analysisTab.down.payment")}><Input type="number" value={str(fin.down_pct)} onChange={({ detail }) => update({ financing: { ...fin, down_pct: num(detail.value) } })} /></FormField>
                  <FormField label={uiText("analysisTab.annual.interest.rate")}><Input type="number" value={str(fin.rate_pct)} onChange={({ detail }) => update({ financing: { ...fin, rate_pct: num(detail.value) } })} /></FormField>
                  <FormField label={uiText("analysisTab.term.in.years")}><Input type="number" value={str(fin.years)} onChange={({ detail }) => update({ financing: { ...fin, years: num(detail.value) } })} /></FormField>
                </ColumnLayout>
              )}
              {fin.enabled && (
                <Box variant="small" color="text-body-secondary">
                  {uiText("analysisTab.loan")} {money(out.loan_amount)}{uiText("analysisTab.down.payment.2")} {money(out.down_payment)}{uiText("analysisTab.monthly.payment")} {money(out.monthly_payment)}{uiText("analysisTab.holding.period.interest")} {money(out.interest_total)} {uiText("analysisTab.is.included.in.costs.principal")} {money(out.principal_paid)} {uiText("analysisTab.is.not.a.cost.it.reduces.the.loan.balance")} {money(out.loan_balance_at_sale)} {uiText("analysisTab.repaid.at.sale")}{sourceNote(sources.financing)}
                </Box>
              )}
            </SpaceBetween>
          </ExpandableSection>

          <ExpandableSection cardId="analysis-rehab" variant="container" header={<Header variant="h3" counter={money(out.rehab_total)}>{uiText("cardRegistry.renovation.line.items")}</Header>}>
            <SpaceBetween size="s">
              {sources.rehab_items && <Alert type="info">{sourceNote(sources.rehab_items)}</Alert>}
              {inputs.rehab_items.map((r: RehabRow, i: number) => (
                <Grid key={i} gridDefinition={[{ colspan: 5 }, { colspan: 5 }, { colspan: 2 }]}>
                  <Select
                    selectedOption={catOptions.find((o) => o.value === r.category) ?? { label: r.category, value: r.category }}
                    options={catOptions}
                    onChange={({ detail }) => update({ rehab_items: inputs.rehab_items.map((x, j) => (j === i ? { ...x, category: detail.selectedOption.value!, label: detail.selectedOption.value! } : x)) })}
                  />
                  <Input type="number" value={str(r.amount)} onChange={({ detail }) => update({ rehab_items: inputs.rehab_items.map((x, j) => (j === i ? { ...x, amount: detail.value } : x)) })} />
                  <Button variant="icon" iconName="close" ariaLabel={uiText("analysisTab.delete")} onClick={() => update({ rehab_items: inputs.rehab_items.filter((_, j) => j !== i) })} />
                </Grid>
              ))}
              <Button iconName="add-plus" variant="inline-link" onClick={() => update({ rehab_items: [...inputs.rehab_items, { category: '其他', label: '其他', amount: '' }] })}>{uiText("analysisTab.add.row")}</Button>
            </SpaceBetween>
          </ExpandableSection>

          <ExpandableSection cardId="analysis-selling" variant="container" header={<Header variant="h3" counter={money(out.selling_total)}>{uiText("cardRegistry.selling.costs")}</Header>}>
            <SpaceBetween size="m">
              <FormField label={<span>{uiText("analysisTab.selling.cost.commission.seller.closing.costs")} {sources.selling_pct && <SourceBadge source={sources.selling_pct.source} note={sourceNote(sources.selling_pct)} />}</span>}>
                <Input type="number" value={str(inputs.selling_pct)} onChange={({ detail }) => update({ selling_pct: detail.value })} />
              </FormField>
              <FormField label={uiText("analysisTab.other.selling.costs")}>
                <RowsEditor rows={inputs.selling_extras} onChange={(r) => update({ selling_extras: r })} addLabel={uiText("analysisTab.add.item")} />
              </FormField>
            </SpaceBetween>
          </ExpandableSection>
        </SpaceBetween>

        <SpaceBetween size="m">
          <Container cardId="analysis-price" header={<Header variant="h2" help={uiText("analysisTab.expected.after.repair.sale.price.from.valuation.or.your")}>{uiText("cardRegistry.sale.price")}</Header>}>
            <FormField label={<span>{uiText("cardRegistry.sale.price")} {sources.sale_price && <SourceBadge source={sources.sale_price.source} fetchedAt={sources.sale_price.fetched_at} confidence={sources.sale_price.confidence} note={sourceNote(sources.sale_price)} />}</span>}>
              <Input type="number" value={str(inputs.sale_price)} onChange={({ detail }) => update({ sale_price: detail.value })} />
            </FormField>
          </Container>

          <Container cardId="analysis-offer" header={<Header variant="h2" help={uiText("analysisTab.adjust.target.return.on.total.cost.profit.total.cost")}>{uiText("cardRegistry.maximum.allowable.offer")}</Header>}>
            <SpaceBetween size="m">
              <FormField label={uiText("sentences.target.return.on.total.cost", { value1: (num(inputs.target_margin_pct)) })}>
                <Slider value={num(inputs.target_margin_pct)} min={0} max={60} step={1} onChange={({ detail }) => update({ target_margin_pct: detail.value })} valueFormatter={(v) => `${v}%`} />
              </FormField>
              <ColumnLayout columns={2} variant="text-grid">
                <StatTile label={uiText("analysisTab.maximum.allowable.offer")} value={money(out.mao)} sub={priceOk ? uiText("sentences.current.purchase.price.is.below.the.maximum", { value1: (money(out.mao - num(inputs.purchase_price))) }) : uiText("sentences.current.purchase.price.is.above.the.maximum", { value1: (money(num(inputs.purchase_price) - out.mao)) })} tone={priceOk ? 'good' : 'bad'} />
                <StatTile label={uiText("analysisTab.70.rule.reference")} value={money(out.mao_rule70)} help={uiText("analysisTab.sale.price.70.renovation")} />
              </ColumnLayout>
              <BulletList
                rows={[{ key: 'price', label: uiText("analysisTab.current.purchase.price"), actual: num(inputs.purchase_price), target: out.mao }]}
                format={compactMoney}
                reading={(r) => uiText("sentences.vs.maximum", { value1: (compactMoney(r.actual)), value2: (compactMoney(r.target)) })}
                extraMarkers={[{ key: 'r70', at: () => out.mao_rule70, label: uiText("analysisTab.70.rule") }]}
                targetLabel={uiText("analysisTab.maximum")}
                labelWidth={90}
              />
              <HelpText>{uiText("analysisTab.the.gray.background.marks.the.maximum.offer.at.the")}</HelpText>
            </SpaceBetween>
          </Container>

          <Container cardId="analysis-costs" header={<Header variant="h2" help={uiText("analysisTab.the.bar.shows.cost.composition.the.line.is.sale")}>{uiText("cardRegistry.cost.breakdown")}</Header>}>
            <StackedBar segments={costSegments} format={compactMoney} marker={{ value: out.sale_price, label: uiText("cardRegistry.sale.price") }} legendColumns={2} />
          </Container>
        </SpaceBetween>
      </Grid>

      <Modal
        visible={applyOpen}
        onDismiss={() => setApplyOpen(false)}
        header={uiText("analysisTab.apply.to.project")}
        footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button variant="link" onClick={() => setApplyOpen(false)}>{uiText("fieldWithSource.cancel")}</Button><Button variant="primary" loading={applying} onClick={apply}>{uiText("analysisTab.apply")}</Button></SpaceBetween></Box>}
      >
        <SpaceBetween size="m">
          <Checkbox checked={applyPrices} onChange={({ detail }) => setApplyPrices(detail.checked)}>{uiText("analysisTab.set.project.target.sale.price.and.purchase.price.from")}</Checkbox>
          <FormField label={uiText("analysisTab.how.to.apply.renovation.line.items.to.the.budget")}>
            <RadioGroup
              value={applyMode}
              onChange={({ detail }) => setApplyMode(detail.value as 'replace' | 'append')}
              items={[
                { value: 'replace', label: uiText("analysisTab.replace.2"), description: uiText("sentences.delete.existing.budget.items.and.replace.with.category.totals", { value1: (project.budget_planned ? money(project.budget_planned) : '0') }) },
                { value: 'append', label: uiText("analysisTab.append"), description: uiText("analysisTab.keep.existing.budget.lines.and.append.by.category") },
              ]}
            />
          </FormField>
          <HelpText>{uiText("analysisTab.this.converts.a.pre.purchase.estimate.into.the.post")}</HelpText>
        </SpaceBetween>
      </Modal>
    </SpaceBetween>
  );
}
