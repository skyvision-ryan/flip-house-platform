import { Fragment, useState } from 'react';
import Button from '@cloudscape-design/components/button';
import CollaborationWorkspace from '../ui/CollaborationWorkspace';
import type { RoleDesign, SpecialistPreview } from '../../lib/roleDesigns';
import { filterFinanceRecords, financePreviewTotals, formatFinanceMoney as money, isUnregisteredFinanceRecord as pending } from '../../lib/financeDesign';

type RecordRow = SpecialistPreview['records'][number];

/** Three information architectures over the same synthetic financial records. */
export default function SabrinaDesign({ preview, design }: { preview: SpecialistPreview; design: RoleDesign }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('全部');
  const [houseId, setHouseId] = useState(preview.houses[0]?.id ?? '');
  const [houseFilter, setHouseFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [descending, setDescending] = useState(false);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const houseName = (id: string) => preview.houses.find(house => house.id === id)?.name ?? id;
  const byHouse = design.id === 'C';
  const effectiveHouse = byHouse ? houseId : houseFilter;
  const rows = filterFinanceRecords(preview, query, status, effectiveHouse);
  const sortedRows = descending ? [...rows].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)) : rows;
  const selected = rows.find(row => row.id === selectedId);
  const selectedDocument = selected?.documents.find(document => document.id === documentId);
  const statuses = ['待付款核实', '金额待核', '凭证待补', '已登记'];
  const choose = (row: RecordRow) => {
    setSelectedId(row.id); setHouseId(row.house); setDocumentId(null); setEditing(false); setMessage(''); setDetailOpen(true);
  };
  const clearDetail = () => { setDetailOpen(false); setDocumentId(null); setEditing(false); setMessage(''); };
  const toolbar = <div className="ui-rd-toolbar">
    <label>查找记录<input aria-label="查找财务记录" value={query} placeholder="房屋、费用或供应商" onChange={event => { setQuery(event.target.value); clearDetail(); }} /></label>
    {!byHouse && <label>房屋<select aria-label="财务房屋筛选" value={houseFilter} onChange={event => { setHouseFilter(event.target.value); clearDetail(); }}><option value="all">全部房屋</option>{preview.houses.map(house => <option key={house.id} value={house.id}>{house.name}</option>)}</select></label>}
    <label>核对状态<select aria-label="财务状态筛选" value={status} onChange={event => { setStatus(event.target.value); clearDetail(); }}><option>全部</option>{statuses.map(value => <option key={value}>{value}</option>)}</select></label>
  </div>;
  const recordButton = (row: RecordRow) => <button className="ui-rd-task" key={row.id} aria-pressed={selected?.id === row.id} onClick={() => choose(row)}>
    <span><strong>{row.title}</strong><small>{houseName(row.house)} · {row.category}</small><span>{row.detail}</span></span>
    <span className="ui-rd-task-meta"><strong>{money(row.amount ?? 0)}</strong><small>{row.status}</small>{pending(row) && <small>未计入已登记支出</small>}</span>
  </button>;
  const ledger = <div className="ui-sd-table-scroll"><table className="ui-sd-ledger" aria-label="合成财务支出账簿"><thead><tr><th scope="col">费用 / 房屋</th><th scope="col">类别</th><th scope="col" className="ui-sd-money"><button onClick={() => setDescending(!descending)} aria-label={descending ? '恢复费用默认排序' : '按费用金额从高到低排序'}>金额{descending ? ' ↓' : ''}</button></th><th scope="col">核对状态</th></tr></thead><tbody>{sortedRows.map(row => <tr key={row.id} data-selected={selected?.id === row.id}><td><button aria-pressed={selected?.id === row.id} onClick={() => choose(row)}>{row.title}</button><div>{houseName(row.house)}</div></td><td>{row.category}</td><td className="ui-sd-money">{money(row.amount ?? 0)}{pending(row) && <div>未登记</div>}</td><td>{row.status}</td></tr>)}</tbody></table></div>;
  const houseRecords = preview.records.filter(row => row.house === houseId);
  const { planned, registered: spent, remaining } = financePreviewTotals(houseRecords);
  const main = <div className="ui-rd-main">
    <header className="ui-rd-work-header"><div><h2>{design.title}</h2><p>费用对房屋，金额对单据。先核对事实，再保留说明。</p></div></header>
    <p className="ui-rd-caption">所有金额与单据均为合成样例。当前产品有预算和支出登记；独立付款状态及应付台账尚未实现。</p>
    {byHouse ? <div className="ui-rd-house-layout"><nav aria-label="财务房屋导航">{preview.houses.map(house => <button key={house.id} aria-pressed={houseId === house.id} onClick={() => { setHouseId(house.id); setStatus('全部'); setQuery(''); clearDetail(); }}><strong>{house.name}</strong><small>{house.stage}</small></button>)}</nav><section>
      <div className="ui-rd-house-title"><h2>{houseName(houseId)}</h2><span>本房全部示例记录</span></div>
      <dl className="ui-sd-budget-strip"><div><dt>分类预算</dt><dd>{money(planned)}</dd></div><div><dt>已登记支出</dt><dd>{money(spent)}</dd></div><div><dt>预算减已登记支出</dt><dd>{money(remaining)}</dd></div></dl>
      <p className="ui-rd-caption">差额不表示节约或利润。待付款核实的未登记单据不计入；已登记但金额待核、凭证待补的费用仍计入，等待更正或补件。预算仅含所列分类。</p>
      {toolbar}{rows.map(recordButton)}
    </section></div> : <>{toolbar}<div className="ui-rd-section-heading"><h3>{rows.length} 笔示例记录</h3><span>筛选内已登记支出 {money(financePreviewTotals(rows).registered)}</span></div>
      {design.id === 'A' ? ledger : statuses.map(group => { const groupRows = rows.filter(row => row.status === group); return groupRows.length ? <section className="ui-rd-task-group" key={group}><h3>{group} <small>{groupRows.length}</small></h3>{groupRows.map(recordButton)}</section> : null; })}</>}
    {!rows.length && <p className="ui-rd-empty">没有符合筛选的财务记录。可清空搜索或选择全部状态。</p>}
  </div>;
  const detail = selected ? <div className="ui-rd-detail">
    <h2>{selected.title}</h2><p>{houseName(selected.house)} · {selected.status}</p><p>{selected.detail}</p>
    <dl className="ui-rd-facts"><dt>{pending(selected) ? '待核对单据金额' : '已登记金额'}</dt><dd>{money(selected.amount ?? 0)}</dd><dt>分类预算</dt><dd>{money(selected.planned ?? 0)}</dd><dt>登记与预算之差</dt><dd>{pending(selected) ? '尚未登记，不计算差额' : money((selected.amount ?? 0) - (selected.planned ?? 0))}</dd>{selected.fields.map(field => <Fragment key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></Fragment>)}<dt>记录来源</dt><dd>{selected.source}</dd></dl>
    <h3>关联资料</h3>{selected.documents.length ? selected.documents.map(document => <button key={document.id} className="ui-rd-resource" aria-expanded={documentId === document.id} onClick={() => setDocumentId(documentId === document.id ? null : document.id)}>{document.name}<span>查看内容</span></button>) : <p>这笔记录没有关联凭证。保留缺口，不以支出登记替代凭证。</p>}
    {selectedDocument && <section className="ui-rd-file" aria-label="财务资料预览"><h3>{selectedDocument.name}</h3><p>{selectedDocument.detail}</p><p className="ui-rd-caption">仅用于比较查找资料的路径，非真实文件。</p><Button onClick={() => setDocumentId(null)}>关闭资料预览</Button></section>}
    <h3>核对备注</h3><p>{notes[selected.id] ?? '尚未填写本次预览备注。'}</p>
    <Button variant="primary" onClick={() => { setDraft(notes[selected.id] ?? ''); setEditing(!editing); setMessage(''); }}>{editing ? '取消编辑' : '编辑核对备注'}</Button>
    {editing && <div className="ui-rd-edit"><label>此笔记录的核对备注<textarea maxLength={500} value={draft} onChange={event => setDraft(event.target.value)} /></label><Button onClick={() => { setNotes(value => ({ ...value, [selected.id]: draft.trim() || '尚未填写本次预览备注。' })); setEditing(false); setMessage('备注已保留在本次预览，切换方案可查看；刷新后恢复。'); }}>保存到本次预览</Button></div>}
    {message && <p role="status">{message}</p>}
  </div> : <p className="ui-rd-empty">选择一笔费用，查看金额、预算与关联凭证。</p>;
  return <CollaborationWorkspace main={main} detail={detail} detailOpen={detailOpen && !!selected} onBack={() => setDetailOpen(false)} />;
}
