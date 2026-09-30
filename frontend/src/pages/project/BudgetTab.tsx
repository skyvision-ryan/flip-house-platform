import { systemText } from '../../i18n/core.ts';
import { useLanguage } from '../../i18n/LanguageProvider';
import { m as uiText } from '../../i18n/core.ts';
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
  useLanguage();
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
  const catOptions = meta?.budget_categories.map((c) => ({ label: systemText(c), value: c })) ?? [];
  const addLine = async () => {
    if (busy) return;
    setAttempted(true); setError('');
    if (!lineDraft.category) { lineCategoryRef.current?.focus(); return; }
    if (requiredNumberError(lineDraft.planned_amount)) { lineAmountRef.current?.focus(); return; }
    setBusy(true);
    try {
      await api.addBudgetLine(projectId, { category: lineDraft.category, planned_amount: Number(lineDraft.planned_amount) });
      setLineModal(false); setLineDraft({ category: '', planned_amount: '' });
      await load(); await reload(); flash({ type: 'success', content: uiText("budgetTab.budget.item.added") });
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
      await load(); await reload(); flash({ type: 'success', content: uiText("budgetTab.expense.recorded") });
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const open = (kind: 'line' | 'expense') => { setError(''); setAttempted(false); kind === 'line' ? setLineModal(true) : setExpModal(true); };
  const moneyPanel = (
    <SpaceBetween size="l">
      <Container cardId="budget-summary" header={<Header variant="h2">{uiText("budgetTab.summary")}</Header>}>
        <SpaceBetween size="m">
          <ColumnLayout columns={4} variant="text-grid">
            <StatTile label={uiText("budgetTab.total.budget")} value={compactMoney(summary?.planned_total)} sub={uiText("sentences.budget.items", { value1: (lines.length) })} />
            <StatTile label={uiText("dashboard.spent")} value={compactMoney(summary?.spent_total)} sub={uiText("budget.expenseCount", { count: expenses.length })} />
            <StatTile label={uiText("bulletList.remaining")} value={compactMoney(summary?.remaining)} tone={summary && summary.remaining < 0 ? 'bad' : undefined} sub={summary && summary.remaining < 0 ? uiText("budgetTab.over.budget") : undefined} help={uiText("budgetTab.budget.spending")} />
            <StatTile label={uiText("budgetTab.budget.used")} value={pct(summary?.used_pct)} tone={summary?.used_pct != null && summary.used_pct > 105 ? 'bad' : undefined} help={uiText("budgetTab.over.105.is.flagged.as.at.risk")} />
          </ColumnLayout>
          {summary && summary.planned_total > 0 && (
            <Meter value={summary.spent_total} max={summary.planned_total} label={uiText("dashboard.budget.used")} reading={`${compactMoney(summary.spent_total)} / ${compactMoney(summary.planned_total)}`} targetLabel={uiText("updatesList.budget")} note={summary.remaining >= 0 ? uiText("sentences.remaining", { value1: (compactMoney(summary.remaining)) }) : uiText("sentences.over.budget.the.red.segment.shows.the.excess", { value1: (compactMoney(-summary.remaining)) })} />
          )}
        </SpaceBetween>
      </Container>

      <Table cardId="budget-actual"
        header={<Header variant="h2" counter={`(${summary?.categories.length ?? 0})`} help={uiText("budgetTab.compare.planned.and.actual.amounts.by.category")}>{uiText("budgetTab.budget.vs.actual")}</Header>}
        items={summary?.categories ?? []}
        empty={<Box textAlign="center" color="inherit"><b>{uiText("budgetTab.no.budget.or.expenses.yet")}</b></Box>}
        columnDefinitions={[
          { id: 'c', header: uiText("sabrinaDesign.category"), cell: (c) => <Button variant="inline-link" ariaLabel={uiText("sentences.view.expenses", { value1: (c.category) })} onClick={() => { setParams(prev => { const next = new URLSearchParams(prev); next.set('expensecat', c.category); next.delete('expenseq'); return next; }, { replace: true }); expenseSection.current?.scrollIntoView({ block: 'start' }); expenseSearch.current?.focus(); }}>{systemText(c.category)}</Button> },
          // 条本身只有 160px，留 300px 会在窄屏白占一列
          { id: 'bar', header: uiText("budgetTab.compare"), cell: (c) => <InlineBar value={c.spent} max={Math.max(...(summary?.categories ?? []).map((x) => Math.max(x.planned, x.spent)), 1)} target={c.planned} text={`${compactMoney(c.spent)} / ${compactMoney(c.planned)}`} width={160} /> },
          { id: 'p', isRowHeader: false, width: 130, header: uiText("updatesList.budget"), cell: (c) => money(c.planned) },
          { id: 'pp', isRowHeader: false, width: 130, header: uiText("budgetTab.budget.share"), cell: (c) => pct(c.planned_pct) },
          { id: 's', isRowHeader: false, width: 130, header: uiText("bulletList.actual"), cell: (c) => money(c.spent) },
          { id: 'sp', isRowHeader: false, width: 130, header: uiText("budgetTab.actual.share"), cell: (c) => pct(c.spent_pct) },
          { id: 'v', header: uiText("budgetTab.variance"), cell: (c) => (c.planned > 0 ? <span><DeltaBadge pct={((c.spent - c.planned) / c.planned) * 100} goodWhenPositive={false} /> <Box variant="span" color="text-body-secondary">{c.variance > 0 ? uiText("sentences.over", { value1: (compactMoney(c.variance)) }) : uiText("sentences.remaining.2", { value1: (compactMoney(-c.variance)) })}</Box></span> : '—') },
        ]}
      />

      <SpaceBetween size="l">
        <Table cardId="budget-lines"
          header={<Header variant="h2" counter={`(${lines.length})`} actions={<Button onClick={() => open('line')}>{uiText("budgetTab.add.budget.item")}</Button>}>{uiText("cardRegistry.budget.item")}</Header>}
          items={lines}
          empty={<Box textAlign="center" color="inherit"><b>{uiText("budgetTab.no.budget.items.yet")}</b></Box>}
          columnDefinitions={[
            { id: 'c', header: uiText("sabrinaDesign.category"), cell: (l) => l.category },
            { id: 'a', isRowHeader: false, width: 130, header: uiText("budgetTab.planned.amount"), cell: (l) => money(l.planned_amount) },
            { id: 'x', header: '', cell: (l) => <Button variant="inline-link" onClick={async () => { await api.deleteBudgetLine(l.id); await load(); await reload(); }}>{uiText("analysisTab.delete")}</Button> },
          ]}
        />
        <div ref={expenseSection} className="ui-expense-records"><Table cardId="budget-expenses"
          header={<Header variant="h2" counter={`(${shownExpenses.length} / ${expenses.length})`} actions={<Button onClick={() => open('expense')}>{uiText("budgetTab.record.expense")}</Button>} help={uiText("budgetTab.record.invoices.and.payments.here.material.progress.is.in")}>{uiText("updatesList.expenses")}</Header>}
          {...expenseCollection} items={expenseRows}
          pagination={<Pagination {...expensePagination} ariaLabels={{ nextPageLabel: uiText("budgetTab.next.page"), previousPageLabel: uiText("budgetTab.previous.page"), pageLabel: n => uiText("sentences.page", { value1: (n) }) }} />}
          filter={<SpaceBetween size="s">
            <TextFilter ref={expenseSearch} filteringText={query} filteringAriaLabel={uiText("budgetTab.find.expenses")} filteringPlaceholder={uiText("budgetTab.supplier.notes.date.or.amount")} onChange={({ detail }) => filterExpense('expenseq', detail.filteringText)} countText={uiText("sentences.matching.records", { value1: (shownExpenses.length) })} />
            <SpaceBetween direction="horizontal" size="s"><Select ariaLabel={uiText("budgetTab.filter.expense.category")} selectedOption={{ label: systemText(category) || uiText("budgetTab.all.categories"), value: category }} options={[{ label: uiText("budgetTab.all.categories"), value: '' }, ...catOptions]} onChange={({ detail }) => filterExpense('expensecat', detail.selectedOption.value ?? '')} />{(query || category) && <Button onClick={clearExpenses}>{uiText("directorDesign.clear.filters")}</Button>}</SpaceBetween>
            <Box color="text-body-secondary">{uiText("budgetTab.filters.affect.only.the.details.below.summary.totals.still")}</Box>
          </SpaceBetween>}
          empty={<Box textAlign="center" color="inherit"><b>{expenses.length ? uiText("budgetTab.no.matching.expenses") : uiText("budgetTab.no.expenses.recorded.for.this.property")}</b>{expenses.length > 0 && <Button variant="inline-link" onClick={clearExpenses}>{uiText("directorDesign.clear.filters")}</Button>}</Box>}
          columnDefinitions={[
            { id: 'd', header: uiText("inspectionsPanel.date"), width: 110, sortingField: 'date', cell: (e) => dateStr(e.date) },
            { id: 'a', isRowHeader: false, width: 130, header: uiText("procurementItemRow.amount"), sortingField: 'amount', cell: (e) => money(e.amount, 2) },
            { id: 'v', header: uiText("dashboard.supplier"), minWidth: 200, cell: (e) => text(e.vendor) },
            { id: 'c', header: uiText("sabrinaDesign.category"), minWidth: 140, cell: (e) => e.category },
            { id: 'n', header: uiText("inspectionsPanel.notes"), minWidth: 200, cell: (e) => text(e.note) },
            { id: 'x', header: '', cell: (e) => <Button variant="inline-link" onClick={async () => { await api.deleteExpense(e.id); await load(); await reload(); }}>{uiText("analysisTab.delete")}</Button> },
          ]}
        /></div>
      </SpaceBetween>
    </SpaceBetween>
  );

  return (
    <>
      {loadError && <Alert type="error" header={uiText("budgetTab.could.not.load.budget")}>{systemText(loadError)}</Alert>}
      {moneyPanel}

      <Modal visible={lineModal} onDismiss={() => { if (!busy) setLineModal(false); }} header={uiText("budgetTab.add.budget.item")}
        footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button variant="link" disabled={busy} onClick={() => setLineModal(false)}>{uiText("fieldWithSource.cancel")}</Button><Button variant="primary" loading={busy} onClick={addLine}>{uiText("budgetTab.add")}</Button></SpaceBetween></Box>}>
        <SpaceBetween size="m">
          {error && <Alert type="error">{systemText(error)}</Alert>}
          <Box color="text-body-secondary">{uiText("budgetTab.closing.preserves.these.inputs.save.before.leaving.the.page")}</Box>
          <FormField label={uiText("sabrinaDesign.category")} errorText={systemText(attempted && !lineDraft.category ? uiText("budgetTab.select.a.category") : undefined)}><Select ref={lineCategoryRef} selectedOption={catOptions.find((o) => o.value === lineDraft.category) ?? null} options={catOptions} placeholder={uiText("budgetTab.select.category")} onChange={({ detail }) => setLineDraft((d) => ({ ...d, category: detail.selectedOption.value! }))} /></FormField>
          <FormField label={uiText("budgetTab.planned.amount.usd")} errorText={systemText(attempted ? requiredNumberError(lineDraft.planned_amount) : undefined)}><Input ref={lineAmountRef} type="number" value={lineDraft.planned_amount} onChange={({ detail }) => setLineDraft((d) => ({ ...d, planned_amount: detail.value }))} /></FormField>
        </SpaceBetween>
      </Modal>

      <Modal visible={expModal} onDismiss={() => { if (!busy) setExpModal(false); }} header={uiText("budgetTab.record.expense")}
        footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button variant="link" disabled={busy} onClick={() => setExpModal(false)}>{uiText("fieldWithSource.cancel")}</Button><Button variant="primary" loading={busy} onClick={addExpense}>{uiText("myTodoTable.record")}</Button></SpaceBetween></Box>}>
        <SpaceBetween size="m">
          {error && <Alert type="error">{systemText(error)}</Alert>}
          <Box color="text-body-secondary">{uiText("budgetTab.closing.preserves.these.inputs.save.before.leaving.the.page")}</Box>
          <FormField label={uiText("sabrinaDesign.category")} errorText={systemText(attempted && !expDraft.category ? uiText("budgetTab.select.a.category") : undefined)}><Select ref={expenseCategoryRef} selectedOption={catOptions.find((o) => o.value === expDraft.category) ?? null} options={catOptions} placeholder={uiText("budgetTab.select.category")} onChange={({ detail }) => setExpDraft((d) => ({ ...d, category: detail.selectedOption.value! }))} /></FormField>
          <FormField label={uiText("procurementDesign.amount.usd")} errorText={systemText(attempted ? requiredNumberError(expDraft.amount) : undefined)}><Input ref={expenseAmountRef} type="number" value={expDraft.amount} onChange={({ detail }) => setExpDraft((d) => ({ ...d, amount: detail.value }))} /></FormField>
          <FormField label={uiText("inspectionsPanel.date")}><DatePicker value={expDraft.date} onChange={({ detail }) => setExpDraft((d) => ({ ...d, date: detail.value }))} placeholder="YYYY/MM/DD" /></FormField>
          <FormField label={uiText("dashboard.supplier")}><Input value={expDraft.vendor} onChange={({ detail }) => setExpDraft((d) => ({ ...d, vendor: detail.value }))} /></FormField>
          <FormField label={uiText("inspectionsPanel.notes")}><Input value={expDraft.note} onChange={({ detail }) => setExpDraft((d) => ({ ...d, note: detail.value }))} /></FormField>
        </SpaceBetween>
      </Modal>
    </>
  );
}
