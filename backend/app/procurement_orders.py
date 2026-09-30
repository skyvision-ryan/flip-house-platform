"""Read-only order projection shared by procurement, project evidence and overview.

The original 37 rows are never replaced. Linked orders are the single source for
purchase facts; edits, returns and voided receipts recalculate them immediately.
"""
from collections import defaultdict
from decimal import Decimal
from datetime import datetime
from zoneinfo import ZoneInfo
from sqlalchemy import select
from . import models
from .purchase_orders import OrderDocument, order_summary

ORDER_FIELDS = {'status', 'ordered_on', 'expected_on', 'received_on', 'delivery_type',
                'delivery_address', 'amount', 'quantity', 'specification', 'product_url',
                'retailer', 'order_number', 'order_url', 'carrier', 'tracking_number',
                'tracking_url', 'shipment_status', 'follow_up', 'checked_at', 'checked_by_user_id'}


def _shipping_reasons(status, expected_on, today):
    if status == 'delivered': return ['网站送达待确认']
    if status == 'ready_pickup': return ['待取货']
    if status == 'exception': return ['物流异常']
    if expected_on and str(expected_on) < today: return ['预计日期已过，待核实']
    return []


def procurement_attention(rows, projected):
    """Canonical material-level reasons for every procurement surface; no stored status."""
    today = datetime.now(ZoneInfo('America/Los_Angeles')).date().isoformat()
    result = {}
    for row in rows:
        if row.id in projected:
            result[row.id] = projected[row.id]['attention_reasons']
            continue
        reasons = []
        if row.status != 'na':
            if row.follow_up and row.follow_up.strip(): reasons.append(row.follow_up.strip())
            if row.status == 'exception': reasons.append(row.note or '异常待采购跟进')
            if row.status != 'received': reasons.extend(_shipping_reasons(row.shipment_status, row.expected_on, today))
        result[row.id] = list(dict.fromkeys(reasons))
    return result


