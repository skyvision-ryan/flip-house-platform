import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Alert from '@cloudscape-design/components/alert';
import Autosuggest from '@cloudscape-design/components/autosuggest';
import Box from '@cloudscape-design/components/box';
import BreadcrumbGroup from '@cloudscape-design/components/breadcrumb-group';
import Button from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import DatePicker from '@cloudscape-design/components/date-picker';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import Textarea from '@cloudscape-design/components/textarea';
import Tiles from '@cloudscape-design/components/tiles';
import Wizard from '@cloudscape-design/components/wizard';
import SourceBadge from '../components/SourceBadge';
import { api, AddressCandidate, LookupResult } from '../api/client';
import { useFlash } from '../lib/flash';
import { dateStr, money, pct, text } from '../lib/format';
import { useMeta } from '../lib/meta';
import ReviewTag from '../components/ReviewTag';
import OwnerTag from '../components/OwnerTag';
import { useRole } from '../lib/role';

type FieldState = { value: string; source: string; confidence: number | null; note: string | null; label: string; field: string };

const GROUPS: { title: string; keys: string[]; cols: number }[] = [
  { title: '基本', keys: ['property_type', 'style', 'year_built', 'sqft', 'beds', 'baths_full', 'baths_half'], cols: 4 },
  { title: '结构与地块', keys: ['stories', 'garage_spaces', 'basement', 'lot_sqft', 'land_use', 'apn'], cols: 3 },
  { title: '市场', keys: ['avm_value', 'list_price', 'annual_tax'], cols: 3 },
];
const LOW_CONFIDENCE = 0.8;

