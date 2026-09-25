import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type ProcurementItem } from '../api/client';
import { dateTime } from '../lib/format';
import { shipmentStatuses, trackingFlag, trackingReason } from '../lib/procurement';
import { Table } from './ui/Surface';

type TrackingItem = ProcurementItem & { project_name: string };
export default function ProcurementTracker({ onSelect }: { onSelect?: (id: number) => void }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<TrackingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [project, setProject] = useState('');
  const [retailer, setRetailer] = useState('');
  const [filter, setFilter] = useState('attention');
  const [page, setPage] = useState(1);
  const load = async () => { setLoading(true); try { const data = await api.procurementTracking(); setItems(data.items); setError(''); } catch (e) { setError((e as Error).message); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const tracked = items.filter(item => item.order_number || item.order_url || item.tracking_number || item.tracking_url || item.status === 'ordered' || item.status === 'exception');
  const scoped = tracked.filter(item => (!project || String(item.project_id) === project) && (!retailer || item.retailer === retailer));
  const filters = [{ value: 'attention', label: '待跟进' }, { value: 'upcoming', label: '近期到货' }, { value: 'unverified', label: '未核对' }, { value: 'all', label: '全部' }];
  const rows = scoped.filter(item => filter === 'all' || trackingFlag(item, today) === filter);
  const projects = [{ value: '', label: '全部房屋' }, ...Array.from(new Map(items.map(item => [item.project_id, item.project_name]))).map(([id, name]) => ({ value: String(id), label: name }))];
  const retailers = [{ value: '', label: '全部商家' }, ...Array.from(new Set(tracked.map(item => item.retailer).filter((value): value is string => !!value))).sort().map(value => ({ value, label: value }))];
  const pageCount = Math.max(1, Math.ceil(rows.length / 6));
  const activePage = Math.min(page, pageCount);
  if (error) return <Alert type="error" action={<Button onClick={load}>重试</Button>}>{error}</Alert>;
  const orderLink = (url: string | null, label: string) => url ? <Link href={url} external externalIconAriaLabel="在新标签页打开">{label}</Link> : null;
  return <SpaceBetween size="m">
    <Box color="text-body-secondary">人工更新 · Jeremy / Tristin 共用 · 按采购项显示，同一订单的多件材料分别跟进。未连接商家自动同步。</Box>
    <div className="ui-proc-toolbar">
      <Select ariaLabel="订单房屋筛选" options={projects} selectedOption={projects.find(p => p.value === project)!} onChange={({ detail }) => { setProject(detail.selectedOption.value!); setPage(1); }} />
      <Select ariaLabel="订单商家筛选" options={retailers} selectedOption={retailers.find(p => p.value === retailer) ?? retailers[0]} onChange={({ detail }) => { setRetailer(detail.selectedOption.value!); setPage(1); }} />
      <Button loading={loading} onClick={load}>刷新记录</Button>
    </div>
    <SpaceBetween direction="horizontal" size="xs">{filters.map(f => <Button key={f.value} variant={filter === f.value ? 'primary' : 'normal'} onClick={() => { setFilter(f.value); setPage(1); }}>{f.label} {f.value === 'all' ? scoped.length : scoped.filter(item => trackingFlag(item, today) === f.value).length}</Button>)}</SpaceBetween>
    <Table<TrackingItem> variant="embedded" loading={loading} loadingText="正在加载采购跟进记录" items={rows.slice((activePage - 1) * 6, activePage * 6)} trackBy="id"
      empty={<Box padding="m">{tracked.length ? '当前筛选下没有采购项。可切换“全部”查看。' : '尚未登记订单。在采购工作台补充商家、订单号或订单链接后，这里会集中显示。'}</Box>}
      pagination={<Pagination currentPageIndex={activePage} pagesCount={pageCount} onChange={({ detail }) => setPage(detail.currentPageIndex)} ariaLabels={{ nextPageLabel: '下一页订单', previousPageLabel: '上一页订单', pageLabel: n => `第 ${n} 页订单` }} />}
      columnDefinitions={[
        { id: 'item', header: '房屋 / 材料', minWidth: 180, cell: row => <div><Box color="text-body-secondary">{row.project_name}</Box><Button variant="inline-link" onClick={() => onSelect ? onSelect(row.id) : navigate(`/procurement?project=${row.project_id}&item=${row.id}`)}>{row.name}</Button></div> },
        { id: 'order', header: '商家 / 订单', minWidth: 140, cell: row => <SpaceBetween size="xxs"><span>{row.retailer ?? '未填商家'} · {row.order_number ?? '未填订单号'}</span>{orderLink(row.order_url, '打开订单')}</SpaceBetween> },
        { id: 'tracking', header: '物流 / 预计到货', minWidth: 170, cell: row => <SpaceBetween size="xxs"><span>{shipmentStatuses.find(s => s.value === row.shipment_status)?.label ?? '物流未核实'} · {row.expected_on ?? '交期待确认'}</span><span>{row.carrier} {row.tracking_number}</span>{orderLink(row.tracking_url, '查看物流')}</SpaceBetween> },
        { id: 'followup', header: '需要处理', minWidth: 180, cell: row => trackingReason(row, today) },
        { id: 'checked', header: '最近人工核对', minWidth: 150, cell: row => <div>{row.checked_at ? dateTime(row.checked_at) : '未核对'}<div><Button variant="inline-link" onClick={() => onSelect ? onSelect(row.id) : navigate(`/procurement?project=${row.project_id}&item=${row.id}`)}>更新跟进</Button></div></div> },
      ]} />
  </SpaceBetween>;
}