def order_material_projection(db, rows):
    if db is None or not rows:
        return {}
    today = datetime.now(ZoneInfo('America/Los_Angeles')).date().isoformat()
    linked = defaultdict(list)
    orders = db.scalars(select(models.PurchaseOrder).where(
        models.PurchaseOrder.project_id.in_({r.project_id for r in rows}))).all()
    for order in orders:
        doc = OrderDocument.model_validate_json(order.document)
        summary = order_summary(doc)
        for line, result in zip(doc.lines, summary['lines']):
            linked[line.material_id].append((order, doc, line, result))
    output = {}
    for row in rows:
        entries = linked[row.id]
        if not entries:
            continue
        results = [entry[3] for entry in entries]
        lines = [entry[2] for entry in entries]
        batches = [d for _, doc, line, _ in entries for d in doc.deliveries
                   if any(a.line_id == line.id for a in d.allocations)]
        receipts = [r for _, doc, line, _ in entries for r in doc.receipts
                    if not r.void_reason and any(a.line_id == line.id for a in r.lines)]
        all_known = all(line.quantity is not None for line in lines)
        active = any(line.quantity is None or line.quantity > line.cancelled_quantity for line in lines)
        complete = active and all(r['remaining'] == 0 for r in results)
        reason = ''
        unit_mismatch = False
        if not active:
            reason = '关联购买已全部取消，待重新采购'
        elif row.required_quantity is not None:
            units = {line.unit.strip().casefold() for line in lines if line.quantity is None or line.quantity > line.cancelled_quantity}
            if not row.unit or units != {row.unit.strip().casefold()}:
                complete = False
                unit_mismatch = True
                reason = '需求单位与商品单位需核对，不能自动换算'
            elif sum((r['usable'] for r in results), Decimal(0)) < Decimal(str(row.required_quantity)):
                complete = False
                reason = '已收数量尚未满足本项需求'
        outstanding = any(r['remaining'] is None or r['remaining'] > 0 for r in results)
        status = 'received' if complete else 'ordered' if active and outstanding else 'pending_order'
        if not complete and (any(r['damaged'] > 0 and (r['remaining'] or 0) > 0 for r in results)
                             or any(d.website_status == 'exception' for d in batches) or any(l.website_status == 'exception' or l.issue_note for l in lines)):
            status = 'exception'
        if not complete and not unit_mismatch:
            damage_gaps = [f"{line.name}：破损待补齐 {result['remaining']:g} {line.unit}" for line, result in zip(lines, results)
                           if result['damaged'] > 0 and result['remaining'] is not None and result['remaining'] > 0]
            if damage_gaps: reason = '；'.join(damage_gaps)
        if any(l.issue_note for l in lines):
            status = 'exception'
            reason = '；'.join(l.issue_note for l in lines if l.issue_note)
        if unit_mismatch:
            status = 'exception'
        def joined(values):
            return '；'.join(dict.fromkeys(str(v) for v in values if v)) or None
        def days(values, latest=False):
            values = [str(v) for v in values if v]
            return (max(values) if latest else min(values)) if values else None
        # Evaluate each outstanding line independently: a later delivery on another
        # order must not hide this line's overdue date or delivery confirmation.
        reasons = [reason] if reason else []
        for _, doc, line, result in entries:
            reasons.extend(text.strip() for text in (line.issue_note, doc.follow_up) if text and text.strip())
            if line.quantity is not None and line.quantity <= line.cancelled_quantity: continue
            if result['remaining'] == 0: continue
            reasons.extend(_shipping_reasons(line.website_status, line.expected_on, today))
            for delivery in doc.deliveries:
                allocation = next((a for a in delivery.allocations if a.line_id == line.id), None)
                if allocation is None: continue
                batch_received = sum((a.quantity for receipt in doc.receipts if not receipt.void_reason and receipt.delivery_id == delivery.id
                                      for a in receipt.lines if a.line_id == line.id), Decimal(0))
                if allocation.quantity is not None and batch_received >= allocation.quantity: continue
                reasons.extend(_shipping_reasons(delivery.website_status, delivery.expected_on, today))
        if status == 'exception' and not reasons: reasons.append('异常待采购跟进')
        original = {key: getattr(row, key, None) for key in ORDER_FIELDS}
        output[row.id] = {
            'order_managed': True, 'legacy_purchase': original,
            'status': status, 'order_progress_note': reason, 'attention_reasons': list(dict.fromkeys(reasons)),
            'ordered_on': days([doc.ordered_on for _, doc, _, _ in entries]),
            'expected_on': days([d.expected_on for d in batches] + [l.expected_on for l in lines], latest=True),
            'received_on': days([r.received_on for r in receipts], latest=True) if complete else None,
            'delivery_type': batches[0].destination if batches and len({d.destination for d in batches}) == 1 else None,
            'delivery_address': joined([l.delivery_address for l in lines] + [d.address for d in batches] + [doc.delivery_address for _, doc, _, _ in entries]),
            'amount': sum((r['amount'] for r in results), Decimal(0)) if all(r['amount'] is not None for r in results) else None,
            'quantity': sum((l.quantity for l in lines), Decimal(0)) if all_known and len({l.unit for l in lines}) == 1 else None,
            'retailer': joined([doc.vendor for _, doc, _, _ in entries]),
            'order_number': joined([doc.order_number for _, doc, _, _ in entries]),
            'order_url': str(entries[0][1].order_url) if len({o.id for o, _, _, _ in entries}) == 1 and entries[0][1].order_url else None,
            'carrier': joined([d.carrier for d in batches]), 'tracking_number': joined([d.tracking_number for d in batches]),
            'tracking_url': None,
            'shipment_status': 'exception' if status == 'exception' else 'delivered' if (any(d.website_status in ('delivered', 'ready_pickup') for d in batches) or any(l.website_status in ('delivered', 'ready_pickup') for l in lines)) else None,
            'follow_up': joined([doc.follow_up for _, doc, _, _ in entries]),
            'checked_at': days([doc.checked_on for _, doc, _, _ in entries], latest=True),
            'checked_by_user_id': None,
            'order_notes': joined([l.selection_note for l in lines]),
        }
    return output