export default function AddProject() {
  const role = useRole();
  const navigate = useNavigate();
  const meta = useMeta();
  const flash = useFlash();
  const [params] = useSearchParams();
  const [step, setStep] = useState(0);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<AddressCandidate[]>([]);
  const [loadingCands, setLoadingCands] = useState(false);
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [fields, setFields] = useState<FieldState[]>([]);
  const [strategy, setStrategy] = useState('flip');
  // 新建一律是线索（阶段由清单派生，后端会重置任何别的取值）。留成常量，提交时照发。
  const stage = 'lead';
  const [substage, setSubstage] = useState<string | null>('new_lead');
  const [heat, setHeat] = useState('warm_lead');
  const [name, setName] = useState('');
  const [deal, setDeal] = useState({ purchase_price: '', target_arv: '', purchase_date: '', construction_start: '', construction_end: '', risks: '', notes: '' });
  const [openAnalyzer, setOpenAnalyzer] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const a = params.get('address');
    if (a) { setQuery(a); doLookup(a); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadCandidates = async (q: string) => {
    if (!q || q.length < 2) { setCandidates([]); return; }
    setLoadingCands(true);
    try { setCandidates(await api.lookupAddress(q)); } finally { setLoadingCands(false); }
  };

  const doLookup = async (label: string) => {
    setLookingUp(true);
    setError(null);
    try {
      const r = await api.lookupProperty(label);
      setLookup(r);
      setQuery(r.address.label);
      setFields(r.fields.map((f) => ({ field: f.field, label: f.label, value: f.value ?? '', source: f.source, confidence: f.confidence ?? null, note: f.note ?? null })));
      setName(r.address.street);
      setDeal((d) => ({ ...d, purchase_price: r.valuation?.list_price ? String(r.valuation.list_price) : '', target_arv: r.valuation?.avm_value ? String(r.valuation.avm_value) : '' }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLookingUp(false);
    }
  };

  const substageOptions = useMemo(() => meta?.substages[stage] ?? [], [meta, stage]);
  const heatOptions = [{ label: '热线索', value: 'hot_lead' }, { label: '温线索', value: 'warm_lead' }];
  const lowConf = fields.filter((f) => f.source !== 'manual' && f.confidence != null && f.confidence < LOW_CONFIDENCE);
  const filled = fields.filter((f) => f.value !== '').length;
  const byKey = Object.fromEntries(fields.map((f, i) => [f.field, { f, i }]));
  const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));

  const submit = async () => {
    if (!lookup) return;
    setSubmitting(true);
    try {
      const p = await api.createProject({
        name: name || lookup.address.street,
        strategy, stage, substage, lead_heat: heat,
        address: lookup.address, apn: lookup.apn,
        fields: fields.map((f) => ({ field: f.field, value: f.value === '' ? null : f.value, source: f.source, confidence: f.confidence, note: f.note })),
        owner: lookup.owner, mortgages: lookup.mortgages, sales_history: lookup.sales_history, valuation: lookup.valuation,
        purchase_price: numOrNull(deal.purchase_price), target_arv: numOrNull(deal.target_arv),
        purchase_date: deal.purchase_date || null, construction_start: deal.construction_start || null, construction_end: deal.construction_end || null,
        risks: deal.risks || null, notes: deal.notes || null,
        create_analysis: true,
      });
      flash({ type: 'success', content: `已创建“${p.name}”，房产数据已补全并标注来源，交易分析已预填。` });
      navigate(`/projects/${p.id}${openAnalyzer ? '?tab=analysis' : ''}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const fieldInput = (key: string) => {
    const hit = byKey[key];
    if (!hit) return null;
    const { f, i } = hit;
    const low = f.source !== 'manual' && f.confidence != null && f.confidence < LOW_CONFIDENCE;
    return (
      <FormField
        key={f.field}
        label={<span>{f.label} <SourceBadge source={f.source} confidence={f.confidence} note={f.note} /></span>}
        warningText={low ? '把握度低，建议核对' : undefined}
      >
        <Input value={f.value} onChange={({ detail }) => setFields((prev) => prev.map((x, j) => (j === i ? { ...x, value: detail.value, source: 'manual', confidence: 1, note: '新建时人工修改' } : x)))} />
      </FormField>
    );
  };

  if (!role.can('create_project')) {
    return <ContentLayout header={<Header variant="h1">新建项目</Header>}><Alert type="warning" header="你的身份不能新建项目">新建项目由 J（Jessie）或统筹、决策级别的人做。你现在是 {role.actor}（{role.tierLabel}）。</Alert></ContentLayout>;
  }
  return (
    <ContentLayout
      breadcrumbs={<BreadcrumbGroup items={[{ text: '工作台', href: '/' }, { text: '新建项目', href: '/projects/new' }]} onFollow={(e) => { e.preventDefault(); navigate(e.detail.href); }} />}
      header={<Header variant="h1" description="输入地址，系统自动补全房产数据并标注来源；你只需要确认、改动、定策略。">开始一套新房子</Header>}
    >
      <Wizard
        activeStepIndex={step}
        isLoadingNextStep={submitting || lookingUp}
        onNavigate={({ detail }) => {
          if (detail.requestedStepIndex > 0 && !lookup) { setError('请先选择一个地址并等待数据补全。'); return; }
          setError(null);
          setStep(detail.requestedStepIndex);
        }}
        onCancel={() => navigate('/')}
        onSubmit={submit}
        i18nStrings={{
          stepNumberLabel: (n) => `步骤 ${n}`,
          collapsedStepsLabel: (n, t) => `步骤 ${n} / ${t}`,
          skipToButtonLabel: (s) => `跳到 ${s.title}`,
          navigationAriaLabel: '步骤',
          cancelButton: '取消',
          previousButton: '上一步',
          nextButton: '下一步',
          submitButton: '创建项目',
          optional: '可选',
        }}
        steps={[
          {
            title: '输入地址',
            description: '当前为模拟数据源，接口形状与真实源一致。',
            content: (
              <Container header={<Header variant="h2"><ReviewTag id="A" /><OwnerTag block="wizard" />地址</Header>}>
                <SpaceBetween size="m">
                  <FormField label="房产地址" description="输入门牌号和街道，从候选中选择。试试：Fisk、Parkville、Alvarado。">
                    <Autosuggest
                      value={query}
                      placeholder="例如 4928 NW Fisk Ave"
                      options={candidates.map((c) => ({ value: c.label, label: c.label, description: `${c.city}, ${c.state} ${c.zip}` }))}
                      filteringType="manual"
                      statusType={loadingCands ? 'loading' : 'finished'}
                      loadingText="查找中"
                      empty="没有找到地址"
                      enteredTextLabel={(v) => `使用“${v}”`}
                      onChange={({ detail }) => { setQuery(detail.value); setLookup(null); }}
                      onLoadItems={({ detail }) => loadCandidates(detail.filteringText)}
                      onSelect={({ detail }) => { const v = detail.selectedOption?.value ?? detail.value; setQuery(v); doLookup(v); }}
                    />
                  </FormField>
                  {error && <Alert type="error">{error}</Alert>}
                  {lookingUp && <Alert type="info">正在补全房产数据…</Alert>}
                  {lookup?.duplicate_of && (
                    <Alert type="warning" header="这套房子已经在系统里" action={<Button onClick={() => navigate(`/projects/${lookup.duplicate_of!.project_id}`)}>打开“{lookup.duplicate_of.project_name}”</Button>}>
                      地块号或标准地址与已有项目相同。你可以打开已有项目，也可以继续为同一套房子新建一个项目（例如二次翻新）。
                    </Alert>
                  )}
                  {lookup && (
                    <KeyValuePairs
                      columns={4}
                      items={[
                        { label: '标准地址', value: lookup.address.label },
                        { label: '地块号（APN）', value: text(lookup.apn) },
                        { label: '模型估值', value: money(lookup.valuation?.avm_value) },
                        { label: '挂牌价', value: money(lookup.valuation?.list_price) },
                      ]}
                    />
                  )}
                </SpaceBetween>
              </Container>
            ),
          },
          {
            title: '确认房产数据',
            content: (
              <SpaceBetween size="l">
                <Alert type={lowConf.length ? 'warning' : 'success'} header={<><ReviewTag id="B" />补全情况</>}>
                  已补全 {filled} 项。{lowConf.length ? `其中 ${lowConf.length} 项把握度低（${lowConf.map((f) => f.label).join('、')}），建议核对。` : '来源均为公共记录或模型估值，把握度正常。'}
                  改动任何字段后，该字段来源变为“人工”，原值仍保留在来源记录里。
                </Alert>
                {GROUPS.map((g, gi) => (
                  <Container key={g.title} header={<Header variant="h2"><ReviewTag id={['C', 'D', 'E'][gi]} />{g.title}</Header>}>
                    <ColumnLayout columns={g.cols} minColumnWidth={180}>
                      {g.keys.map(fieldInput)}
                    </ColumnLayout>
                  </Container>
                ))}
                <ExpandableSection variant="container" header={<Header variant="h3"><ReviewTag id="F" />业主、按揭与成交史（自动带入，仅供参考）</Header>}>
                  <SpaceBetween size="l">
                    {lookup?.owner ? (
                      <KeyValuePairs columns={3} items={[
                        { label: '业主', value: text(lookup.owner.name) },
                        { label: '邮寄地址', value: text(lookup.owner.mailing_address) },
                        { label: '持有自', value: dateStr(lookup.owner.owner_since) },
                      ]} />
                    ) : <Box color="text-body-secondary">无业主信息</Box>}
                    <Table variant="embedded" header={<Header variant="h3" counter={`(${lookup?.mortgages.length ?? 0})`}>按揭</Header>} items={lookup?.mortgages ?? []} empty={<Box textAlign="center" color="inherit">无按揭记录</Box>} columnDefinitions={[
                      { id: 'd', header: '登记日期', cell: (m) => dateStr(m.recording_date) },
                      { id: 'l', header: '贷方', cell: (m) => text(m.lender) },
                      { id: 'o', header: '原始金额', cell: (m) => money(m.original_balance) },
                      { id: 'e', header: '估算余额', cell: (m) => money(m.est_balance) },
                      { id: 'r', header: '利率', cell: (m) => pct(m.rate, 2) },
                    ]} />
                    <Table variant="embedded" header={<Header variant="h3" counter={`(${lookup?.sales_history.length ?? 0})`}>成交史</Header>} items={lookup?.sales_history ?? []} empty={<Box textAlign="center" color="inherit">无成交记录</Box>} columnDefinitions={[
                      { id: 'd', header: '登记日期', cell: (s) => dateStr(s.recording_date) },
                      { id: 's', header: '卖方', cell: (s) => text(s.seller) },
                      { id: 'b', header: '买方', cell: (s) => text(s.buyer) },
                      { id: 'a', header: '金额', cell: (s) => money(s.amount) },
                    ]} />
                  </SpaceBetween>
                </ExpandableSection>
              </SpaceBetween>
            ),
          },
          {
            title: '项目设置',
            content: (
              <SpaceBetween size="l">
                <Container header={<Header variant="h2"><ReviewTag id="G" /><OwnerTag block="wizard" />策略与阶段</Header>}>
                  <SpaceBetween size="l">
                    <FormField label="项目名称">
                      <Input value={name} onChange={({ detail }) => setName(detail.value)} />
                    </FormField>
                    <FormField label="投资策略">
                      <Tiles
                        value={strategy}
                        onChange={({ detail }) => setStrategy(detail.value)}
                        items={[
                          { value: 'flip', label: '翻新转卖', description: '买入、翻新、挂牌卖出' },
                          { value: 'new_build', label: '新建', description: '拆除或空地新建' },
                          { value: 'rental', label: '持有出租', description: '翻新后持有收租' },
                        ]}
                      />
                    </FormField>
                    {/* KAN-50：原来这里有一个「阶段」下拉，但它是死的——实测选「在建」建出来仍然是
                        线索，连子阶段也被重置成「新线索」。原因是阶段由六阶段清单派生
                        （`steps.py:206-212` 的 sync_legacy_stage 每次读项目都会重算），
                        新项目没有任何 gate 确认，必然停在 ① 预买房。摆一个选了不算数的控件是骗人。
                        新建一律落成线索，要推进得去项目里确认 Open escrow。 */}
                    <ColumnLayout columns={2}>
                      <FormField label="跟进档位" description="新房子先进「线索」，确认 Open escrow 之后才进入买房流程。">
                        <Select selectedOption={substageOptions.find((s) => s.value === substage) ?? null} options={substageOptions} onChange={({ detail }) => setSubstage(detail.selectedOption.value ?? null)} />
                      </FormField>
                      <FormField label="线索热度">
                        <Select selectedOption={heatOptions.find((h) => h.value === heat) ?? null} options={heatOptions} onChange={({ detail }) => setHeat(detail.selectedOption.value!)} />
                      </FormField>
                    </ColumnLayout>
                  </SpaceBetween>
                </Container>

                <Container header={<Header variant="h2" description="线索阶段可以先空着，之后在分析器里算。"><ReviewTag id="H" />交易与日期</Header>}>
                  <SpaceBetween size="l">
                    <ColumnLayout columns={2}>
                      <FormField label={<span>买入价 / 意向价（美元） {lookup?.valuation?.list_price && deal.purchase_price === String(lookup.valuation.list_price) && <SourceBadge source="public_record" note="预填为当前挂牌价" confidence={0.9} />}</span>}>
                        <Input type="number" value={deal.purchase_price} onChange={({ detail }) => setDeal((d) => ({ ...d, purchase_price: detail.value }))} />
                      </FormField>
                      <FormField label={<span>目标售价 ARV（美元） {lookup?.valuation?.avm_value && deal.target_arv === String(lookup.valuation.avm_value) && <SourceBadge source="model" note="预填为模型估值，建议核对可比房" confidence={0.75} />}</span>}>
                        <Input type="number" value={deal.target_arv} onChange={({ detail }) => setDeal((d) => ({ ...d, target_arv: detail.value }))} />
                      </FormField>
                    </ColumnLayout>
                    <ColumnLayout columns={3}>
                      <FormField label="买入日期"><DatePicker value={deal.purchase_date} placeholder="YYYY/MM/DD" onChange={({ detail }) => setDeal((d) => ({ ...d, purchase_date: detail.value }))} /></FormField>
                      <FormField label="计划开工"><DatePicker value={deal.construction_start} placeholder="YYYY/MM/DD" onChange={({ detail }) => setDeal((d) => ({ ...d, construction_start: detail.value }))} /></FormField>
                      <FormField label="计划完工"><DatePicker value={deal.construction_end} placeholder="YYYY/MM/DD" onChange={({ detail }) => setDeal((d) => ({ ...d, construction_end: detail.value }))} /></FormField>
                    </ColumnLayout>
                    <FormField label="已知风险" stretch><Textarea rows={2} value={deal.risks} placeholder="例如：地基状况一般，需专业检验后再定最终出价。" onChange={({ detail }) => setDeal((d) => ({ ...d, risks: detail.value }))} /></FormField>
                    <FormField label="备注" stretch><Textarea rows={2} value={deal.notes} placeholder="线索来源、业主情况、定位思路。" onChange={({ detail }) => setDeal((d) => ({ ...d, notes: detail.value }))} /></FormField>
                    <Checkbox checked={openAnalyzer} onChange={({ detail }) => setOpenAnalyzer(detail.checked)}>创建后直接打开交易分析（已按已知数据预填）</Checkbox>
                  </SpaceBetween>
                </Container>
                {error && <Alert type="error">{error}</Alert>}
              </SpaceBetween>
            ),
          },
        ]}
      />
    </ContentLayout>
  );
}
