import { useState } from 'react';
import Button from '@cloudscape-design/components/button';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '../components/ui/Header';
import EmployeeAvatar from '../components/ui/EmployeeAvatar';

const directions = [
  { id: 'linear', name: 'B · Linear', label: '连续工作区', idea: '列表与摘要共用一块连续平面，用留白和分隔线建立层次。', gain: '看任务、看背景时视线不中断。', cost: '区块边界更轻，需要明确选中状态。', source: 'https://linear.app/features', applied: true },
  { id: 'jira', name: 'Jira / Atlassian', label: '按状态分组', idea: '先看进行中、等待和待确认，再展开具体任务。', gain: '例会能很快找到卡在哪里。', cost: '跨状态比较负责人或截止日期要切换分组。', source: 'https://www.atlassian.com/software/jira/features' },
  { id: 'shadcn', name: 'shadcn/ui', label: '简洁任务清单', idea: '压缩工具栏，把搜索、状态与每项任务放在同一条阅读线上。', gain: '个人每天处理少量任务更直接。', cost: '大批量项目对照时，信息比表格少。', source: 'https://ui.shadcn.com/examples/tasks' },
  { id: 'carbon', name: 'IBM Carbon', label: '结构化表格', idea: '强调固定列、对齐和紧凑行距，把状态、证据、截止直接列出。', gain: '适合大量事项的核对与比较。', cost: '桌面更有效率，手机要逐项展开。', source: 'https://carbondesignsystem.com/components/data-table/usage/' },
  { id: 'fluent', name: 'Fluent 2', label: '人员与交接', idea: '把负责人、等待对象和最近动态放在任务附近，用分区底色强调协作。', gain: '先知道找谁、等谁，便于接手工作。', cost: '每行更高，同屏能看到的任务较少。', source: 'https://fluent2.microsoft.design/' },
  { id: 'mantine', name: 'Mantine', label: '紧凑筛选工具', idea: '用清楚的筛选按钮和侧栏摘要组织任务，适合快速缩小范围。', gain: '筛选和选项容易发现。', cost: '控件更多，要克制页面上的操作数量。', source: 'https://mantine.dev/' },
];
const sample = [
  { id: 1, title: '开通水电与燃气', status: '进行中', evidence: '未满足', due: '09/25', person: 'Alex', role: '项目助理', note: '水、电已开通；等待燃气公司确认到场时间。', event: '今天 10:20 · Alex 更新了办理进展', color: 1 },
  { id: 2, title: '补齐房屋保险单', status: '等待中', evidence: '未满足', due: '09/25', person: 'Morgan', role: '项目助理', note: '等待保险经纪人补发带到期日的保险单。', event: '今天 09:45 · Morgan 记录等待回复', color: 2 },
  { id: 3, title: '确认厨房材料到货', status: '待确认', evidence: '已满足', due: '09/26', person: 'Taylor', role: '采购', note: '到货照片已提交，等待审核人确认本次交付。', event: '昨天 16:30 · Taylor 提交了到货记录', color: 3 },
  { id: 4, title: '整理 Permit 申请资料', status: '进行中', evidence: '未满足', due: '09/27', person: 'Jordan', role: 'Permit/设计', note: '设计定稿已备齐，正在整理申请文件。', event: '昨天 15:10 · Jordan 开始处理', color: 4 },
];
export default function DesignChoices() {
  const [direction, setDirection] = useState('linear');
  const [picked, setPicked] = useState(1);
  const [filter, setFilter] = useState('全部');
  const [query, setQuery] = useState('');
  const [choice, setChoice] = useState(() => localStorage.getItem('fh-design-preference') ?? '');
  const [detailTab, setDetailTab] = useState('详情');
  const [mobileDetail, setMobileDetail] = useState(false);
  const current = directions.find((d) => d.id === direction)!;
  const task = sample.find((t) => t.id === picked)!;
  const rows = sample.filter((t) => (filter === '全部' || t.status === filter) && `${t.title} ${t.person}`.toLowerCase().includes(query.toLowerCase()));
  const avatar = (t: typeof task) => <EmployeeAvatar size="small" user={{ id: t.color, display_name: t.person, role_code: t.role, username: t.person.toLowerCase(), active: true }} />;
  const row = (t: typeof task) => <button key={t.id} className="ui-design-row" aria-pressed={picked === t.id} onClick={() => { setPicked(t.id); setMobileDetail(true); }}>
    <span className="ui-design-task"><strong>{t.title}</strong>{direction === 'fluent' && <small>{t.note}</small>}</span>
    <span className="ui-design-person">{avatar(t)}<span>{t.person}</span></span>
    <span className="ui-design-state">{t.status}</span><span className="ui-design-evidence">{t.evidence}</span><span className="ui-design-due">{t.due}</span>
  </button>;
  return <ContentLayout maxContentWidth={1440} header={<Header variant="h1" description="同一组示例任务，比较不同的信息组织方式。B 已用于实际页面；下面的选择仅记录你的偏好。">设计比较</Header>}>
    <div className="ui-design-chooser" role="group" aria-label="选择参考方向">{directions.map((d) => <button key={d.id} aria-pressed={d.id === direction} onClick={() => { setDirection(d.id); setMobileDetail(false); }}><span>{d.name}</span><strong>{d.label}</strong>{d.applied && <small>已应用</small>}</button>)}</div>
    <div className="ui-design-caption"><div><h2>{current.label}</h2><p>{current.idea}</p><p><strong>适合：</strong>{current.gain} <strong>取舍：</strong>{current.cost}</p></div><a href={current.source} target="_blank" rel="noreferrer">查看参考来源 ↗</a></div>
    <section className={`ui-design-preview ui-design-${direction}`} aria-label={`${current.name} 交互示例`}>
      <header className="ui-design-project"><div><small>示例房屋 · 装修阶段</small><h2>Maple House</h2></div><span>4 项任务 · 1 项待确认</span></header>
      <div className="ui-design-toolbar"><label><span className="ui-sr-only">搜索示例任务</span><input placeholder="搜索任务或负责人" value={query} onChange={(e) => setQuery(e.target.value)} /></label><div role="group" aria-label="筛选示例状态">{['全部', '进行中', '等待中', '待确认'].map((s) => <button key={s} aria-pressed={filter === s} onClick={() => setFilter(s)}>{s}</button>)}</div></div>
      <div className="ui-design-body" data-detail-open={mobileDetail}>
        <div className="ui-design-list"><div className="ui-design-columns"><span>任务</span><span>负责人</span><span>状态</span><span>证据</span><span>截止</span></div>
          {direction === 'jira' ? ['进行中', '等待中', '待确认'].map((s) => <section key={s}><h3>{s} <small>{rows.filter((t) => t.status === s).length}</small></h3>{rows.filter((t) => t.status === s).map(row)}</section>) : rows.map(row)}
          {!rows.length && <p className="ui-design-empty">没有匹配的任务。试试其他关键词或选择“全部”。</p>}
        </div>
        <aside className="ui-design-detail"><div className="ui-design-mobile-back"><Button iconName="arrow-left" onClick={() => setMobileDetail(false)}>返回示例列表</Button></div><small>任务摘要</small><h2>{task.title}</h2><div className="ui-design-person">{avatar(task)}<strong>{task.person}</strong><span>{task.role}</span></div>
          <div className="ui-design-detail-tabs" role="group" aria-label="示例摘要内容">{['详情', '活动记录'].map((s) => <button key={s} aria-pressed={detailTab === s} onClick={() => setDetailTab(s)}>{s}</button>)}</div>
          {detailTab === '详情' ? <><dl><div><dt>执行状态</dt><dd>{task.status}</dd></div><div><dt>证据判定</dt><dd>{task.evidence}</dd></div><div><dt>截止日期</dt><dd>{task.due}</dd></div></dl><p>{task.note}</p><p className="ui-muted">证据满足与任务确认分开记录。</p></> : <p>{task.event}</p>}
          <Button variant="primary" onClick={() => setDetailTab(detailTab === '详情' ? '活动记录' : '详情')}>{detailTab === '详情' ? '查看最新进展' : '返回任务详情'}</Button>
        </aside>
      </div>
    </section>
    <div className="ui-design-decision"><div><strong>{choice ? `已记录偏好：${directions.find((d) => d.id === choice)?.name ?? choice}` : '先试着筛选、点任务，再选偏好'}</strong><p>参考方向的适配草图，沿用项目字体和头像；未切换组件库。偏好仅保存在本机。</p></div><Button onClick={() => { setChoice(direction); localStorage.setItem('fh-design-preference', direction); }}>我倾向于 {current.name}</Button></div>
  </ContentLayout>;
}
