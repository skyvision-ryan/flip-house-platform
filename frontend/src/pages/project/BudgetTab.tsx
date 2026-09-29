import { useCollection } from '@cloudscape-design/collection-hooks';
import TextFilter, { type TextFilterProps } from '@cloudscape-design/components/text-filter';
import Pagination from '@cloudscape-design/components/pagination';
import { useSearchParams } from 'react-router-dom';
import { matchesRecord } from '../../lib/recordSearch';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import DatePicker from '@cloudscape-design/components/date-picker';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useEffect, useState, useRef } from 'react';
import { api, BudgetLine, BudgetSummary, Expense } from '../../api/client';
import { compactMoney, DeltaBadge, InlineBar, Meter, StatTile } from '../../components/charts';
import FormField from '../../components/ui/FormField';
import Header from '../../components/ui/Header';
import Container from '../../components/ui/Surface';
import Table from '../../components/ui/Table';
import { useFlash } from '../../lib/flash';
import { dateStr, money, pct, text, requiredNumberError } from '../../lib/format';
import { useMeta } from '../../lib/meta';
import { useRole } from '../../lib/role';

export default function BudgetTab({ projectId, reload }: { projectId: number; reload: () => Promise<any> }) {
  const meta = useMeta();
  const role = useRole();
  const flash = useFlash();
  const canMoney = role.canReadMoney;
  const [params, setParams] = useSearchParams();
  const query = params.get('expenseq') ?? '';
  const category = params.get('expensecat') ?? '';
  const filterExpense = (key: string, value: string) => setParams(prev => { const next = new URLSearchParams(prev); if (value) next.set(key, value); else next.delete(key); return next; }, { replace: true });
  const expenseSection = useRef<HTMLDivElement>(null);
  const expenseSearch = useRef<TextFilterProps.Ref>(null);
  const [summary, setSummary] = useState<BudgetSummary | null>(null);
  const [lines, setLines] = useState<BudgetLine[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const lineCategoryRef = useRef<SelectProps.Ref>(null);
  const expenseCategoryRef = useRef<SelectProps.Ref>(null);
  const lineAmountRef = useRef<InputProps.Ref>(null);
  const expenseAmountRef = useRef<InputProps.Ref>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [attempted, setAttempted] = useState(false);

  const [lineModal, setLineModal] = useState(false);
  const [expModal, setExpModal] = useState(false);
  const [lineDraft, setLineDraft] = useState({ category: '', planned_amount: '' });
  const [expDraft, setExpDraft] = useState({ category: '', amount: '', date: '', vendor: '', note: '' });

  const load = useCallback(async () => {
    if (canMoney) {
      const [s, l, e] = await Promise.all([api.budgetSummary(projectId), api.budgetLines(projectId), api.expenses(projectId)]);
      setSummary(s); setLines(l); setExpenses(e);
    }
  }, [projectId, canMoney]);
  useEffect(() => { load().catch(e => setLoadError(e.message)); }, [load]);

  const shownExpenses = expenses.filter(e => (!category || e.category === category) && matchesRecord(query, [e.vendor, e.note, e.category, e.date, e.amount]));
  const { items: expenseRows, collectionProps: expenseCollection, paginationProps: expensePagination } = useCollection(shownExpenses, { pagination: { pageSize: 20 }, sorting: {} });
  const clearExpenses = () => setParams(prev => { const next = new URLSearchParams(prev); next.delete('expenseq'); next.delete('expensecat'); return next; }, { replace: true });
  const catOptions = meta?.budget_categories.map((c) => ({ label: c, value: c })) ?? [];
  const addLine = async () => {
    if (busy) return;
    setAttempted(true); setError('');
    if (!lineDraft.category) { lineCategoryRef.current?.focus(); return; }
    if (requiredNumberError(lineDraft.planned_amount)) { lineAmountRef.current?.focus(); return; }
    setBusy(true);
    try {
      await api.addBudgetLine(projectId, { category: lineDraft.category, planned_amount: Number(lineDraft.planned_amount) });
      setLineModal(false); setLineDraft({ category: '', planned_amount: '' });
      await load(); await reload(); flash({ type: 'success', content: '预算项已添加' });
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const addExpense = async () => {
    if (busy) return;
    setAttempted(true); setError('');
    if (!expDraft.category) { expenseCategoryRef.current?.focus(); return; }
    if (requiredNumberError(expDraft.amount)) { expenseAmountRef.current?.focus(); return; }
    setBusy(true);
    try {
      await api.addExpense(projectId, { category: expDraft.category, amount: Number(expDraft.amount), date: expDraft.date || null, vendor: expDraft.vendor || null, note: expDraft.note || null });
      setExpModal(false); setExpDraft({ category: '', amount: '', date: '', vendor: '', note: '' });
      await load(); await reload(); flash({ type: 'success', content: '支出已记录' });
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const open = (kind: 'line' | 'expense') => { setError(''); setAttempted(false); kind === 'line' ? setLineModal(true) : setExpModal(true); };
  const moneyPanel = (
    <SpaceBetween size="l">
      <Container cardId="budget-summary" header={<Header variant="h2">汇总</Header>}>
        <SpaceBetween size="m">
          <ColumnLayout columns={4} variant="text-grid">
            <StatTile label="总预算" value={compactMoney(summary?.planned_total)} sub={`${lines.length} 个预算项`} />
            <StatTile label="已支出" value={compactMoney(summary?.spent_total)} sub={`${expenses.length} 笔`} />
            <StatTile label="剩余" value={compactMoney(summary?.remaining)} tone={summary && summary.remaining < 0 ? 'bad' : undefined} sub={summary && summary.remaining < 0 ? '已超支' : undefined} help="预算 − 已支出" />
            <StatTile label="已用比例" value={pct(summary?.used_pct)} tone={summary?.used_pct != null && summary.used_pct > 105 ? 'bad' : undefined} help="超过 105% 记为有风险" />
          </ColumnLayout>
          {summary && summary.planned_total > 0 && (
            <Meter value={summary.spent_total} max={summary.planned_total} label="预算已用" reading={`${compactMoney(summary.spent_total)} / ${compactMoney(summary.planned_total)}`} targetLabel="预算" note={summary.remaining >= 0 ? `剩余 ${compactMoney(summary.remaining)}` : `已超支 ${compactMoney(-summary.remaining)}，红色那段就是超出的部分`} />
          )}
        </SpaceBetween>
      </Container>

      <Table cardId="budget-actual"
        header={<Header variant="h2" counter={`(${summary?.categories.length ?? 0})`} help="按类别对比计划与实际。">预算 vs 实际</Header>}
        items={summary?.categories ?? []}
        empty={<Box textAlign="center" color="inherit"><b>还没有预算或支出</b></Box>}
        columnDefinitions={[
          { id: 'c', header: '类别', cell: (c) => <Button variant="inline-link" ariaLabel={`查看${c.category}支出`} onClick={() => { setParams(prev => { const next = new URLSearchParams(prev); next.set('expensecat', c.category); next.delete('expenseq'); return next; }, { replace: true }); expenseSection.current?.scrollIntoView({ block: 'start' }); expenseSearch.current?.focus(); }}>{c.category}</Button> },
          // 条本身只有 160px，留 300px 会在窄屏白占一列
          { id: 'bar', header: '对比', cell: (c) => <InlineBar value={c.spent} max={Math.max(...(summary?.categories ?? []).map((x) => Math.max(x.planned, x.spent)), 1)} target={c.planned} text={`${compactMoney(c.spent)} / ${compactMoney(c.planned)}`} width={160} /> },
          { id: 'p', isRowHeader: false, width: 130, header: '预算', cell: (c) => money(c.planned) },
          { id: 'pp', isRowHeader: false, width: 130, header: '预算占比', cell: (c) => pct(c.planned_pct) },
          { id: 's', isRowHeader: false, width: 130, header: '实际', cell: (c) => money(c.spent) },
          { id: 'sp', isRowHeader: false, width: 130, header: '实际占比', cell: (c) => pct(c.spent_pct) },
          { id: 'v', header: '差异', cell: (c) => (c.planned > 0 ? <span><DeltaBadge pct={((c.spent - c.planned) / c.planned) * 100} goodWhenPositive={false} /> <Box variant="span" color="text-body-secondary">{c.variance > 0 ? `超 ${compactMoney(c.variance)}` : `剩 ${compactMoney(-c.variance)}`}</Box></span> : '—') },
        ]}
      />

      <SpaceBetween size="l">
        <Table cardId="budget-lines"
          header={<Header variant="h2" counter={`(${lines.length})`} actions={<Button onClick={() => open('line')}>添加预算项</Button>}>预算项</Header>}
          items={lines}
          empty={<Box textAlign="center" color="inherit"><b>还没有预算项</b></Box>}
          columnDefinitions={[
            { id: 'c', header: '类别', cell: (l) => l.category },
            { id: 'a', isRowHeader: false, width: 130, header: '计划金额', cell: (l) => money(l.planned_amount) },
            { id: 'x', header: '', cell: (l) => <Button variant="inline-link" onClick={async () => { await api.deleteBudgetLine(l.id); await load(); await reload(); }}>删除</Button> },
          ]}
        />
        <div ref={expenseSection} className="ui-expense-records"><Table cardId="budget-expenses"
          header={<Header variant="h2" counter={`(${shownExpenses.length} / ${expenses.length})`} actions={<Button onClick={() => open('expense')}>记一笔支出</Button>} help="发票与付款记在这里；材料进度在「采购」页签。">支出</Header>}
          {...expenseCollection} items={expenseRows}
          pagination={<Pagination {...expensePagination} ariaLabels={{ nextPageLabel: '下一页', previousPageLabel: '上一页', pageLabel: n => `第 ${n} 页` }} />}
          filter={<SpaceBetween size="s">
            <TextFilter ref={expenseSearch} filteringText={query} filteringAriaLabel="查找支出" filteringPlaceholder="供应商、备注、日期或金额" onChange={({ detail }) => filterExpense('expenseq', detail.filteringText)} countText={`${shownExpenses.length} 笔匹配`} />
            <SpaceBetween direction="horizontal" size="s"><Select ariaLabel="筛选支出类别" selectedOption={{ label: category || '全部类别', value: category }} options={[{ label: '全部类别', value: '' }, ...catOptions]} onChange={({ detail }) => filterExpense('expensecat', detail.selectedOption.value ?? '')} />{(query || category) && <Button onClick={clearExpenses}>清除筛选</Button>}</SpaceBetween>
            <Box color="text-body-secondary">筛选仅影响下方明细，上方汇总仍为全房记录。</Box>
          </SpaceBetween>}
          empty={<Box textAlign="center" color="inherit"><b>{expenses.length ? '没有匹配的支出' : '本房尚无支出记录'}</b>{expenses.length > 0 && <Button variant="inline-link" onClick={clearExpenses}>清除筛选</Button>}</Box>}
          columnDefinitions={[
            { id: 'd', header: '日期', width: 110, sortingField: 'date', cell: (e) => dateStr(e.date) },
            { id: 'a', isRowHeader: false, width: 130, header: '金额', sortingField: 'amount', cell: (e) => money(e.amount, 2) },
            { id: 'v', header: '供应商', minWidth: 200, cell: (e) => text(e.vendor) },
            { id: 'c', header: '类别', minWidth: 140, cell: (e) => e.category },
            { id: 'n', header: '备注', minWidth: 200, cell: (e) => text(e.note) },
            { id: 'x', header: '', cell: (e) => <Button variant="inline-link" onClick={async () => { await api.deleteExpense(e.id); await load(); await reload(); }}>删除</Button> },
          ]}
        /></div>
      </SpaceBetween>
    </SpaceBetween>
  );

  return (
    <>
      {loadError && <Alert type="error" header="读取预算失败">{loadError}</Alert>}
      {moneyPanel}

      <Modal visible={lineModal} onDismiss={() => { if (!busy) setLineModal(false); }} header="添加预算项"
        footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button variant="link" disabled={busy} onClick={() => setLineModal(false)}>取消</Button><Button variant="primary" loading={busy} onClick={addLine}>添加</Button></SpaceBetween></Box>}>
        <SpaceBetween size="m">
          {error && <Alert type="error">{error}</Alert>}
          <Box color="text-body-secondary">关闭弹窗会保留本次输入，离开页面前请完成保存。</Box>
          <FormField label="类别" errorText={attempted && !lineDraft.category ? '请选择类别。' : undefined}><Select ref={lineCategoryRef} selectedOption={catOptions.find((o) => o.value === lineDraft.category) ?? null} options={catOptions} placeholder="选择类别" onChange={({ detail }) => setLineDraft((d) => ({ ...d, category: detail.selectedOption.value! }))} /></FormField>
          <FormField label="计划金额（USD）" errorText={attempted ? requiredNumberError(lineDraft.planned_amount) : undefined}><Input ref={lineAmountRef} type="number" value={lineDraft.planned_amount} onChange={({ detail }) => setLineDraft((d) => ({ ...d, planned_amount: detail.value }))} /></FormField>
        </SpaceBetween>
      </Modal>

      <Modal visible={expModal} onDismiss={() => { if (!busy) setExpModal(false); }} header="记一笔支出"
        footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button variant="link" disabled={busy} onClick={() => setExpModal(false)}>取消</Button><Button variant="primary" loading={busy} onClick={addExpense}>记录</Button></SpaceBetween></Box>}>
        <SpaceBetween size="m">
          {error && <Alert type="error">{error}</Alert>}
          <Box color="text-body-secondary">关闭弹窗会保留本次输入，离开页面前请完成保存。</Box>
          <FormField label="类别" errorText={attempted && !expDraft.category ? '请选择类别。' : undefined}><Select ref={expenseCategoryRef} selectedOption={catOptions.find((o) => o.value === expDraft.category) ?? null} options={catOptions} placeholder="选择类别" onChange={({ detail }) => setExpDraft((d) => ({ ...d, category: detail.selectedOption.value! }))} /></FormField>
          <FormField label="金额（USD）" errorText={attempted ? requiredNumberError(expDraft.amount) : undefined}><Input ref={expenseAmountRef} type="number" value={expDraft.amount} onChange={({ detail }) => setExpDraft((d) => ({ ...d, amount: detail.value }))} /></FormField>
          <FormField label="日期"><DatePicker value={expDraft.date} onChange={({ detail }) => setExpDraft((d) => ({ ...d, date: detail.value }))} placeholder="YYYY/MM/DD" /></FormField>
          <FormField label="供应商"><Input value={expDraft.vendor} onChange={({ detail }) => setExpDraft((d) => ({ ...d, vendor: detail.value }))} /></FormField>
          <FormField label="备注"><Input value={expDraft.note} onChange={({ detail }) => setExpDraft((d) => ({ ...d, note: detail.value }))} /></FormField>
        </SpaceBetween>
      </Modal>
    </>
  );
}
