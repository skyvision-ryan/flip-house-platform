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
import { useFlash } from '../../lib/flash';
import { money, pct } from '../../lib/format';
import { useMeta } from '../../lib/meta';

const num = (v: unknown) => { const x = typeof v === 'string' ? parseFloat(v) : (v as number); return Number.isFinite(x) ? x : 0; };
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

function Metric({ label, value, sub, help, tone }: { label: string; value: string; sub?: string; help?: string; tone?: 'good' | 'bad' }) {
  return <StatTile label={label} value={value} sub={sub} help={help} tone={tone} size="m" />;
}

function RowsEditor({ rows, onChange, sources, prefix, addLabel }: { rows: Row[]; onChange: (r: Row[]) => void; sources?: Record<string, any>; prefix?: string; addLabel: string }) {
  return (
    <SpaceBetween size="xs">
      {rows.map((r, i) => (
        <Grid key={i} gridDefinition={[{ colspan: 6 }, { colspan: 4 }, { colspan: 2 }]}>
          <Input value={r.label} placeholder="名目" onChange={({ detail }) => onChange(rows.map((x, j) => (j === i ? { ...x, label: detail.value } : x)))} />
          <SpaceBetween direction="horizontal" size="xxs" alignItems="center">
            <Input type="number" value={str(r.amount)} onChange={({ detail }) => onChange(rows.map((x, j) => (j === i ? { ...x, amount: detail.value } : x)))} />
            {sources && prefix && sources[`${prefix}.${r.label}`] && <SourceBadge {...sources[`${prefix}.${r.label}`]} fetchedAt={sources[`${prefix}.${r.label}`].fetched_at} />}
          </SpaceBetween>
          <Button variant="icon" iconName="close" ariaLabel="删除" onClick={() => onChange(rows.filter((_, j) => j !== i))} />
        </Grid>
      ))}
      <Button iconName="add-plus" variant="inline-link" onClick={() => onChange([...rows, { label: '', amount: '' }])}>{addLabel}</Button>
    </SpaceBetween>
  );
}

