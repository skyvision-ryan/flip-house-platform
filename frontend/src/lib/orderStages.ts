import { m as uiText } from '../i18n/core.ts';
import type { ProcurementItem } from '../api/client';
import type { OrderLine, PurchaseOrder } from './purchaseOrders';

export type ProcurementNode = Pick<ProcurementItem, 'id' | 'project_id' | 'wave' | 'name'>;
export type NodeOption = { value: string; label: string };
export interface OrderStage {
  value: string; label: string;
  lines: { line: OrderLine; material?: ProcurementNode }[];
}

/** Derive nodes from the existing material rows. Never create a second order. */
export function orderStages(lines: OrderLine[], projectId: number, materials: ProcurementNode[], nodes: NodeOption[]): OrderStage[] {
  const byId = new Map(materials.filter(m => m.project_id === projectId).map(m => [m.id, m]));
  const groups = new Map<string, OrderStage>();
  for (const line of lines) {
    const material = byId.get(line.material_id);
    const value = material?.wave ?? 'unmapped';
    if (!groups.has(value)) groups.set(value, { value, label: nodes.find(n => n.value === value)?.label ?? uiText("orderStages.procurement.items.need.verification"), lines: [] });
    groups.get(value)!.lines.push({ line, material });
  }
  const rank = (key: string) => { const index = nodes.findIndex(n => n.value === key); return index < 0 ? nodes.length : index; };
  return [...groups.values()].sort((a, b) => rank(a.value) - rank(b.value));
}

export function stageFacts(order: PurchaseOrder, stage: OrderStage) {
  const ids = new Set(stage.lines.map(l => l.line.id));
  const rows = order.summary.lines.filter(l => ids.has(l.id));
  const deliveries = order.document.deliveries.filter(d => d.allocations.some(a => ids.has(a.line_id)));
  const cancelled = stage.lines.every(({ line }) => line.quantity != null && Number(line.cancelled_quantity) >= Number(line.quantity));
  const complete = !cancelled && rows.length === stage.lines.length && rows.every(l => l.remaining != null && Number(l.remaining) === 0);
  const dates = [...new Set([...deliveries.map(d => d.expected_on), ...stage.lines.map(l => l.line.expected_on)].filter((d): d is string => !!d))].sort();
  return { rows, deliveries, complete, cancelled, dates };
}
