import { materialName } from '../../i18n/templateNames.ts';
import { systemText } from '../../i18n/core.ts';
import { useLanguage } from '../../i18n/LanguageProvider';
import { m as uiText } from '../../i18n/core.ts';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type ProcurementList, type Project, type Task } from '../../api/client';
import Header from '../../components/ui/Header';
import { Table } from '../../components/ui/Surface';
import { procurementNeedsAttention } from '../../lib/procurement';
import { useMeta } from '../../lib/meta';
import ProcurementTask from '../../components/ProcurementTask';
import PurchaseOrderCoverage from '../../components/PurchaseOrderCoverage';
import { type PurchaseOrder } from '../../lib/purchaseOrders';

/** Project-scoped purchasing entry and progress; the workbench is the cross-house view. */
export default function ProcurementTab({ project, initialItemId }: { project: Project; initialItemId?: number }) {
  useLanguage();
  const navigate = useNavigate();
  const meta = useMeta();
  const [data, setData] = useState<ProcurementList | null>(null);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [task, setTask] = useState<Task>();
  const [error, setError] = useState('');
  const load = async () => { try { const [items, purchases, tasks] = await Promise.all([api.procurement(project.id), api.purchaseOrders(project.id), api.projectTasks(project.id)]); setData(items); setOrders(purchases); setTask(tasks.tasks.find(t => t.step_key === 'purchase')); setError(''); } catch (e) { setError((e as Error).message); } };
  useEffect(() => { void load(); }, [project.id]);
  const href = `/procurement?project=${project.id}${initialItemId ? `&item=${initialItemId}` : ''}`;
  if (error) return <Alert type="error" action={<Button onClick={load}>{uiText("addProject.retry")}</Button>}>{systemText(error)}</Alert>;
  if (!data) return <Spinner />;
  const exceptions = data.items.filter(procurementNeedsAttention);
  const waves = (meta?.procurement_waves ?? []).filter(w => data.items.some(item => item.wave === w.value && item.status !== 'na'));
  return <div className="procurement-surface procurement-overview"><SpaceBetween size="m">
    <Header variant="h2" actions={<Button onClick={() => navigate(href)}>{uiText("procurementTab.open.procurement.workspace")}</Button>}>{uiText("procurementTab.property.procurement")}</Header>
    <div className="proc-house-summary"><ProcurementTask task={task} onChanged={load} readOnly /><PurchaseOrderCoverage orders={orders} projectId={project.id} compact /></div>

    {!!exceptions.length && <section className="proc-overview-issues" aria-label={uiText("procurementTab.procurement.actions.needed")}><Header variant="h3">{uiText("procurementTab.action.needed")} {exceptions.length} {uiText("projectPreplan.items")}</Header>{exceptions.map(i => <p key={i.id}><Button variant="inline-link" onClick={()=>navigate(`/procurement?project=${project.id}&item=${i.id}`)}>{materialName(i)}</Button><span>{i.attention_reasons!.join('；')}</span></p>)}</section>}
    <Table variant="embedded" items={waves} trackBy="value" empty={<Box>{uiText("procurementTab.no.procurement.records.yet.create.the.material.list.in")}</Box>} columnDefinitions={[
      { id: 'wave', header: uiText("procurementItemPage.procurement.group"), cell: w => w.label },
      { id: 'open', header: uiText("procurementTab.selection.ordering.needed"), cell: w => data.items.filter(i => i.wave === w.value && ['pending_spec', 'pending_order'].includes(i.status)).length },
      { id: 'ordered', header: uiText("procurementDesign.ordered"), cell: w => data.items.filter(i => i.wave === w.value && i.status === 'ordered').length },
      { id: 'received', header: uiText("procurementTask.all.required.items.ready"), cell: w => data.items.filter(i => i.wave === w.value && i.status === 'received').length },
      { id: 'exception', header: uiText("procurementTab.action.needed.2"), cell: w => exceptions.filter(i => i.wave === w.value).length },
    ]} />
  </SpaceBetween></div>;
}
