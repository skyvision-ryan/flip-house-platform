import { useState } from 'react';
import Button from '@cloudscape-design/components/button';
import CollaborationWorkspace from '../ui/CollaborationWorkspace';
import LeadershipProjectDetail from './LeadershipProjectDetail';
import type { RoleDesign } from '../../lib/roleDesigns';
import { currentAnalysis, holdingDays, investedScale, leadershipMoney as money, leadershipTotals, overdueTasks, reviewAge,
  type LeadershipPreview, type LeadershipProject } from '../../lib/leadershipDesign';

const issueLabels = { data: '收益资料缺口', progress: '推进卡点', settlement: '结算待核' } as const;
type Issue = keyof typeof issueLabels;
const lifecycleLabels = { lead: '线索', active: '进行中', closed: '已售收尾' } as const;
const modelLabel = (project: LeadershipProject) => {
  if (project.lifecycle !== 'active') return project.lifecycle === 'lead' ? '线索未计入' : '已售待核算';
  const analysis = currentAnalysis(project);
  return analysis?.outputs && !analysis.missing.length ? money(analysis.outputs.total_profit) : '资料未齐';
};
const daysLabel = (project: LeadershipProject, asOf: string) => {
  const days = holdingDays(project, asOf);
  return days == null ? (project.lifecycle === 'lead' ? '未买入' : '日期未齐') : `${days} 天${project.lifecycle === 'closed' ? '（截至售出）' : ''}`;
};

