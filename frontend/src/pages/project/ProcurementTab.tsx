import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type ProcurementList, type Project } from '../../api/client';
import Header from '../../components/ui/Header';
import { Table } from '../../components/ui/Surface';
import { procurementWorkGroup } from '../../lib/procurement';
import { useMeta } from '../../lib/meta';

/** Project context is a status summary. Daily procurement writes live in the workspace. */
export default function ProcurementTab({ project, initialItemId }: { project: Project; initialItemId?: number }) {
  const navigate = useNavigate();
  const meta = useMeta();
  const [data, setData] = useState<ProcurementList | null>(null);
  const [error, setError] = useState('');
  const load = async () => { try { setData(await api.procurement(project.id)); setError(''); } catch (e) { setError((e as Error).message); } };
  useEffect(() => { void load(); }, [project.id]);
  const href = `/procurement?project=${project.id}${initialItemId ? `&item=${initialItemId}` : ''}`;
  if (error) return <Alert type="error" action={<Button onClick={load}>重试</Button>}>{error}</Alert>;
  if (!data) return <Spinner />;
  const summary = data.summary;
  const exceptions = data.items.filter(i => procurementWorkGroup(i) === 'exceptions');
  const waves = (meta?.procurement_waves ?? []).filter(w => data.items.some(item => item.wave === w.value));
  return <SpaceBetween size="m">
    <Header variant="h2" description="这里查看本房采购进展。材料、订单、图片与物流记录在采购工作台维护。" actions={<Button onClick={() => navigate(href)}>打开采购工作台</Button>}>采购概况</Header>
    <Box>共 {summary.total} 项 · 待选型 {summary.pending_spec} · 待下单 {summary.pending_order} · 已下单 {summary.ordered} · 已到货 {summary.received} · 待异常跟进 {exceptions.length}</Box>
    <Table variant="embedded" items={waves} trackBy="value" empty={<Box>还没有采购记录，请在工作台建立材料清单。</Box>} columnDefinitions={[
      { id: 'wave', header: '使用节点', cell: w => w.label },
      { id: 'open', header: '待选型 / 下单', cell: w => data.items.filter(i => i.wave === w.value && ['pending_spec', 'pending_order'].includes(i.status)).length },
      { id: 'ordered', header: '已下单', cell: w => data.items.filter(i => i.wave === w.value && i.status === 'ordered').length },
      { id: 'received', header: '已到货', cell: w => data.items.filter(i => i.wave === w.value && i.status === 'received').length },
      { id: 'exception', header: '异常', cell: w => exceptions.filter(i => i.wave === w.value).length },
    ]} />
    {exceptions.map(i => <Box key={i.id}>{i.name}：{i.follow_up || i.note || '异常待采购跟进'}</Box>)}
  </SpaceBetween>;
}
