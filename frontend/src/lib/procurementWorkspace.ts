import type { ProcurementItem, ProcurementWorkspaceData } from '../api/client';
import type { PurchaseOrder } from './purchaseOrders';

/** Every house surface derives from the same selected id, including after refresh. */
export function houseProcurement(data: ProcurementWorkspaceData | null, orders: PurchaseOrder[], house: string) {
  return {
    items: (data?.items ?? []).filter(i => String(i.project_id) === house),
    orders: orders.filter(o => String(o.project_id) === house),
    task: data?.tasks.find(t => String(t.project_id) === house),
  };
}

/** A work queue, not an unread count. updated_at means maintenance, never creation. */
export function pendingRequirements(items: ProcurementItem[]) {
  return items.filter(i => i.status !== 'na' && (!!i.attention_reasons?.length ||
    (i.in_worklist && !i.order_managed && ['pending_spec', 'pending_order', 'exception'].includes(i.status))))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id - a.id);
}
