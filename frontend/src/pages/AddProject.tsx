import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
import Alert from '@cloudscape-design/components/alert';
import Autosuggest from '@cloudscape-design/components/autosuggest';
import Box from '@cloudscape-design/components/box';
import BreadcrumbGroup from '@cloudscape-design/components/breadcrumb-group';
import Button from '@cloudscape-design/components/button';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import ContentLayout from '@cloudscape-design/components/content-layout';
import DatePicker from '@cloudscape-design/components/date-picker';
import Icon from '@cloudscape-design/components/icon';
import Input from '@cloudscape-design/components/input';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';
import Tiles from '@cloudscape-design/components/tiles';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AddressCandidate, api, LookupResult, UserBrief } from '../api/client';
import css from '../components/ui/CollaborationLayout.module.css';
import HelpText from '../components/HelpText';
import ProjectPreplan, { PlanReview, PlanSummary } from '../components/ProjectPreplan';
import SourceBadge from '../components/SourceBadge';
import ExpandableSection from '../components/ui/ExpandableSection';
import KeyValuePairs from '../components/ui/Facts';
import FormField from '../components/ui/FormField';
import Header from '../components/ui/Header';
import Container from '../components/ui/Surface';
import Table from '../components/ui/Table';
import { useActor } from '../lib/actor';
import { EMPTY_MANUAL, ManualAddress, shouldClearAmounts, toCandidate, validateManualAddress } from '../lib/address';
import { useFlash } from '../lib/flash';
import { dateStr, money, pct, text } from '../lib/format';
import { useMeta } from '../lib/meta';
import { planPayload, summarizePlan, TaskPlan } from '../lib/projectPlan';
import { userCan, useRole } from '../lib/role';
import { isProvisionalSource, sourceLabel } from '../lib/sources';
import { summarizeSources, summaryText } from '../lib/sourceSummary';

type FieldState = { value: string; source: string; confidence: number | null; note: string | null; label: string; field: string };

const GROUPS: { title: string; keys: string[]; cols: number }[] = [
  { get title() { return uiText("addProject.basic"); }, keys: ['property_type', 'style', 'year_built', 'sqft', 'beds', 'baths_full', 'baths_half'], cols: 4 },
  { get title() { return uiText("addProject.building.and.parcel"); }, keys: ['stories', 'garage_spaces', 'basement', 'lot_sqft', 'land_use', 'apn'], cols: 3 },
  { get title() { return uiText("addProject.market"); }, keys: ['avm_value', 'list_price', 'annual_tax'], cols: 3 },
];

