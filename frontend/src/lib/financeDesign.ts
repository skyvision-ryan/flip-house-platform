import type { DesignRecord, SpecialistPreview } from './roleDesigns';

export const formatFinanceMoney = (amount: number) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
}).format(amount);

/** The unregistered invoice is a preview record, not an Expense/payment entry. */
export const isUnregisteredFinanceRecord = (record: DesignRecord) => record.status === '待付款核实';

export function financePreviewTotals(rows: DesignRecord[]) {
  const cents = (amount: number | undefined) => Math.round((amount ?? 0) * 100);
  const planned = rows.reduce((sum, row) => sum + cents(row.planned), 0) / 100;
  const registered = rows.filter(row => !isUnregisteredFinanceRecord(row)).reduce((sum, row) => sum + cents(row.amount), 0) / 100;
  const unregistered = rows.filter(isUnregisteredFinanceRecord).reduce((sum, row) => sum + cents(row.amount), 0) / 100;
  return { planned, registered, unregistered, remaining: Math.round((planned - registered) * 100) / 100 };
}

export function filterFinanceRecords(preview: SpecialistPreview, query: string, status = '全部', house = 'all') {
  const q = query.trim().toLowerCase();
  return preview.records.filter(row => (house === 'all' || row.house === house)
    && (status === '全部' || row.status === status)
    && `${row.title} ${row.category} ${preview.houses.find(item => item.id === row.house)?.name ?? row.house} ${row.fields.map(field => field.value).join(' ')}`.toLowerCase().includes(q));
}