export default function AnalysisTab({ project, reload }: { project: Project; reload: () => Promise<any> }) {
  const meta = useMeta();
  const flash = useFlash();
  const [list, setList] = useState<Analysis[] | null>(null);
  const [aid, setAid] = useState<number | null>(null);
  const [inputs, setInputs] = useState<AnalysisInputs | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyMode, setApplyMode] = useState<'replace' | 'append'>('replace');
  const [applyPrices, setApplyPrices] = useState(true);
  const [applying, setApplying] = useState(false);
  const [saving, setSaving] = useState(false);
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);

  const load = useCallback(async (selectId?: number) => {
    const rows = await api.analyses(project.id);
    setList(rows);
    const pick = rows.find((a) => a.id === selectId) ?? rows.find((a) => a.is_current) ?? rows[0] ?? null;
    setAid(pick?.id ?? null);
    setInputs(pick ? pick.inputs : null);
    dirty.current = false;
  }, [project.id]);
  useEffect(() => { load(); }, [load]);

  const out = useMemo(() => (inputs ? fullOutputs(inputs) : null), [inputs]);
  const sources = inputs?.sources ?? {};

  const update = (patch: Partial<AnalysisInputs>) => {
    setInputs((prev) => (prev ? { ...prev, ...patch } : prev));
    dirty.current = true;
  };

  // 停顿 700ms 后保存到后端
  useEffect(() => {
    if (!inputs || !aid || !dirty.current) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      setSaving(true);
      try { const saved = await api.patchAnalysis(aid, { inputs }); setList((l) => l?.map((a) => (a.id === saved.id ? saved : a)) ?? null); dirty.current = false; }
      finally { setSaving(false); }
    }, 700);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [inputs, aid]);

  const create = async (tier: string) => {
    const a = await api.createAnalysis(project.id, { tier, name: `${{ light: '轻装', medium: '中装', heavy: '重装' }[tier]}方案 ${(list?.length ?? 0) + 1}` });
    await load(a.id);
    await reload();
    flash({ type: 'success', content: `已新建“${a.name}”，数据已按已知信息与行业默认值预填` });
  };

  const remove = async () => {
    if (!aid) return;
    await api.deleteAnalysis(aid);
    await load();
    await reload();
    flash({ type: 'success', content: '已删除该版本' });
  };

  const apply = async () => {
    if (!aid) return;
    setApplying(true);
    try {
      await api.applyAnalysis(aid, { mode: applyMode, apply_prices: applyPrices });
      await reload();
      setApplyOpen(false);
      flash({ type: 'success', content: `已应用到项目：${applyPrices ? '目标售价与买入价已更新，' : ''}装修明细已${applyMode === 'replace' ? '替换为' : '追加到'}预算项` });
    } finally { setApplying(false); }
  };

  if (list === null) return <Box padding="l" textAlign="center"><Spinner /></Box>;

  if (!inputs || !out || !aid) {
    return (
      <Container cardId="analysis-empty" header={<Header variant="h2">交易分析</Header>}>
        <SpaceBetween size="m">
          <Box>还没有算过账。系统会用已知数据（估值、挂牌价、房产税、面积）和行业默认值预填一份，你只需要改动你更清楚的数字。</Box>
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="primary" onClick={() => create('medium')}>按中装预填一份</Button>
            <Button onClick={() => create('light')}>轻装</Button>
            <Button onClick={() => create('heavy')}>重装</Button>
          </SpaceBetween>
        </SpaceBetween>
      </Container>
    );
  }

  const current = list.find((a) => a.id === aid)!;
  const fin = inputs.financing ?? { enabled: true, down_pct: 20, rate_pct: 7, years: 30 };
  const profitable = out.total_profit > 0;
  const priceOk = num(inputs.purchase_price) <= out.mao;
  const catOptions = meta?.budget_categories.map((c) => ({ label: c, value: c })) ?? [];
  const costSegments = [
    { label: '买入', value: out.purchase_total },
    { label: '持有', value: out.holding_total },
    { label: '装修', value: out.rehab_total },
    { label: '卖出', value: out.selling_total },
  ];

  return (
    <SpaceBetween size="l">
      <Container cardId="analysis-inputs"
        header={
          <Header
            variant="h2"
            description={inputs.note || undefined}
            help="修改数字后自动重算。预填字段保留来源，采用前请核实。"
            actions={
              <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                {saving ? <StatusIndicator type="loading">保存中</StatusIndicator> : <StatusIndicator type="success">已保存</StatusIndicator>}
                <Select
                  selectedOption={{ label: current.name + (current.is_current ? '（当前）' : ''), value: String(current.id) }}
                  options={list.map((a) => ({ label: a.name + (a.is_current ? '（当前）' : ''), value: String(a.id) }))}
                  onChange={({ detail }) => load(Number(detail.selectedOption.value))}
                />
                <ButtonDropdown
                  items={[
                    { id: 'light', text: '新建版本：轻装' }, { id: 'medium', text: '新建版本：中装' }, { id: 'heavy', text: '新建版本：重装' },
                    { id: 'current', text: '设为当前版本', disabled: current.is_current },
                    { id: 'delete', text: '删除此版本', disabled: list.length <= 1 },
                  ]}
                  onItemClick={async ({ detail }) => {
                    if (['light', 'medium', 'heavy'].includes(detail.id)) create(detail.id);
                    else if (detail.id === 'current') { await api.patchAnalysis(aid, { is_current: true }); await load(aid); }
                    else if (detail.id === 'delete') remove();
                  }}
                >版本</ButtonDropdown>
                <Button variant="primary" onClick={() => setApplyOpen(true)}>应用到项目</Button>
              </SpaceBetween>
            }
          >
            交易分析
          </Header>
        }
      >
        <Box margin={{ bottom: 's' }}><Box variant="h3" display="inline">核心指标</Box></Box>
        <ColumnLayout columns={4} minColumnWidth={160} variant="text-grid">
          <Metric label="总利润" value={money(out.total_profit)} sub={profitable ? undefined : '亏损：成本高于售价'} help="售价减全部成本" tone={profitable ? 'good' : 'bad'} />
          <Metric label="利润率" value={pct(out.profit_margin_pct)} help="利润 ÷ 总成本" />
          <Metric label="回报率" value={pct(out.roi_pct)} help="利润 ÷ 现金投入" />
          <Metric label="权益倍数" value={out.equity_multiple == null ? '—' : `${out.equity_multiple.toFixed(2)}×`} help="卖出还清贷款后拿回的现金 ÷ 现金投入" />
          <Metric label="总成本" value={money(out.total_costs)} help="买入 + 持有 + 装修 + 卖出" />
          <Metric label="现金投入" value={money(out.cash_invested)} sub={fin.enabled ? `首付 ${money(out.down_payment)} + 杂费 + 装修 + 持有 + 已还本金 ${money(out.principal_paid)}` : '全款：买入 + 杂费 + 装修 + 持有'} />
          <Metric label="售价" value={money(out.sale_price)} help="修好后能卖多少" />
          <Metric label="装修合计" value={money(out.rehab_total)} sub={`${inputs.rehab_items.length} 行明细`} />
        </ColumnLayout>
      </Container>

      <Grid gridDefinition={[{ colspan: { default: 12, m: 5 } }, { colspan: { default: 12, m: 7 } }]}>
        <SpaceBetween size="m">
          <ExpandableSection cardId="analysis-purchase" variant="container" header={<Header variant="h3" counter={money(out.purchase_total)}>买入成本</Header>} defaultExpanded>
            <SpaceBetween size="m">
              <FormField label={<span>买入价 {sources.purchase_price && <SourceBadge source={sources.purchase_price.source} fetchedAt={sources.purchase_price.fetched_at} confidence={sources.purchase_price.confidence} note={sources.purchase_price.note} />}</span>}>
                <Input type="number" value={str(inputs.purchase_price)} onChange={({ detail }) => update({ purchase_price: detail.value })} />
              </FormField>
              <FormField label={<span>附加费用 {sources.purchase_extras && <SourceBadge source={sources.purchase_extras.source} note={sources.purchase_extras.note} />}</span>} description="检验、评估、律师、过户等">
                <RowsEditor rows={inputs.purchase_extras} onChange={(r) => update({ purchase_extras: r })} addLabel="加一项" />
              </FormField>
            </SpaceBetween>
          </ExpandableSection>

          <ExpandableSection cardId="analysis-holding" variant="container" header={<Header variant="h3" counter={money(out.holding_total)}>持有成本</Header>}>
            <SpaceBetween size="m">
              <FormField label={<span>持有月数 {sources.holding_months && <SourceBadge source={sources.holding_months.source} note={sources.holding_months.note} />}</span>}>
                <Input type="number" value={str(inputs.holding_months)} onChange={({ detail }) => update({ holding_months: detail.value })} />
              </FormField>
              <FormField label="每月开销" description="税、保险、水电、物业费等">
                <RowsEditor rows={inputs.monthly_costs} onChange={(r) => update({ monthly_costs: r })} sources={sources} prefix="monthly_costs" addLabel="加一项" />
              </FormField>
              <Toggle checked={fin.enabled} onChange={({ detail }) => update({ financing: { ...fin, enabled: detail.checked } })}>
                用贷款买（月供自动计入持有成本）
              </Toggle>
              {fin.enabled && (
                <ColumnLayout columns={3}>
                  <FormField label="首付 %"><Input type="number" value={str(fin.down_pct)} onChange={({ detail }) => update({ financing: { ...fin, down_pct: num(detail.value) } })} /></FormField>
                  <FormField label="年利率 %"><Input type="number" value={str(fin.rate_pct)} onChange={({ detail }) => update({ financing: { ...fin, rate_pct: num(detail.value) } })} /></FormField>
                  <FormField label="年限"><Input type="number" value={str(fin.years)} onChange={({ detail }) => update({ financing: { ...fin, years: num(detail.value) } })} /></FormField>
                </ColumnLayout>
              )}
              {fin.enabled && (
                <Box variant="small" color="text-body-secondary">
                  贷款 {money(out.loan_amount)}，首付 {money(out.down_payment)}，月供 {money(out.monthly_payment)}。持有期内利息 {money(out.interest_total)} 计入成本，本金 {money(out.principal_paid)} 不计成本（卖出时从贷款余额 {money(out.loan_balance_at_sale)} 里省回来）。{sources.financing?.note}
                </Box>
              )}
            </SpaceBetween>
          </ExpandableSection>

          <ExpandableSection cardId="analysis-rehab" variant="container" header={<Header variant="h3" counter={money(out.rehab_total)}>装修明细</Header>}>
            <SpaceBetween size="s">
              {sources.rehab_items && <Alert type="info">{sources.rehab_items.note}</Alert>}
              {inputs.rehab_items.map((r: RehabRow, i: number) => (
                <Grid key={i} gridDefinition={[{ colspan: 5 }, { colspan: 5 }, { colspan: 2 }]}>
                  <Select
                    selectedOption={catOptions.find((o) => o.value === r.category) ?? { label: r.category, value: r.category }}
                    options={catOptions}
                    onChange={({ detail }) => update({ rehab_items: inputs.rehab_items.map((x, j) => (j === i ? { ...x, category: detail.selectedOption.value!, label: detail.selectedOption.value! } : x)) })}
                  />
                  <Input type="number" value={str(r.amount)} onChange={({ detail }) => update({ rehab_items: inputs.rehab_items.map((x, j) => (j === i ? { ...x, amount: detail.value } : x)) })} />
                  <Button variant="icon" iconName="close" ariaLabel="删除" onClick={() => update({ rehab_items: inputs.rehab_items.filter((_, j) => j !== i) })} />
                </Grid>
              ))}
              <Button iconName="add-plus" variant="inline-link" onClick={() => update({ rehab_items: [...inputs.rehab_items, { category: '其他', label: '其他', amount: '' }] })}>加一行</Button>
            </SpaceBetween>
          </ExpandableSection>

          <ExpandableSection cardId="analysis-selling" variant="container" header={<Header variant="h3" counter={money(out.selling_total)}>卖出成本</Header>}>
            <SpaceBetween size="m">
              <FormField label={<span>卖出比例 %（佣金 + 卖方过户） {sources.selling_pct && <SourceBadge source={sources.selling_pct.source} note={sources.selling_pct.note} />}</span>}>
                <Input type="number" value={str(inputs.selling_pct)} onChange={({ detail }) => update({ selling_pct: detail.value })} />
              </FormField>
              <FormField label="其他卖出费用">
                <RowsEditor rows={inputs.selling_extras} onChange={(r) => update({ selling_extras: r })} addLabel="加一项" />
              </FormField>
            </SpaceBetween>
          </ExpandableSection>
        </SpaceBetween>

        <SpaceBetween size="m">
          <Container cardId="analysis-price" header={<Header variant="h2" help="修好后能卖多少。来自估值或你定的目标售价。">售价</Header>}>
            <FormField label={<span>售价 {sources.sale_price && <SourceBadge source={sources.sale_price.source} fetchedAt={sources.sale_price.fetched_at} confidence={sources.sale_price.confidence} note={sources.sale_price.note} />}</span>}>
              <Input type="number" value={str(inputs.sale_price)} onChange={({ detail }) => update({ sale_price: detail.value })} />
            </FormField>
          </Container>

          <Container cardId="analysis-offer" header={<Header variant="h2" help="拖目标利润率（利润 ÷ 总成本），算出最多能出多少钱。">最高出价</Header>}>
            <SpaceBetween size="m">
              <FormField label={`目标利润率 ${num(inputs.target_margin_pct)}%`}>
                <Slider value={num(inputs.target_margin_pct)} min={0} max={60} step={1} onChange={({ detail }) => update({ target_margin_pct: detail.value })} valueFormatter={(v) => `${v}%`} />
              </FormField>
              <ColumnLayout columns={2} variant="text-grid">
                <StatTile label="最高可出价" value={money(out.mao)} sub={priceOk ? `当前买入价低于上限 ${money(out.mao - num(inputs.purchase_price))}` : `当前买入价高出上限 ${money(num(inputs.purchase_price) - out.mao)}`} tone={priceOk ? 'good' : 'bad'} />
                <StatTile label="70% 法则参考" value={money(out.mao_rule70)} help="售价 × 70% − 装修" />
              </ColumnLayout>
              <BulletList
                rows={[{ key: 'price', label: '当前买入价', actual: num(inputs.purchase_price), target: out.mao }]}
                format={compactMoney}
                reading={(r) => `${compactMoney(r.actual)} vs 上限 ${compactMoney(r.target)}`}
                extraMarkers={[{ key: 'r70', at: () => out.mao_rule70, label: '70% 法则' }]}
                targetLabel="上限"
                labelWidth={90}
              />
              <HelpText>灰底是目标利润率下的最高出价，条是当前买入价，超出上限的那段画红；细刻度是 70% 法则参考。</HelpText>
            </SpaceBetween>
          </Container>

          <Container cardId="analysis-costs" header={<Header variant="h2" help="一根条看成本构成，竖线是售价：条比线短就有利润。">成本结构</Header>}>
            <StackedBar segments={costSegments} format={compactMoney} marker={{ value: out.sale_price, label: '售价' }} legendColumns={2} />
          </Container>
        </SpaceBetween>
      </Grid>

      <Modal
        visible={applyOpen}
        onDismiss={() => setApplyOpen(false)}
        header="应用到项目"
        footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button variant="link" onClick={() => setApplyOpen(false)}>取消</Button><Button variant="primary" loading={applying} onClick={apply}>应用</Button></SpaceBetween></Box>}
      >
        <SpaceBetween size="m">
          <Checkbox checked={applyPrices} onChange={({ detail }) => setApplyPrices(detail.checked)}>把售价写为项目目标售价，买入价写为项目买入价</Checkbox>
          <FormField label="装修明细如何进入预算项">
            <RadioGroup
              value={applyMode}
              onChange={({ detail }) => setApplyMode(detail.value as 'replace' | 'append')}
              items={[
                { value: 'replace', label: '替换', description: `删掉现有 ${project.budget_planned ? money(project.budget_planned) : '0'} 预算项，按类别汇总写入` },
                { value: 'append', label: '追加', description: '保留现有预算项，按类别追加' },
              ]}
            />
          </FormField>
          <HelpText>这一步把“买前估算”变成“买后预算”，以后实际支出对着它记，就能看出估算准不准。</HelpText>
        </SpaceBetween>
      </Modal>
    </SpaceBetween>
  );
}
