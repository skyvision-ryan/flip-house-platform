import { Fragment, useState } from 'react';
import Button from '@cloudscape-design/components/button';
import type { RoleDesign, SpecialistPreview } from '../../lib/roleDesigns';
import CollaborationWorkspace from '../ui/CollaborationWorkspace';

type RecordItem = SpecialistPreview['records'][number];
const categories = ['全部', '图纸资料', 'Permit 资料', '检查记录'];
const statuses = ['待补资料', '未通过', '等待回复', '进行中', '已预约', '已上传', '已通过'];

/** One synthetic dataset, three ways to find Zoey's work. Never calls a business API. */
export default function ZoeyDesign({ preview, design }: { preview: SpecialistPreview; design: RoleDesign }) {
  const [houseId, setHouseId] = useState(preview.houses[0]?.id ?? '');
  const [selectedId, setSelectedId] = useState(preview.records[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [status, setStatus] = useState('全部');
  const [detailOpen, setDetailOpen] = useState(false);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const byHouse = design.layout === 'zoey-house';
  const register = design.layout === 'zoey-register';
  const houseName = (id: string) => preview.houses.find(h => h.id === id)?.name ?? id;
  const queryText = query.trim().toLowerCase();
  const rows = preview.records.filter(record => (!byHouse || record.house === houseId)
    && (category === '全部' || category === record.category)
    && (status === '全部' || status === record.status)
    && `${houseName(record.house)} ${record.title} ${record.category} ${record.owner} ${record.detail} ${record.documents.map(doc => doc.name).join(' ')}`.toLowerCase().includes(queryText));
  const selected = rows.find(record => record.id === selectedId);
  const document = selected?.documents.find(doc => doc.id === documentId);
  const house = preview.houses.find(item => item.id === houseId);
  const openRecord = (record: RecordItem, docId: string | null = null) => {
    setSelectedId(record.id);
    setHouseId(record.house);
    setDocumentId(docId);
    setEditing(false);
    setNotice('');
    setDetailOpen(true);
  };
  const chooseHouse = (id: string) => {
    setHouseId(id);
    setCategory('全部');
    setStatus('全部');
    setQuery('');
    setSelectedId(preview.records.find(record => record.house === id)?.id ?? '');
    setDocumentId(null);
    setEditing(false);
    setNotice('');
    setDetailOpen(false);
  };
  const listRow = (record: RecordItem) => <button key={record.id} className="ui-rd-task" aria-pressed={record.id === selectedId} onClick={() => openRecord(record)}>
    <span><small>{houseName(record.house)} · {record.category}</small><strong>{record.title}</strong><span>{record.detail}</span></span>
    <span className="ui-rd-task-meta"><strong>{record.status}</strong><span>{record.owner}</span><span>{record.documents.length ? `${record.documents.length} 份文件` : '无附件'}</span></span>
  </button>;
  const controls = <>
    <div className="ui-rd-toolbar"><label>搜索房屋、事项或文件<input value={query} onChange={event => setQuery(event.target.value)} placeholder="例如 Oak、Final、申请回执" /></label>
      <div role="group" aria-label="筛选 Zoey 记录状态">{['全部', '待补资料', '未通过', '等待回复', '已预约'].map(value => <button key={value} aria-pressed={status === value} onClick={() => setStatus(value)}>{value}</button>)}</div>
    </div>
    <div className="ui-rd-tabs" role="group" aria-label="筛选 Zoey 资料类别">{categories.map(value => <button key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>{value}</button>)}</div>
  </>;
  const content = <>
    {controls}
    <div className="ui-rd-section-heading"><h3>{byHouse ? `${house?.name ?? '房屋'} · 设计与 Permit` : register ? '资料与对应记录' : '跨房跟进事项'}</h3><span>{rows.length} 条记录</span></div>
    {!rows.length ? <div className="ui-rd-empty"><p>没有符合条件的记录。</p><Button onClick={() => { setQuery(''); setCategory('全部'); setStatus('全部'); }}>清除筛选</Button></div>
      : register ? <div className="ui-sd-table-scroll"><table className="ui-sd-ledger"><caption className="ui-sr-only">Zoey 的资料及检查记录，点击文件名查看对应资料</caption><thead><tr><th>文件 / 记录</th><th>房屋</th><th>类别</th><th>记录现况</th></tr></thead><tbody>
        {rows.flatMap(record => record.documents.length ? record.documents.map(doc => <tr key={`${record.id}:${doc.id}`}><td><button className="ui-sd-link" aria-pressed={selectedId === record.id && documentId === doc.id} onClick={() => openRecord(record, doc.id)}>{doc.name}</button><small>{record.title}</small></td><td>{houseName(record.house)}</td><td>{record.category}</td><td>{record.status}</td></tr>)
          : [<tr key={record.id}><td><button className="ui-sd-link" aria-pressed={selectedId === record.id} onClick={() => openRecord(record)}>{record.title}</button><small>无附件 · 查看原始记录</small></td><td>{houseName(record.house)}</td><td>{record.category}</td><td>{record.status}</td></tr>])}
      </tbody></table></div>
        : byHouse ? rows.map(listRow) : statuses.map(value => { const group = rows.filter(record => record.status === value); return group.length ? <section className="ui-rd-task-group" key={value}><h3>{value} <small>{group.length}</small></h3>{group.map(listRow)}</section> : null; })}
  </>;
  const main = <div className="ui-rd-main"><header className="ui-rd-work-header"><div><small>Permit / 设计 · 合成工作界面</small><h2>{design.title}</h2><p>先知道房屋在哪个阶段，再查图纸、申请资料与检查事实。</p></div></header>
    {byHouse ? <div className="ui-rd-house-layout"><nav aria-label="Zoey 示例房屋导航">{preview.houses.map(item => <button key={item.id} aria-pressed={houseId === item.id} onClick={() => chooseHouse(item.id)}><strong>{item.name}</strong><small>{item.stage}</small></button>)}</nav><section>{content}</section></div>
      : <><div className="ui-sd-project-strip" aria-label="示例房屋概况">{preview.houses.map(item => <span key={item.id}><strong>{item.name}</strong><small>{item.stage}</small></span>)}</div>{content}</>}
  </div>;
  const detail = selected ? <div className="ui-rd-detail"><small>{houseName(selected.house)} · {preview.houses.find(item => item.id === selected.house)?.stage}</small><h2>{selected.title}</h2><strong>{selected.status}</strong><p>{selected.detail}</p>
    <dl className="ui-rd-facts"><dt>负责记录</dt><dd>{selected.owner}</dd><dt>来源</dt><dd>{selected.source}</dd>{selected.fields.map((field, index) => <Fragment key={`${field.label}:${index}`}><dt>{field.label}</dt><dd>{field.value}</dd></Fragment>)}</dl>
    <h3>这条记录的资料</h3>{selected.documents.length ? selected.documents.map(doc => <button key={doc.id} className="ui-rd-resource" aria-pressed={documentId === doc.id} onClick={() => setDocumentId(documentId === doc.id ? null : doc.id)}>{doc.name}<span>{documentId === doc.id ? '收起资料' : '查看资料 →'}</span></button>) : <p>这条记录没有附件，不显示其他房屋或其他记录的文件。</p>}
    {document && <div className="ui-rd-file"><h3>{document.name}</h3><p>{houseName(selected.house)} · {selected.title}</p><p>{document.detail}</p><p>合成资料预览，不下载或打开真实文件。</p><Button onClick={() => setDocumentId(null)}>关闭这份资料</Button></div>}
    <h3>补充备注</h3><p>{notes[selected.id] ?? '本次预览尚未添加备注。'}</p>
    <Button variant="primary" onClick={() => { setDraft(notes[selected.id] ?? ''); setEditing(!editing); setNotice(''); }}>{editing ? '取消编辑' : '编辑预览备注'}</Button>
    {editing && <div className="ui-rd-edit"><label>仅针对 {selected.title}<textarea maxLength={500} value={draft} onChange={event => setDraft(event.target.value)} /></label><Button onClick={() => { setNotes(previous => ({ ...previous, [selected.id]: draft.trim() || '未填写补充备注。' })); setEditing(false); setNotice(`「${selected.title}」的备注已保存在本次预览，切方案可继续查看。`); }}>保存到本次预览</Button></div>}
    {notice && <p role="status">{notice}</p>}
    <p className="ui-muted">仅比较信息与资料入口；备注不改变检查结果、任务状态或 D/J 关键确认。</p>
  </div> : <p className="ui-rd-empty">当前记录不在筛选结果中，请从列表选择一项。</p>;
  return <><CollaborationWorkspace main={main} detail={detail} detailOpen={detailOpen && !!selected} onBack={() => setDetailOpen(false)} /><p className="ui-rd-caption">现有资料基础：图纸与 Permit 文件类型、任务及等待记录、检查日期 / 结果 / 整改人 / 备注。三种聚合工作界面是本次设计提案；没有新增政府审批状态、预计许可时长或图纸版本审批。申请回执不等于核发 Permit；Final 仍以最近一次 Final 检查及 D/J 规则为准。</p></>;
}