/** Founder reads the same projects through money, common issues, or current flow. */
export default function FounderDesign({ preview, design }: { preview: LeadershipPreview; design: RoleDesign }) {
  const [sectionRequestId, setSectionRequestId] = useState(0);
  const [query, setQuery] = useState('');
  const [lifecycle, setLifecycle] = useState('all');
  const [issue, setIssue] = useState<Issue | 'all'>('all');
  const [stage, setStage] = useState('all');
  const [sort, setSort] = useState('default');
  const [distribution, setDistribution] = useState<'count' | 'invested'>('count');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailSection, setDetailSection] = useState<'经营依据' | '推进与节点'>('经营依据');
  const [metric, setMetric] = useState<'invested' | 'model' | 'attention' | null>(null);
  const base = preview.projects.filter(project => (lifecycle === 'all' || project.lifecycle === lifecycle)
    && (issue === 'all' || project.issues.includes(issue))
    && `${project.name} ${project.stage} ${project.coordinator} ${project.concern}`.toLowerCase().includes(query.trim().toLowerCase()));
  const filtered = base.filter(project => stage === 'all' || project.stage === stage);
  const rows = [...filtered].sort((a, b) => sort === 'invested'
    ? (b.lifecycle === 'active' ? investedScale(b) ?? -1 : -1) - (a.lifecycle === 'active' ? investedScale(a) ?? -1 : -1)
    : sort === 'days' ? (holdingDays(b, preview.as_of) ?? -1) - (holdingDays(a, preview.as_of) ?? -1) : 0);
  const totals = leadershipTotals(filtered, preview.as_of);
  const selected = filtered.find(project => project.id === selectedId);
  const stages = [...new Set(preview.projects.map(project => project.stage))];
  const stageRows = stages.map(label => {
    const projects = base.filter(project => project.stage === label);
    const groupTotals = leadershipTotals(projects, preview.as_of);
    return { label, projects, totals: groupTotals, value: distribution === 'count' ? projects.length : groupTotals.invested };
  });
  const maxValue = Math.max(1, ...stageRows.map(group => group.value));
  const baseTotals = leadershipTotals(base, preview.as_of);
  const choose = (project: LeadershipProject, section: '经营依据' | '推进与节点' = '经营依据') => {
    setSectionRequestId(n => n + 1); setSelectedId(project.id); setDetailSection(section); setDetailOpen(true);
  };
  const clear = () => { setQuery(''); setLifecycle('all'); setIssue('all'); setStage('all'); setSort('default'); setMetric(null); setDetailOpen(false); };
  const toolbar = <div className="ui-rd-toolbar">
    <label>查找房屋<input aria-label="T 查找项目" value={query} onChange={event => { setQuery(event.target.value); setDetailOpen(false); }} placeholder="房屋、负责人或卡点" /></label>
    <label>项目范围<select aria-label="T 项目范围" value={lifecycle} onChange={event => { setLifecycle(event.target.value); setDetailOpen(false); }}><option value="all">全部项目</option><option value="active">进行中</option><option value="closed">已售收尾</option><option value="lead">线索</option></select></label>
    <label>问题范围<select aria-label="T 问题筛选" value={issue} onChange={event => { setIssue(event.target.value as Issue | 'all'); setDetailOpen(false); }}><option value="all">全部问题与正常项目</option>{Object.entries(issueLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>排序<select aria-label="T 项目排序" value={sort} onChange={event => setSort(event.target.value)}><option value="default">默认顺序</option><option value="invested">登记投入从高到低</option><option value="days">持有天数从长到短</option></select></label>
  </div>;
  const activeRows = [...new Map(rows.filter(project => project.lifecycle === 'active').map(project => [project.id, project])).values()];
  const attentionRows = activeRows.filter(project => overdueTasks(project, preview.as_of).length || project.tasks.some(task => task.status === 'review'));
  const metricPanel = metric && <section className="ui-rd-task-group" aria-label="经营指标构成">
    <div className="ui-rd-section-heading"><h3>{metric === 'invested' ? '登记投入构成' : metric === 'model' ? '估算覆盖与缺项' : '逾期与待审批次'}</h3><Button onClick={() => setMetric(null)}>收起指标明细</Button></div>
    <p className="ui-rd-caption">范围仍是当前所选 {filtered.length} 套中的 {totals.active} 套进行中项目。展开只解释指标，不改变筛选或覆盖分母。</p>
    {(metric === 'attention' ? attentionRows : activeRows).map(project => {
      const analysis = currentAnalysis(project);
      const overdue = overdueTasks(project, preview.as_of);
      const review = project.tasks.filter(task => task.status === 'review');
      return <button className="ui-rd-task" key={project.id} onClick={() => choose(project, metric === 'attention' ? '推进与节点' : '经营依据')}>
        <span><strong>{project.name}</strong>{metric === 'invested' ? <>
          <span>买入价 {money(project.purchase_price)} ＋ 已登记支出 {money(project.expenses)}</span>
          <small>{investedScale(project) == null ? `未计入；待补${[project.purchase_price == null ? '买入价' : '', project.expenses == null ? '已登记支出' : ''].filter(Boolean).join('、')}` : '已计入；点击查看原值与记录日期'}</small>
        </> : metric === 'model' ? <>
          <span>{analysis ? `${analysis.label} · ${analysis.recorded_at}` : '未找到唯一的当前测算版本'}</span>
          <small>{analysis?.missing.length ? `未计入；待补 ${analysis.missing.join('、')}` : analysis?.outputs ? '完整当前版本已计入；点击查看公式、假设与来源' : '缺少当前完整输出，未计入估算汇总'}</small>
        </> : <>
          <span>逾期未完成 {overdue.length} 项 · 当前待审 {review.length} 项</span>
          <small>{overdue.length ? `逾期：${overdue.map(task => `${task.title}（截止 ${task.due_date}）`).join('；')}` : '没有逾期未完成事项'}</small>
          <small>{review.length ? `待审：${review.map(task => `${task.title}（${reviewAge(task, preview.as_of) == null ? '提交日期未齐' : `当前批次 ${reviewAge(task, preview.as_of)} 天`}）`).join('；')}` : '没有当前待审批次'}</small>
        </>}</span>
        <span className="ui-rd-task-meta"><strong>{metric === 'invested' ? money(investedScale(project)) : metric === 'model' ? modelLabel(project) : '查看推进依据'}</strong></span>
      </button>;
    })}
    {!(metric === 'attention' ? attentionRows : activeRows).length && <p className="ui-rd-empty">{metric === 'attention' ? '当前范围没有逾期未完成或待审事项。' : '当前范围没有进行中项目，暂无可展开的金额构成。'}</p>}
  </section>;
  const summary = <>
    <div className="ui-rd-section-heading"><h3>所选 {filtered.length} 套房</h3><span>其中进行中 {totals.active} 套，已售收尾 {totals.closed} 套</span></div>
    <dl className="ui-ld-summary"><div><dt>进行中 · 登记投入规模</dt><dd>{totals.investedKnown ? money(totals.invested) : '无可汇总金额'}</dd><small>覆盖 {totals.investedKnown}/{totals.active} 套 · 买入价＋登记支出</small><Button onClick={() => setMetric(metric === 'invested' ? null : 'invested')}>查看投入构成</Button></div>
      <div><dt>进行中 · 当前模型收益估算</dt><dd>{totals.modeled ? money(totals.modelProfit) : '无完整估算'}</dd><small>覆盖 {totals.modeled}/{totals.active} 套 · 缺资料项目未计入</small><Button onClick={() => setMetric(metric === 'model' ? null : 'model')}>查看估算覆盖</Button></div>
      <div><dt>进行中 · 需要查看的事项</dt><dd>过期未完成 {totals.overdue} 项 · 待审 {totals.review} 项</dd><small>同一事项可能同时待审及超期，不相加为总数</small><Button onClick={() => setMetric(metric === 'attention' ? null : 'attention')}>查看逾期与待审</Button></div></dl>
    <p className="ui-rd-caption">估算不是已实现利润。登记投入不是股东现金占用；已售项目不计入进行中金额，结算与净回款仍需完整实际记录。</p>
    {metricPanel}
  </>;
  const projectButton = (project: LeadershipProject, withTasks = false, section: '经营依据' | '推进与节点' = '经营依据') => <button key={project.id} className="ui-rd-task" aria-pressed={selected?.id === project.id} onClick={() => choose(project, section)}>
    <span><strong>{project.name}</strong><small>{project.stage} · {lifecycleLabels[project.lifecycle]} · {project.coordinator}</small><span>{project.concern}</span><span>下一步：{project.next_action}</span>
      {withTasks && <span>未完成且已到期 {overdueTasks(project, preview.as_of).length} 项 · 待审 {project.tasks.filter(task => task.status === 'review').length} 项</span>}
    </span><span className="ui-rd-task-meta"><strong>{daysLabel(project, preview.as_of)}</strong><small>业务持有天数</small><span>{modelLabel(project)}</span><small>{project.lifecycle === 'active' ? '当前模型收益估算' : lifecycleLabels[project.lifecycle]}</small></span>
  </button>;
  const ledger = <div className="ui-ld-table-scroll"><table className="ui-ld-table" aria-label="T 项目经营账簿"><thead><tr><th scope="col">房屋 / 阶段</th><th scope="col">登记投入规模</th><th scope="col">当前模型收益估算</th><th scope="col">业务持有时间</th><th scope="col">当前问题</th></tr></thead><tbody>{rows.map(project => <tr key={project.id} data-selected={selected?.id === project.id}>
    <td><button aria-pressed={selected?.id === project.id} onClick={() => choose(project)}>{project.name}</button><div>{project.stage}</div></td>
    <td className="ui-sd-money">{project.lifecycle === 'active' ? money(investedScale(project)) : '不计入进行中汇总'}</td>
    <td className="ui-sd-money">{modelLabel(project)}</td><td>{daysLabel(project, preview.as_of)}</td>
    <td>{project.issues.length ? project.issues.map(kind => issueLabels[kind]).join('、') : '未记录问题'}</td>
  </tr>)}</tbody></table></div>;
  const issuesView = <>{(Object.keys(issueLabels) as Issue[]).map(kind => {
    const group = rows.filter(project => project.issues.includes(kind));
    return group.length ? <section className="ui-rd-task-group" key={kind}><h3>{issueLabels[kind]} <small>{group.length} 套</small></h3>{group.map(project => projectButton(project, false, kind === 'progress' ? '推进与节点' : '经营依据'))}</section> : null;
  })}{rows.some(project => !project.issues.length) && <section className="ui-rd-task-group"><h3>未记录问题</h3>{rows.filter(project => !project.issues.length).map(project => projectButton(project))}</section>}
    <p className="ui-rd-caption">同一房屋可涉及多个问题，顶部金额与套数按房去重。分组源于样例记录，不是自动风险评分。</p></>;
  const flow = <>
    <div className="ui-rd-section-heading"><h3>阶段分布</h3><div className="ui-rd-tabs" role="group" aria-label="阶段分布指标"><button aria-pressed={distribution === 'count'} onClick={() => setDistribution('count')}>房屋数</button><button aria-pressed={distribution === 'invested'} onClick={() => setDistribution('invested')}>进行中登记投入</button></div></div>
    <p className="ui-rd-caption">分布范围：当前搜索与项目／问题筛选内 {base.length} 套。{distribution === 'invested' && `登记投入覆盖其中 ${baseTotals.investedKnown}/${baseTotals.active} 套进行中项目。`}点击阶段，筛选下方汇总与房屋；非历史趋势。</p>
    <div className="ui-ld-stage-list" role="group" aria-label="点击阶段查看项目">{stageRows.map(group => <button className="ui-ld-stage-button" key={group.label} aria-pressed={stage === group.label} onClick={() => { setStage(stage === group.label ? 'all' : group.label); setDetailOpen(false); }}>
      <span>{group.label}</span><svg viewBox="0 0 360 28" width={360} height={28} aria-hidden="true"><rect x={0} y={4} width={group.value / maxValue * 360} height={20} fill="currentColor" /></svg>
      <span>{distribution === 'count' ? `${group.projects.length} 套` : group.totals.investedKnown ? money(group.totals.invested) : '无可汇总金额'}</span>
    </button>)}</div>
    {summary}{rows.map(project => <section key={project.id} className="ui-rd-task-group">{projectButton(project, true, '推进与节点')}{project.tasks.filter(task => task.status === 'review').map(task => <button key={task.id} className="ui-rd-resource" onClick={() => choose(project, '推进与节点')}><span>{task.title} · {task.owner}</span><span>当前批次待审 {reviewAge(task, preview.as_of) == null ? '日期未齐' : `${reviewAge(task, preview.as_of)} 天`}</span></button>)}</section>)}
    <p className="ui-rd-caption">持有时间从业务买入日期计算，已售截至售出日；待审时间来自当前提交批次。计划完工日期不当作实际完工，也不按这些数字给员工排名。</p>
  </>;
  const main = <div className="ui-rd-main"><header className="ui-rd-work-header"><div><h2>{design.title}</h2><p>从全部项目看经营事实，再进入具体房屋与依据。</p></div></header>
    <p className="ui-rd-caption">合成数据切面 · 截至 {preview.as_of}。这里只比较管理视角，不操作项目或审批。</p>
    {toolbar}<div className="ui-rd-section-heading"><span>阶段：{stage === 'all' ? '全部' : stage}</span><Button onClick={clear}>清除全部筛选</Button></div>
    {design.id === 'C' ? flow : <>{summary}{design.id === 'A' ? ledger : issuesView}</>}
    {!rows.length && <p className="ui-rd-empty">没有符合这些条件的房屋。清除筛选可返回全部项目。</p>}
  </div>;
  const detail = selected ? <LeadershipProjectDetail sectionRequestId={sectionRequestId} project={selected} asOf={preview.as_of} initialSection={detailSection} /> : <p className="ui-rd-empty">选择一套房，查看估算构成、日期、任务与原始资料。</p>;
  return <CollaborationWorkspace main={main} detail={detail} detailOpen={detailOpen && !!selected} onBack={() => setDetailOpen(false)} />;
}
