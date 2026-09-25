import { Fragment, useState } from 'react';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import TextFilter from '@cloudscape-design/components/text-filter';
import type { RoleDesign } from '../../lib/roleDesigns';
import { currentAnalysis, holdingDays, overdueTasks, leadershipMoney as money, type LeadershipAnalysis, type LeadershipPreview, type LeadershipProject } from '../../lib/leadershipDesign';
import CollaborationWorkspace from '../ui/CollaborationWorkspace';
import Header from '../ui/Header';
import FormField from '../ui/FormField';
import LeadershipProjectDetail from './LeadershipProjectDetail';

const ISSUES = [
  { value: 'all', label: '全部议题' }, { value: 'data', label: '资料与估算依据' },
  { value: 'progress', label: '进度与关键节点' }, { value: 'settlement', label: '成交与结算资料' },
];
const LIFECYCLES = [{ value: 'all', label: '全部房屋' }, { value: 'lead', label: '未购入' }, { value: 'active', label: '进行中' }, { value: 'closed', label: '已售出' }];
const COSTS = [
  { key: 'purchase_total', title: '购入及附加成本', description: '分析版本中的买入价与购入附加费用之和。与项目已登记买入价分开核对。' },
  { key: 'rehab_total', title: '装修成本假设', description: '分析版本中的装修明细之和。不是实时支出台账，也不与已登记支出重复相加。' },
  { key: 'holding_total', title: '持有与融资成本', description: '估算持有月数乘每月费用，加融资利息。偿还本金不作为利润成本；持有月数是版本假设。' },
  { key: 'selling_total', title: '卖出费用假设', description: '分析售价乘卖出费用比例，再加其他卖出费用。它不是已确认的最终结算费用。' },
] as const;
type CostKey = typeof COSTS[number]['key'];
const outputs = (analysis: LeadershipAnalysis | null | undefined) => analysis && !analysis.missing.length ? analysis.outputs : null;
const latestUpdate = (project: LeadershipProject) => [...project.updates].sort((a, b) => b.date.localeCompare(a.date))[0];

