import { Fragment, useEffect, useState } from 'react';
import Button from '@cloudscape-design/components/button';
import { currentAnalysis, holdingDays, investedScale, leadershipMoney as money, overdueTasks, reviewAge, type LeadershipProject } from '../../lib/leadershipDesign';
const statuses = { todo: '未开始', doing: '进行中', waiting: '等待中', review: '待审核', done: '已完成', na: '不适用' };

export default function LeadershipProjectDetail({ project: p, asOf, initialSection = '经营依据', sectionRequestId = 0 }: { project: LeadershipProject; asOf: string; initialSection?: string; sectionRequestId?: number }) {
  const [section, setSection] = useState(initialSection);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { setSection(initialSection); }, [p.id, initialSection, sectionRequestId]);
  useEffect(() => { setDocumentId(null); setEditing(false); setNotice(''); }, [p.id]);
  const model = currentAnalysis(p);
  const days = holdingDays(p, asOf);
  const file = p.documents.find(d => d.id === documentId);
  return <div className="ui-rd-detail">
    <h2>{p.name}</h2><p>{p.stage} · 协调人 {p.coordinator}</p>
    <h3>当前关注</h3><p>{p.concern}</p><h3>下一步核对</h3><p>{p.next_action}</p>
    <div className="ui-rd-tabs" role="group" aria-label="项目依据页签">{['经营依据', '推进与节点', '资料与记录'].map(s => <button key={s} aria-pressed={section === s} onClick={() => setSection(s)}>{s}</button>)}</div>
    {section === '经营依据' && <>
      <dl className="ui-rd-facts"><dt>买入价</dt><dd>{money(p.purchase_price)}</dd><dt>已登记支出</dt><dd>{money(p.expenses)}</dd><dt>预算</dt><dd>{money(p.budget)}</dd><dt>预算减登记支出</dt><dd>{money(p.budget == null || p.expenses == null ? null : p.budget - p.expenses)}</dd><dt>买价＋登记支出</dt><dd>{p.lifecycle === 'lead' ? '未购入，不计入' : money(investedScale(p))}</dd><dt>金额记录日期</dt><dd>{p.financial_updated_at}</dd></dl>
      <p className="ui-rd-caption">来源：项目买入价、预算行、支出登记。买价加登记支出表示融资前项目规模，未扣贷款及回款；不是现金余额或股东实际投入。</p>
      {p.lifecycle === 'closed' ? <><h3>结算尚待核对</h3><dl className="ui-rd-facts"><dt>记录成交价</dt><dd>{money(p.sale_price)}</dd><dt>实际净利润 / 净回款</dt><dd>待补完整结算及到账依据</dd></dl><p>成交价不等于到账；历史估算不转为已实现利润。</p></> : <>
        <h3>{p.lifecycle === 'lead' ? '线索分析假设' : '当前模型预计利润'}</h3>
        <p className="ui-ld-amount">{model?.outputs && !model.missing.length ? money(model.outputs.total_profit) : '资料未齐，不计算'}</p>
        <p>{model ? `${model.label} · ${model.recorded_at}` : '未找到唯一的当前测算版本'}</p>
        {model?.missing.length ? <p>待补：{model.missing.join('、')}</p> : null}
        {model?.outputs && !model.missing.length && <><dl className="ui-rd-facts"><dt>预计售价</dt><dd>{money(model.outputs.sale_price)}</dd><dt>购入含附加费</dt><dd>{money(model.outputs.purchase_total)}</dd><dt>装修假设</dt><dd>{money(model.outputs.rehab_total)}</dd><dt>持有含模型利息</dt><dd>{money(model.outputs.holding_total)}</dd><dt>销售成本假设</dt><dd>{money(model.outputs.selling_total)}</dd></dl><p>公式：预计售价 − 购入费用 − 装修 − 持有及利息 − 销售费用。仅为此版本完整输入下的模型估算；不与登记支出再加一次。</p></>}
        {model && <details><summary>展开输入假设与来源</summary>{model.assumptions.map(a => <Fragment key={a.label}><h4>{a.label} · {a.value}</h4><p>{a.source}</p></Fragment>)}</details>}
      </>}
    </>}
    {section === '推进与节点' && <>
      <dl className="ui-rd-facts"><dt>{p.lifecycle === 'closed' ? '买入至出售间隔' : '自买入已过'}</dt><dd>{days == null ? '业务日期不完整' : `${days} 天`}</dd><dt>买入日期</dt><dd>{p.purchase_date ?? '未记录'}</dd><dt>计划完工日期</dt><dd>{p.planned_end ?? '未记录'}</dd><dt>逾期未完事项</dt><dd>{overdueTasks(p, asOf).length} 项 · 截至 {asOf}</dd></dl>
      <p>计划日期不是实际完工日期；持有天数反映时间，不代表任务完成比例。</p>
      <h3>{p.gate.title}</h3><p>{p.gate.detail}</p><dl className="ui-rd-facts"><dt>前提事实</dt><dd>{p.gate.prerequisite_met ? '已满足' : '未满足'}</dd><dt>D 确认</dt><dd>{p.gate.d ? '已记录' : '未记录'}</dd><dt>J 确认</dt><dd>{p.gate.j ? '已记录' : '未记录'}</dd></dl>
      <h3>事项与等待依据</h3>{p.tasks.map(t => <section className="ui-ld-task-fact" key={t.id}><h4>{t.title}</h4><p>{statuses[t.status]} · {t.owner}</p><p>截止：{t.due_date ?? '未设置'}{reviewAge(t, asOf) != null ? ` · 当前批次待审 ${reviewAge(t, asOf)} 个日历日` : ''}</p>{t.wait_reason && <p>等待：{t.waiting_for}；{t.wait_reason}</p>}</section>)}
      <p className="ui-rd-caption">任务数与当前批次待审日数用于查积压，不评价个人表现，也不是实际工时。设计预览不执行关键节点确认。</p>
    </>}
    {section === '资料与记录' && <>
      <h3>相关资料</h3>{p.documents.map(d => <button className="ui-rd-resource" key={d.id} aria-expanded={documentId === d.id} onClick={() => setDocumentId(documentId === d.id ? null : d.id)}>{d.name}<span>查看依据</span></button>)}
      {file && <section className="ui-rd-file"><h3>{file.name}</h3><p>{file.detail}</p><p>来源：{file.source}</p><Button onClick={() => setDocumentId(null)}>关闭资料</Button></section>}
      <h3>项目更新</h3>{p.updates.map((u,i) => <section key={i}><h4>{u.date} · {u.title}</h4><p>{u.detail}</p></section>)}
    </>}
    <h3>本次阅读关注点</h3><p>{notes[p.id] ?? '尚未填写。'}</p><Button variant="primary" onClick={() => { setDraft(notes[p.id] ?? ''); setEditing(!editing); setNotice(''); }}>{editing ? '取消编辑' : '记录预览关注点'}</Button>
    {editing && <div className="ui-rd-edit"><label>{p.name} 的关注点<textarea maxLength={500} value={draft} onChange={e=>setDraft(e.target.value)} /></label><Button onClick={()=>{setNotes(n=>({...n,[p.id]:draft.trim()}));setEditing(false);setNotice('已保留在本次预览；不会发消息或写入项目决策记录。');}}>保存到本次预览</Button></div>}{notice && <p role="status">{notice}</p>}
  </div>;
}