export default function AddProject() {
  useLanguage();
  const role = useRole();
  const { me } = useActor();
  const [plan, setPlan] = useState<TaskPlan>({});
  const [users, setUsers] = useState<UserBrief[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const requestKey = useRef(crypto.randomUUID());
  const busy = useRef(false);
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
  // KAN-71 手动路径：「有没有地址」和「查没查到」是两件事。查不到（或不想查）也能建房，
  // 地址由用户四段填，字段全空、来源人工、地块号待核实。
  const [manualAddr, setManualAddr] = useState<AddressCandidate | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualForm, setManualForm] = useState<ManualAddress>(EMPTY_MANUAL);
  const [fields, setFields] = useState<FieldState[]>([]);
  const [strategy, setStrategy] = useState('flip');
  const [initialStage, setInitialStage] = useState('s1');
  const [name, setName] = useState('');
  const [deal, setDeal] = useState({ purchase_price: '', target_arv: '', purchase_date: '', construction_start: '', construction_end: '', risks: '', notes: '' });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const address = lookup?.address ?? manualAddr;
  const loadUsers = () => {
    setLoadingUsers(true); setUsersError(null);
    api.creationMembers().then(setUsers).catch((e) => setUsersError(e.message)).finally(() => setLoadingUsers(false));
  };
  useEffect(() => { if (me && userCan(meta, me, 'assign_tasks')) loadUsers(); }, [me?.id, meta]);
  const planSummary = summarizePlan(meta?.stage_checklist ?? [], plan, initialStage);
  const joining = planSummary.people.filter((id) => id !== me?.id);
  const updatePlan = (value: TaskPlan) => { setPlan(value);  };


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

  /** 地址变了就把上一套房子的东西全清掉——A 查到、改成 B 失败、再手动建 B，不能残留 A 的字段。
   *  两个金额**不在这里清**：这里每敲一个字都会触发，普通的文字修正不该丢掉已填的数。 */
  const clearHouse = () => { setLookup(null); setManualAddr(null); setFields([]); };
  // 上一次真正选定的房子（查到的或手动的）。敲字不清它，只有再次选定时才比较——用来判断是不是换了房子。
  const lastHouse = useRef<string | null>(null);
  /** 确认切换到另一套房：把上一套房的买入价／目标售价清掉并明确提示（Ryan 09-22）。同一套房重选不动。 */
  const settleHouse = (label: string) => {
    if (lastHouse.current && lastHouse.current !== label && Object.keys(plan).length) {
      setPlan({});
      flash({ type: 'info', content: uiText("addProject.property.changed.previous.task.assignments.have.been.cleared.assign") });
    }
    if (shouldClearAmounts(lastHouse.current, label, deal)) {
      setDeal((d) => ({ ...d, purchase_price: '', target_arv: '' }));
      flash({ type: 'info', content: uiText("sentences.switched.to.another.property.previous.purchase.and.target.sale.prices", { value1: (label) }) });
    }
    lastHouse.current = label;
  };

  const doLookup = async (label: string) => {
    setLookingUp(true);
    setError(null);
    clearHouse();
    try {
      const r = await api.lookupProperty(label);
      setLookup(r.fields.length ? r : null);
      if (!r.fields.length) setManualAddr(r.address);
      setQuery(r.address.label);
      setFields((r.fields.length ? r.fields : (meta?.property_fields ?? []).map((f) => ({ field: f.key, label: f.label, value: '', source: 'manual', confidence: null, note: null }))).map((f) => ({ field: f.field, label: f.label, value: f.value ?? '', source: f.source, confidence: f.confidence ?? null, note: f.note ?? null })));
      setName(r.address.street);
      settleHouse(r.address.label);
      // KAN-71：不再把挂牌价/估值预填成买入价/目标售价。两个金额框默认空，参考值并排放在旁边，点「采用」才填。
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLookingUp(false);
    }
  };

  const startManual = () => {
    const missing = validateManualAddress(manualForm);
    if (missing.length) { setError(uiText("addProject.manual.entry.requires.at.least.a.street.address")); return; }
    setError(null);
    clearHouse();
    const cand = toCandidate(manualForm);
    setManualAddr(cand);
    setQuery(cand.label);
    setName(cand.street);
    settleHouse(cand.label);
    // 房产资料使用同一套字段：从 meta.property_fields 生成，全空、来源人工、不给把握度
    setFields((meta?.property_fields ?? []).map((f) => ({ field: f.key, label: f.label, value: '', source: 'manual', confidence: null, note: null })));
  };

  const stageOptions = (meta?.stage_checklist ?? []).map((s) => ({ value: s.key, label: s.key === 's1' ? uiText("projectPreplan.acquisition.not.purchased") : s.key === 's2' ? uiText("projectPreplan.acquisition.in.escrow") : s.key === 's6' ? uiText("addProject.sold.closeout") : s.key === 's5' ? uiText("addProject.listed.for.sale") : s.short }));
  const summary = summarizeSources(fields);
  const labelOfSource = (s: string) => sourceLabel(s, meta?.sources);
  const byKey = Object.fromEntries(fields.map((f, i) => [f.field, { f, i }]));
  const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));

  const submit = async () => {
    if (!address || !meta || busy.current) return;
    busy.current = true;
    setSubmitting(true); setError(null);
    try {
      const p = await api.createProject({
        request_key: requestKey.current,
        task_plan: planPayload(meta.stage_checklist, plan),
        name: name || address.street,
        strategy, initial_stage_key: initialStage,
        address,
        // 查到的 APN 跟查询结果走；手动路径的 APN 就是用户在房产资料中填的那格（来源人工），没填就空
        apn: byKey.apn?.f.source === 'manual' ? byKey.apn.f.value || null : null,
        // 空值不发：别往库里灌一堆 value 为空的来源行
        fields: fields.filter((f) => f.value !== '' && f.source === 'manual').map((f) => ({ field: f.field, value: f.value, source: f.source, confidence: f.confidence, note: f.note })),
        owner: null, mortgages: [], sales_history: [], valuation: null,
        purchase_price: numOrNull(deal.purchase_price), target_arv: numOrNull(deal.target_arv),
        purchase_date: deal.purchase_date || null, construction_start: deal.construction_start || null, construction_end: deal.construction_end || null,
        risks: deal.risks || null, notes: deal.notes || null,
        // 手动建的房没有任何已知数据，不自动生成带假设金额的分析
        create_analysis: false,
      });
      flash({ type: 'success', content: uiText("sentences.created.and.tasks.assigned.email.is.not.connected.so.no", { value1: (p.name), value2: (planSummary.total), value3: (planSummary.assigned) }) });
      navigate(`/projects/${p.id}?tab=overview`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      busy.current = false; setSubmitting(false);
    }
  };

  const fieldInput = (key: string) => {
    const hit = byKey[key];
    if (!hit) return null;
    const { f, i } = hit;
    const low = f.source !== 'manual' && f.confidence != null && f.confidence < 0.8;
    const manualPath = !lookup;
    return (
      <FormField
        key={f.field}
        label={<span>{systemText(f.label)} <SourceBadge source={f.source} confidence={f.confidence} note={f.note} /></span>}
        constraintText={manualPath && key === 'apn' ? uiText("leads.unverified") : undefined}
        warningText={systemText(low ? uiText("addProject.low.confidence.verification.recommended") : undefined)}
      >
        <Input value={f.value} onChange={({ detail }) => setFields((prev) => prev.map((x, j) => (j === i
          ? { ...x, value: detail.value, source: 'manual', confidence: manualPath ? null : 1, note: manualPath ? '新建时手动填写' : '新建时人工修改' }
          : x)))} />
      </FormField>
    );
  };

  /** 金额框下面的参考值：写全名、标来源、点「采用」才填进去。没有查询结果就没有参考值。 */
  const reference = (key: 'list_price' | 'avm_value', title: string, dealKey: 'purchase_price' | 'target_arv') => {
    const v = lookup?.valuation?.[key];
    if (v == null) return undefined;
    const src = lookup?.fields.find((f) => f.field === key)?.source;
    return (
      <span>
        {uiText("addProject.reference")}{systemText(title)} {money(v)}（{labelOfSource(src ?? 'unverified')}{uiText("addProject.reference.only")} {' '}
        <Button variant="inline-link" onClick={() => setDeal((d) => ({ ...d, [dealKey]: String(v) }))}>{uiText("addProject.use.value")}</Button>
      </span>
    );
  };

  const provisional = summary.bySource.some((b) => isProvisionalSource(b.source));

  const houseCard = <Container cardId="intake-house" header={<Header variant="h2">{uiText("addProject.this.property")}</Header>}>
    <SpaceBetween size="m">
      <div><div className="ui-property-icon"><Icon name="folder" /></div><Box fontWeight="bold" fontSize="heading-m">{name || address?.street || uiText("addProject.address.needs.confirmation")}</Box><Box margin={{ top: 'xs' }} color="text-body-secondary">{address?.label || uiText("addProject.select.or.enter.a.property.address.first")}</Box></div>
      <div><Box color="text-body-secondary">{uiText("addProject.purchase.proposed.price.team.entry")}</Box><Box fontSize="heading-xl" fontWeight="bold">{deal.purchase_price ? money(Number(deal.purchase_price)) : uiText("procurementItemRow.not.entered.2")}</Box></div>
      <dl className={css.houseFacts}>{[
        { label: uiText("addProject.property.type"), value: byKey.property_type?.f.value || uiText("procurementItemRow.not.entered.2") },
        { label: uiText("addProject.beds.baths"), value: uiText("sentences.beds.baths", { value1: (byKey.beds?.f.value || '—'), value2: (byKey.baths_full?.f.value || '—') }) },
        { label: uiText("addProject.interior.area"), value: byKey.sqft?.f.value ? `${byKey.sqft.f.value} sqft` : uiText("procurementItemRow.not.entered.2") },
        { label: uiText("addProject.lot.area"), value: byKey.lot_sqft?.f.value ? `${byKey.lot_sqft.f.value} sqft` : uiText("procurementItemRow.not.entered.2") },
        { label: 'APN / AIN', value: byKey.apn?.f.value || lookup?.apn || uiText("leads.unverified") },
        { label: uiText("addProject.stage.at.entry"), value: stageOptions.find((s) => s.value === initialStage)?.label ?? uiText("projectPreplan.acquisition.not.purchased") },
        { label: uiText("fieldWithSource.source"), value: lookup ? summaryText(summary, labelOfSource) : uiText("addProject.manual.entry.unverified") },
      ].map((item, index) => <div key={index} className={index === 6 || index === 4 ? css.fullSpan : undefined}><dt><Box variant="small" color="text-body-secondary">{systemText(item.label)}</Box></dt><dd>{item.value}</dd></div>)}</dl>
      {provisional && <Box variant="small" color="text-body-secondary">{uiText("addProject.contains.demo.unverified.data.verify.before.purchase")}</Box>}
    </SpaceBetween>
  </Container>;

  const addressSection = (
              <Container cardId="intake-address" header={<Header variant="h2">{uiText("addProject.address")}</Header>}>
                <SpaceBetween size="m">
                  <FormField label={uiText("addProject.property.address")} description={uiText("addProject.enter.the.street.number.and.name.then.select.a")}>
                    <Autosuggest
                      value={query}
                      placeholder={uiText("addProject.for.example.4928.nw.fisk.ave")}
                      options={candidates.map((c) => ({ value: c.label, label: c.label, description: `${c.city}, ${c.state} ${c.zip}` }))}
                      filteringType="manual"
                      statusType={loadingCands ? 'loading' : 'finished'}
                      loadingText={uiText("app.searching")}
                      empty={uiText("app.no.address.found")}
                      enteredTextLabel={(v) => uiText("sentences.use", { value1: (v) })}
                      onChange={({ detail }) => { setQuery(detail.value); clearHouse(); }}
                      onLoadItems={({ detail }) => loadCandidates(detail.filteringText)}
                      onSelect={({ detail }) => { const v = detail.selectedOption?.value ?? detail.value; setQuery(v); doLookup(v); }}
                    />
                  </FormField>
                  {/* 手动入口常驻，不只在查询失败后出现：真实数据源可能不抛错但返回零候选。 */}
                  <Button variant="inline-link" onClick={() => setManualOpen((o) => !o)}>{manualOpen ? uiText("addProject.collapse.manual.entry") : uiText("addProject.enter.address.manually")}</Button>
                  {manualOpen && (
                    <Container cardId="intake-manual" header={<Header variant="h3" help={uiText("addProject.only.the.street.address.is.required.add.city.state")}>{uiText("addProject.enter.address.manually")}</Header>}>
                      <SpaceBetween size="s">
                        <ColumnLayout columns={4} minColumnWidth={140}>
                          <FormField label={uiText("addProject.street.address.including.number")}><Input value={manualForm.street} onChange={({ detail }) => setManualForm((m) => ({ ...m, street: detail.value }))} /></FormField>
                          <FormField label={uiText("addProject.city")}><Input value={manualForm.city} onChange={({ detail }) => setManualForm((m) => ({ ...m, city: detail.value }))} /></FormField>
                          <FormField label={uiText("addProject.state")}><Input value={manualForm.state} onChange={({ detail }) => setManualForm((m) => ({ ...m, state: detail.value }))} /></FormField>
                          <FormField label={uiText("addProject.zip.code")}><Input value={manualForm.zip} onChange={({ detail }) => setManualForm((m) => ({ ...m, zip: detail.value }))} /></FormField>
                        </ColumnLayout>
                        <Button onClick={startManual} disabled={validateManualAddress(manualForm).length > 0}>{uiText("addProject.use.this.address")}</Button>
                      </SpaceBetween>
                    </Container>
                  )}
                  {error && <Alert type="error">{systemText(error)}</Alert>}
                  {lookingUp && <Alert type="info">{uiText("addProject.looking.up.property.data")}</Alert>}
                  {lookup && provisional && <Alert type="info" header={uiText("addProject.property.details.include.demo.unverified.data")}>{uiText("addProject.verify.apn.areas.list.price.and.automated.valuation.team")}</Alert>}
                  {lookup?.duplicate_of && (
                    <Alert type="warning" header={uiText("addProject.this.property.already.exists")} action={<Button onClick={() => navigate(`/projects/${lookup.duplicate_of!.project_id}`)}>{uiText("addProject.open")}{lookup.duplicate_of.project_name}”</Button>}>
                      {uiText("addProject.the.parcel.number.or.normalized.address.matches.an.existing")} </Alert>
                  )}
                  {address && (
                    <KeyValuePairs
                      columns={4}
                      items={[
                        { label: lookup ? uiText("addProject.demo.address") : uiText("addProject.address.manual.entry"), value: address.label },
                        { label: uiText("addProject.assessor.s.parcel.number.apn"), value: lookup ? text(lookup.apn) : uiText("leads.unverified") },
                        { label: uiText("addProject.automated.valuation"), value: money(lookup?.valuation?.avm_value) },
                        { label: uiText("leadGroups.list.price"), value: money(lookup?.valuation?.list_price) },
                      ]}
                    />
                  )}
                </SpaceBetween>
              </Container>
  );
  const detailsSection = (
              <SpaceBetween size="l">
                {lookup ? (
                  <Alert type={summary.lowConf.length ? 'warning' : provisional ? 'info' : 'success'} header={<>{uiText("addProject.data.completeness")}</>}>
                    {summaryText(summary, labelOfSource)}
                    {provisional && uiText("addProject.demo.values.are.simulated.not.this.property.s.actual")}
                    {uiText("addProject.editing.a.field.changes.its.source.to.manual.manually")} </Alert>
                ) : (
                  <Alert type="info" header={<>{uiText("cardRegistry.enter.manually")}</>}>
                    {uiText("addProject.no.lookup.results.for.this.address.fields.below.are")} </Alert>
                )}
                {GROUPS.map((g, gi) => (
                  <Container cardId="intake-facts" cardContext={g.title} key={gi} header={<Header variant="h2">{g.title}</Header>}>
                    <ColumnLayout columns={g.cols} minColumnWidth={180}>
                      {g.keys.map(fieldInput)}
                    </ColumnLayout>
                  </Container>
                ))}
                {lookup && (
                  <ExpandableSection cardId="intake-history" variant="container" header={<Header variant="h3">{uiText("addProject.ownership.mortgages.and.sales.demo.preview.not.saved")}</Header>}>
                    <SpaceBetween size="l">
                      {lookup.owner ? (
                        <KeyValuePairs columns={3} items={[
                          { label: uiText("addProject.property.owner"), value: text(lookup.owner.name) },
                          { label: uiText("addProject.mailing.address"), value: text(lookup.owner.mailing_address) },
                          { label: uiText("addProject.owned.since"), value: dateStr(lookup.owner.owner_since) },
                        ]} />
                      ) : <Box color="text-body-secondary">{uiText("addProject.no.ownership.information")}</Box>}
                      <Table variant="embedded" header={<Header variant="h3" counter={`(${lookup.mortgages.length})`}>{uiText("addProject.mortgages")}</Header>} items={lookup.mortgages} empty={<Box textAlign="center" color="inherit">{uiText("addProject.no.mortgage.records")}</Box>} columnDefinitions={[
                        { id: 'd', header: uiText("addProject.recording.date"), cell: (m) => dateStr(m.recording_date) },
                        { id: 'l', header: uiText("addProject.lender"), cell: (m) => text(m.lender) },
                        { id: 'o', header: uiText("addProject.original.principal"), cell: (m) => money(m.original_balance) },
                        { id: 'e', header: uiText("addProject.estimated.balance"), cell: (m) => money(m.est_balance) },
                        { id: 'r', header: uiText("addProject.interest.rate"), cell: (m) => pct(m.rate, 2) },
                      ]} />
                      <Table variant="embedded" header={<Header variant="h3" counter={`(${lookup.sales_history.length})`}>{uiText("cardRegistry.sales.history")}</Header>} items={lookup.sales_history} empty={<Box textAlign="center" color="inherit">{uiText("addProject.no.sales.records")}</Box>} columnDefinitions={[
                        { id: 'd', header: uiText("addProject.recording.date"), cell: (s) => dateStr(s.recording_date) },
                        { id: 's', header: uiText("addProject.seller"), cell: (s) => text(s.seller) },
                        { id: 'b', header: uiText("addProject.buyer"), cell: (s) => text(s.buyer) },
                        { id: 'a', header: uiText("procurementItemRow.amount"), cell: (s) => money(s.amount) },
                      ]} />
                    </SpaceBetween>
                  </ExpandableSection>
                )}
              </SpaceBetween>
  );
  const settingsSection = (
              <SpaceBetween size="l">
                <Container cardId="intake-settings" header={<Header variant="h2">{uiText("cardRegistry.project.assignments")}</Header>}>
                  <SpaceBetween size="l">
                    <FormField label={uiText("addProject.project.name")}>
                      <Input value={name} onChange={({ detail }) => setName(detail.value)} />
                    </FormField>
                    <FormField label={uiText("addProject.investment.strategy")}>
                      <Tiles
                        value={strategy}
                        onChange={({ detail }) => setStrategy(detail.value)}
                        items={[
                          { value: 'flip', label: uiText("addProject.fix.and.flip"), description: uiText("addProject.buy.renovate.list.and.sell") },
                          { value: 'new_build', label: uiText("addProject.new.construction"), description: uiText("addProject.demolition.and.rebuild.or.build.on.vacant.land") },
                          { value: 'rental', label: uiText("addProject.buy.and.hold.rental"), description: uiText("addProject.renovate.and.hold.for.rental.income") },
                        ]}
                      />
                    </FormField>
                    <FormField label={uiText("addProject.current.property.stage")} description={uiText("addProject.task.preparation.starts.here.later.stage.tasks.can.be")}>
                      <Select selectedOption={stageOptions.find((s) => s.value === initialStage) ?? null} options={stageOptions} onChange={({ detail }) => setInitialStage(detail.selectedOption.value!)} />
                    </FormField>
                    {initialStage !== 's1' && <Alert type="info">{uiText("addProject.this.is.the.property.s.stage.when.entered.earlier")}</Alert>}
                  </SpaceBetween>
                </Container>

                <Container cardId="intake-deal" header={<Header variant="h2" help={uiText("addProject.leave.blank.before.purchase.if.needed.then.use.the")}>{uiText("cardRegistry.transaction.and.dates")}</Header>}>
                  <SpaceBetween size="l">
                    <ColumnLayout columns={2}>
                      {/* KAN-71：这两格以前预填挂牌价/估值，还挂着写死的「公共记录 90%」「估算 75%」徽章。
                          现在默认空，参考值写在框下面并标来源；采用后就是团队自己的数，不再另标来源。 */}
                      <FormField label={uiText("addProject.purchase.proposed.price.usd")} constraintText={reference('list_price', uiText("leadGroups.list.price"), 'purchase_price')}>
                        <Input type="number" value={deal.purchase_price} onChange={({ detail }) => setDeal((d) => ({ ...d, purchase_price: detail.value }))} />
                      </FormField>
                      <FormField label={uiText("addProject.after.repair.value.arv.usd")} constraintText={reference('avm_value', uiText("addProject.automated.valuation"), 'target_arv')}>
                        <Input type="number" value={deal.target_arv} onChange={({ detail }) => setDeal((d) => ({ ...d, target_arv: detail.value }))} />
                      </FormField>
                    </ColumnLayout>
                    <ColumnLayout columns={3}>
                      <FormField label={uiText("leadershipProjectDetail.purchase.date")}><DatePicker value={deal.purchase_date} placeholder="YYYY/MM/DD" onChange={({ detail }) => setDeal((d) => ({ ...d, purchase_date: detail.value }))} /></FormField>
                      <FormField label={uiText("addProject.planned.start")}><DatePicker value={deal.construction_start} placeholder="YYYY/MM/DD" onChange={({ detail }) => setDeal((d) => ({ ...d, construction_start: detail.value }))} /></FormField>
                      <FormField label={uiText("addProject.planned.finish")}><DatePicker value={deal.construction_end} placeholder="YYYY/MM/DD" onChange={({ detail }) => setDeal((d) => ({ ...d, construction_end: detail.value }))} /></FormField>
                    </ColumnLayout>
                    <FormField label={uiText("addProject.known.risks")} stretch><Textarea rows={2} value={deal.risks} placeholder={uiText("addProject.for.example.foundation.condition.needs.professional.inspection.before.the")} onChange={({ detail }) => setDeal((d) => ({ ...d, risks: detail.value }))} /></FormField>
                    <FormField label={uiText("inspectionsPanel.notes")} stretch><Textarea rows={2} value={deal.notes} placeholder={uiText("addProject.lead.source.ownership.context.or.investment.approach")} onChange={({ detail }) => setDeal((d) => ({ ...d, notes: detail.value }))} /></FormField>
                  </SpaceBetween>
                </Container>
                {error && <Alert type="error">{systemText(error)}</Alert>}
              </SpaceBetween>
  );

  const advance = () => {
    if (!address) { setError(uiText("addProject.select.an.address.or.enter.it.manually.first")); return; }
    if ([deal.purchase_price, deal.target_arv].some((v) => v && (!Number.isFinite(Number(v)) || Number(v) < 0))) { setError(uiText("addProject.enter.a.valid.nonnegative.amount.or.leave.it.blank")); return; }
    setError(null); setStep((s) => Math.min(s + 1, 2)); window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  if (!me) return <ContentLayout header={<Header variant="h1">{uiText("app.new.project")}</Header>}><Alert type="info" action={<Button onClick={() => navigate('/login')}>{uiText("cardRegistry.sign.in")}</Button>}>{uiText("addProject.sign.in.to.prepare.tasks.and.assign.employees.for")}</Alert></ContentLayout>;
  if (!role.can('create_project') || !userCan(meta, me, 'create_project')) return <Alert type="warning">{uiText("addProject.this.account.cannot.create.projects")}</Alert>;
  if (!meta) return <Alert type="info">{uiText("addProject.loading.project.templates.please.wait")}</Alert>;
  return <ContentLayout maxContentWidth={1440}
    breadcrumbs={<BreadcrumbGroup items={[{ text: uiText("app.projects"), href: '/projects' }, { text: uiText("app.new.project"), href: '/projects/new' }]} onFollow={(e) => { e.preventDefault(); navigate(e.detail.href); }} />}
    header={<Header variant="h1" help={uiText("addProject.start.with.one.property.and.plan.the.full.process")}>{systemText(['确认这套房屋', '为这套房安排全流程', '确认房屋与任务安排'][step])}</Header>}>
    <div className={css.scope}>
      <ol className={css.steps} aria-label={uiText("addProject.new.project.steps")}>{['确认房屋', '准备任务', '确认创建'].map((label, index) => <li key={label} aria-current={index === step ? 'step' : undefined} data-step-state={index < step ? 'done' : index === step ? 'current' : 'future'}><span className={css.stepNumber}>{index < step ? <Icon name="check" size="small" /> : index + 1}</span><span className={css.stepLabel}>{systemText(label)}</span></li>)}</ol>
      {error && <Box margin={{ bottom: 'l' }}><Alert type="error">{systemText(error)}</Alert></Box>}
      {step === 0 && <div className={css.intakeSplit}><SpaceBetween size="l">{addressSection}{address && <>{settingsSection}<ExpandableSection cardId="intake-sources" variant="container" headerText={uiText("addProject.property.data.and.sources.demo.and.manual.verification")}><Alert type="info">{uiText("addProject.demo.data.only.a.real.property.api.is.not")}</Alert>{detailsSection}</ExpandableSection></>}</SpaceBetween><aside className={css.aside}>{houseCard}</aside></div>}
      {step === 1 && <div className={css.intakeSplit}><SpaceBetween size="l">
        <HelpText>{uiText("founderDesign.all")} {planSummary.total} {uiText("addProject.tasks.will.be.created.later.tasks.can.be.assigned")}</HelpText>
        {usersError && <Alert type="error" action={<Button onClick={loadUsers}>{uiText("addProject.retry")}</Button>}>{uiText("addProject.could.not.load.employee.accounts")}{usersError}{uiText("addProject.you.may.create.without.assignments.and.assign.later")}</Alert>}
        <ProjectPreplan meta={meta} plan={plan} onChange={updatePlan} users={users} loading={loadingUsers} creatorId={me.id} initialStage={initialStage} />
      </SpaceBetween><aside className={css.aside}><SpaceBetween size="l">{houseCard}<PlanSummary meta={meta} plan={plan} users={users} initialStage={initialStage} /></SpaceBetween></aside></div>}
      {step === 2 && <div className={css.intakeSplit}><SpaceBetween size="l">
        {houseCard}<PlanReview meta={meta} plan={plan} />
        <Container cardId="intake-start" header={<Header variant="h2">{uiText("addProject.getting.started.after.creation")}</Header>}><SpaceBetween size="m">
          <KeyValuePairs columns={2} items={[{ label: uiText("addProject.starting.position"), value: stageOptions.find((s) => s.value === initialStage)?.label }, { label: uiText("addProject.task.status"), value: systemText('普通任务待处理；采购分派后即可录单') }, { label: uiText("addProject.reviewer.for.these.assignments"), value: planSummary.assigned ? me.display_name : uiText("addProject.set.when.assigning") }, { label: uiText("projectPreplan.milestones"), value: systemText('必要条件齐备后，由有权限的账号确认满足') }]} />
          {joining.length > 0 && <Box>{uiText('assignment.autoJoin', { people: joining.map(id => users.find(u => u.id === id)?.display_name ?? String(id)).join('、') })}</Box>}
          <Box color="text-body-secondary">{uiText("addProject.unassigned")} {planSummary.unassigned} {uiText("addProject.tasks.remain.available.to.assign.later")}</Box>
        </SpaceBetween></Container>
      </SpaceBetween><aside className={css.aside}><PlanSummary meta={meta} plan={plan} users={users} initialStage={initialStage} review /></aside></div>}
      <div className={css.footer}><Button variant="link" disabled={submitting} onClick={() => navigate('/projects')}>{uiText("fieldWithSource.cancel")}</Button><SpaceBetween direction="horizontal" size="xs">{step > 0 && <Button disabled={submitting} onClick={() => { setError(null); setStep(step - 1); }}>{uiText("addProject.back")}</Button>}{step < 2 ? <Button variant="primary" loading={lookingUp} disabled={!address} onClick={advance}>{uiText("directorDesign.next.step")}{step === 0 ? uiText("addProject.prepare.tasks") : uiText("addProject.confirm.creation")}</Button> : <Button variant="primary" loading={submitting} onClick={submit}>{uiText("addProject.create.project")}</Button>}</SpaceBetween></div>
    </div>
  </ContentLayout>;
}