/** Director-facing design comparison. Only reads the authorized synthetic preview payload. */
export default function DirectorDesign({ preview, design }: { preview: LeadershipPreview; design: RoleDesign }) {
  const [sectionRequestId, setSectionRequestId] = useState(0);
  const [query, setQuery] = useState('');
  const [lifecycle, setLifecycle] = useState('all');
  const [issue, setIssue] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(preview.projects[0]?.id ?? null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedSection, setSelectedSection] = useState('经营依据');
  const [versionIds, setVersionIds] = useState<Record<string, string>>({});
  const [comparisonIds, setComparisonIds] = useState<Record<string, string>>({});
  const [cost, setCost] = useState<CostKey>('holding_total');
  const visible = preview.projects.filter(project => (lifecycle === 'all' || project.lifecycle === lifecycle)
    && (issue === 'all' || project.issues.includes(issue as LeadershipProject['issues'][number]))
    && `${project.name} ${project.stage} ${project.concern} ${project.next_action} ${project.coordinator}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = visible.find(project => project.id === selectedId) ?? null;
  const selectedCurrent = selected ? currentAnalysis(selected) : null;
  const selectedAnalysis = selected?.analyses.find(analysis => analysis.id === versionIds[selected.id]) ?? selectedCurrent;
  const compareAnalysis = selected?.analyses.find(analysis => analysis.id === comparisonIds[selected.id] && analysis.id !== selectedAnalysis?.id);
  const selectedOutputs = outputs(selectedAnalysis);
  const compareOutputs = outputs(compareAnalysis);
  const costDefinition = COSTS.find(item => item.key === cost)!;
  const choose = (project: LeadershipProject, open = true, section = '经营依据') => {
    setSectionRequestId(n => n + 1); setSelectedId(project.id); setSelectedSection(section); setDetailOpen(open);
  };
  const clear = () => { setQuery(''); setLifecycle('all'); setIssue('all'); };
  const empty = <div className="ui-rd-empty"><SpaceBetween size="s"><span>没有符合条件的房屋。当前筛选没有扩大到其他项目。</span><Button onClick={clear}>清除筛选</Button></SpaceBetween></div>;
  const analysisProfit = (project: LeadershipProject) => {
    const current = currentAnalysis(project);
    if (project.lifecycle === 'closed') return <><button onClick={() => choose(project)}>结算待核</button><small>历史测算可在方案 C 查看，非实际净利润</small></>;
    return <><button aria-label={`查看${project.name}的估算经营依据`} onClick={() => choose(project)}>{money(outputs(current)?.total_profit ?? null)}</button>
      <small>{current ? current.label : '没有唯一的当前分析版本'}</small>
      <small>{project.lifecycle === 'lead' ? '线索分析假设 · 尚未购入' : '当前模型估算 · 非最终净利润'}</small></>;
  };

  const overview = <SpaceBetween size="m">
    <Header variant="h2" description="同一行核对位置、估算口径与尚待理解的问题，再打开对应房屋资料。">董事项目观察表</Header>
    <div className="ui-sd-table-scroll"><table className="ui-sd-ledger"><caption className="ui-sr-only">董事可查看的合成项目观察表</caption><thead><tr><th>房屋 / 阶段</th><th>分析版本利润估算</th><th>预算 / 已登记支出</th><th>关键节点现况</th><th>需要核对</th></tr></thead><tbody>
      {visible.map(project => <tr key={project.id} data-selected={selected?.id === project.id}>
        <td><button aria-pressed={selected?.id === project.id} onClick={() => choose(project)}>{project.name}</button><small>{project.stage}</small></td>
        <td>{analysisProfit(project)}</td>
        <td><button aria-label={`查看${project.name}的预算依据`} onClick={() => choose(project)}>{money(project.budget)}</button><small>已登记 <button aria-label={`查看${project.name}的支出依据`} onClick={() => choose(project)}>{money(project.expenses)}</button></small></td>
        <td>{project.gate.title}<small>前提{project.gate.prerequisite_met ? '已满足' : '未满足'} · D{project.gate.d ? '已确认' : '未确认'} / J{project.gate.j ? '已确认' : '未确认'}</small></td>
        <td>{project.concern}<small>{project.financial_updated_at} · 财务资料记录时间</small></td>
      </tr>)}
    </tbody></table></div>
    {!visible.length && empty}
  </SpaceBetween>;

  const issueGroups = [...ISSUES.slice(1), { value: 'updates', label: '近期项目更新' }];
  const updates = <SpaceBetween size="m">
    <Header variant="h2" description="先读问题、现有记录和下一步；每套房按主要议题列一次，其他议题保留标签，也可在上方筛选。不自动新增董事审批事项。">议题与近期更新</Header>
    {issueGroups.map(group => {
      const projects = visible.filter(project => (issue === 'all' ? project.issues[0] ?? 'updates' : issue) === group.value);
      return projects.length ? <section className="ui-rd-task-group" key={group.value}><h3>{group.label}<small>{projects.length} 套</small></h3>
        {projects.map(project => {
          const recent = latestUpdate(project);
          const otherIssues = project.issues.filter(value => value !== group.value).map(value => ISSUES.find(item => item.value === value)?.label ?? value);
          return <button key={project.id} className="ui-rd-task" aria-pressed={selected?.id === project.id} onClick={() => choose(project, true, group.value === 'progress' ? '推进与节点' : group.value === 'data' ? '经营依据' : '资料与记录')}>
            <span><small>{project.name} · {project.stage}</small><strong>{project.concern}</strong><span>下一步：{project.next_action}</span>
              {otherIssues.length > 0 && <span>同时关注：{otherIssues.join('、')}</span>}
              {recent ? <span>最近记录 {recent.date} · {recent.title}</span> : <span>尚无项目更新记录</span>}</span>
            <span className="ui-rd-task-meta"><small>统筹：{project.coordinator}</small><span>{overdueTasks(project, preview.as_of).length} 项已过截止</span></span>
          </button>;
        })}
      </section> : null;
    })}
    {!visible.length && empty}
  </SpaceBetween>;

  const assumptions = <SpaceBetween size="m">
    <Header variant="h2" description="先选房屋与估算版本，再逐项查看成本构成。数值来自现有确定性分析公式。">估算依据工作台</Header>
    <div className="ui-rd-house-layout"><nav aria-label="董事估算房屋导航">{visible.map(project => <button key={project.id} aria-pressed={selected?.id === project.id} onClick={() => choose(project, false)}><strong>{project.name}</strong><small>{project.stage}</small></button>)}</nav>
      <section>{selected ? <SpaceBetween size="m">
        <Header variant="h3" description={`项目统筹：${selected.coordinator}`}>{selected.name}</Header>
        <Box>持有天数：{holdingDays(selected, preview.as_of) == null ? '日期未齐或尚未购入' : `${holdingDays(selected, preview.as_of)} 天`}。实际日期与分析持有月数分别显示。</Box>
        {selected.analyses.length ? <>
          {!selectedCurrent && <Alert type="info">当前分析版本不明确：{selected.analyses.filter(analysis => analysis.current).length ? '有多个版本被标记为当前。' : '没有版本被标记为当前。'}{selectedAnalysis ? '以下展示你主动选择的版本，不将其设为当前版本。' : '请主动选择要阅读的版本；不会默认使用第一版。'}</Alert>}
          <FormField label="查看估算版本"><Select ariaLabel="董事分析版本" placeholder="请选择要阅读的版本" options={selected.analyses.map(analysis => ({ value: analysis.id, label: `${analysis.label}${analysis.current ? selectedCurrent ? ' · 当前版本' : ' · 当前标记待核' : ''}` }))}
            selectedOption={selectedAnalysis ? { value: selectedAnalysis.id, label: `${selectedAnalysis.label}${selectedAnalysis.current ? selectedCurrent ? ' · 当前版本' : ' · 当前标记待核' : ''}` } : null}
            onChange={({ detail }) => setVersionIds(previous => ({ ...previous, [selected.id]: detail.selectedOption.value! }))} /></FormField>
          <FormField label="对照另一版本"><Select ariaLabel="董事对照版本" disabled={!selectedAnalysis} options={[{ value: '', label: '不对照' }, ...selected.analyses.filter(analysis => analysis.id !== selectedAnalysis?.id).map(analysis => ({ value: analysis.id, label: analysis.label }))]}
            selectedOption={compareAnalysis ? { value: compareAnalysis.id, label: compareAnalysis.label } : { value: '', label: '不对照' }}
            onChange={({ detail }) => setComparisonIds(previous => ({ ...previous, [selected.id]: detail.selectedOption.value! }))} /></FormField>
          {selectedAnalysis && !selectedOutputs && <Alert type="info">这个版本暂不显示计算结果。{selectedAnalysis.missing.length ? `缺少：${selectedAnalysis.missing.join('、')}。` : '尚无完整输出。'}未把缺失金额按零处理。</Alert>}
          {compareAnalysis && !compareOutputs && <Alert type="info">对照版本资料未齐：{compareAnalysis.missing.join('、') || '没有完整计算结果'}。不计算版本差额。</Alert>}
          <dl className="ui-sd-budget-strip"><div><dt>模型售价假设</dt><dd>{money(selectedOutputs?.sale_price ?? null)}</dd></div><div><dt>模型总成本</dt><dd>{money(selectedOutputs?.total_costs ?? null)}</dd></div><div><dt>模型利润估算</dt><dd>{money(selectedOutputs?.total_profit ?? null)}</dd></div></dl>
          <div className="ui-sd-table-scroll"><table className="ui-sd-ledger"><caption className="ui-sr-only">估算版本成本构成，点击成本项查看依据</caption><thead><tr><th>成本项</th><th>{selectedAnalysis?.label}</th>{compareAnalysis && <><th>{compareAnalysis.label}</th><th>本版本减对照</th></>}</tr></thead><tbody>
            {COSTS.map(item => <tr key={item.key} data-selected={cost === item.key}><td><button aria-pressed={cost === item.key} onClick={() => { setCost(item.key); setDetailOpen(true); }}>{item.title}</button></td><td>{money(selectedOutputs?.[item.key] ?? null)}</td>{compareAnalysis && <><td>{money(compareOutputs?.[item.key] ?? null)}</td><td>{money(selectedOutputs && compareOutputs ? selectedOutputs[item.key] - compareOutputs[item.key] : null)}</td></>}</tr>)}
          </tbody></table></div>
          {selectedOutputs && compareOutputs && <Box>相对「{compareAnalysis?.label}」：售价假设差额 {money(selectedOutputs.sale_price - compareOutputs.sale_price)}，总成本差额 {money(selectedOutputs.total_costs - compareOutputs.total_costs)}，利润估算差额 {money(selectedOutputs.total_profit - compareOutputs.total_profit)}。对照版本利润估算为 {money(compareOutputs.total_profit)}。</Box>}
          <Box color="text-body-secondary">模型利润 = 模型售价 − 模型总成本；不等于最终净利润，不与其他口径的利润相加。版本差额仅解释假设差异，不代表期间实际盈亏。</Box>
          <Button onClick={() => setDetailOpen(true)}>查看所选成本依据与房屋资料</Button>
        </> : <Box>这套房还没有分析版本，保留未知；仍可查看项目事实与资料。</Box>}
      </SpaceBetween> : <div className="ui-rd-empty">请选择一套符合筛选的房屋。</div>}</section>
    </div>
    {!visible.length && empty}
  </SpaceBetween>;

  const detail = selected ? <>
    {design.id === 'C' && <div className="ui-rd-detail"><SpaceBetween size="m">
      <Header variant="h2">{costDefinition.title}</Header><p>{costDefinition.description}</p>
      <dl className="ui-rd-facts"><dt>所选版本</dt><dd>{selectedAnalysis?.label ?? '尚未选择可阅读的分析版本'}</dd><dt>版本记录时间</dt><dd>{selectedAnalysis?.recorded_at ?? '未记录'}</dd><dt>这一项估算</dt><dd>{money(selectedOutputs?.[cost] ?? null)}</dd></dl>
      <Header variant="h3" description="以下是所选版本完整输入依据；没有把来源说明冒充业务凭证。">版本假设与来源</Header>
      {selectedAnalysis?.assumptions.length ? <dl className="ui-rd-facts">{selectedAnalysis.assumptions.map((item, index) => <Fragment key={`${item.label}:${index}`}><dt>{item.label}</dt><dd>{item.value}<details><summary>查看来源</summary><p>{item.source}</p></details></dd></Fragment>)}</dl> : <Box>没有可查看的假设来源。</Box>}
      {compareAnalysis && <details><summary>查看对照版本假设 · {compareAnalysis.label}</summary><dl className="ui-rd-facts">{compareAnalysis.assumptions.map((item, index) => <Fragment key={`${item.label}:${index}`}><dt>{item.label}</dt><dd>{item.value}<p>{item.source}</p></dd></Fragment>)}</dl></details>}
    </SpaceBetween></div>}
    <LeadershipProjectDetail sectionRequestId={sectionRequestId} project={selected} asOf={preview.as_of} initialSection={selectedSection} />
  </> : <div className="ui-rd-empty">选中的房屋不在当前筛选结果中，请从列表重新选择。</div>;

  return <SpaceBetween size="m">
    <div className="ui-rd-toolbar"><TextFilter filteringText={query} filteringAriaLabel="搜索董事项目" filteringPlaceholder="搜索房屋、问题或下一步" onChange={({ detail }) => setQuery(detail.filteringText)} />
      <Select ariaLabel="董事项目范围" options={LIFECYCLES} selectedOption={LIFECYCLES.find(item => item.value === lifecycle)!} onChange={({ detail }) => setLifecycle(detail.selectedOption.value!)} />
      <Select ariaLabel="董事议题筛选" options={ISSUES} selectedOption={ISSUES.find(item => item.value === issue)!} onChange={({ detail }) => setIssue(detail.selectedOption.value!)} />
    </div>
    <Box color="text-body-secondary">{visible.length} / {preview.projects.length} 套合成房屋 · 观察日期 {preview.as_of} · 本页不执行定价、签署或 D/J 审批。</Box>
    <CollaborationWorkspace main={<div className="ui-rd-main">{design.id === 'A' ? overview : design.id === 'B' ? updates : assumptions}</div>}
      detail={detail} detailOpen={detailOpen && !!selected} onBack={() => setDetailOpen(false)} />
  </SpaceBetween>;
}
