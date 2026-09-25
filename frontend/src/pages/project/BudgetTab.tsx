import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import DatePicker from '@cloudscape-design/components/date-picker';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useEffect, useState } from 'react';
import { api, BudgetLine, BudgetSummary, Expense } from '../../api/client';
import { compactMoney, DeltaBadge, InlineBar, Meter, StatTile } from '../../components/charts';
import FormField from '../../components/ui/FormField';
import Header from '../../components/ui/Header';
import Container from '../../components/ui/Surface';
import Table from '../../components/ui/Table';
import { useFlash } from '../../lib/flash';
import { dateStr, money, pct, text } from '../../lib/format';
import { useMeta } from '../../lib/meta';
import { useRole } from '../../lib/role';

export default function BudgetTab({ projectId, reload }: { projectId: number; reload: () => Promise<any> }) {
  const meta = useMeta();
  const role = useRole();
  const flash = useFlash();
  const canMoney = role.canReadMoney;
  const [summary, setSummary] = useState<BudgetSummary | null>(null);
  const [lines, setLines] = useState<BudgetLine[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
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
  useEffect(() => { load(); }, [load]);

  const catOptions = meta?.budget_categories.map((c) => ({ label: c, value: c })) ?? [];
  const addLine = async () => {
    await api.addBudgetLine(projectId, { category: lineDraft.category, planned_amount: Number(lineDraft.planned_amount) });
    setLineModal(false); setLineDraft({ category: '', planned_amount: '' });
    await load(); await reload(); flash({ type: 'success', content: '预算项已添加' });
  };
  const addExpense = async () => {
    await api.addExpense(projectId, { category: expDraft.category, amount: Number(expDraft.amount), date: expDraft.date || null, vendor: expDraft.vendor || null, note: expDraft.note || null });
    setExpModal(false); setExpDraft({ category: '', amount: '', date: '', vendor: '', note: '' });
    await load(); await reload(); flash({ type: 'success', content: '支出已记录' });
  };
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
          { id: 'c', header: '类别', cell: (c) => c.category },
          // 条本身只有 160px，留 300px 会在窄屏白占一列
          { id: 'bar', header: '对比', cell: (c) => <InlineBar value={c.spent} max={Math.max(...(summary?.categories ?? []).map((x) => Math.max(x.planned, x.spent)), 1)} target={c.planned} text={`${compactMoney(c.spent)} / ${compactMoney(c.planned)}`} width={160} /> },
          { id: 'p', header: '预算', cell: (c) => money(c.planned) },
          { id: 'pp', header: '预算占比', cell: (c) => pct(c.planned_pct) },
          { id: 's', header: '实际', cell: (c) => money(c.spent) },
          { id: 'sp', header: '实际占比', cell: (c) => pct(c.spent_pct) },
          { id: 'v', header: '差异', cell: (c) => (c.planned > 0 ? <span><DeltaBadge pct={((c.spent - c.planned) / c.planned) * 100} goodWhenPositive={false} /> <Box variant="span" color="text-body-secondary">{c.variance > 0 ? `超 ${compactMoney(c.variance)}` : `剩 ${compactMoney(-c.variance)}`}</Box></span> : '—') },
        ]}
      />

      <ColumnLayout columns={2}>
        <Table cardId="budget-lines"
          header={<Header variant="h2" counter={`(${lines.length})`} actions={<Button onClick={() => setLineModal(true)}>添加预算项</Button>}>预算项</Header>}
          items={lines}
          empty={<Box textAlign="center" color="inherit"><b>还没有预算项</b></Box>}
          columnDefinitions={[
            { id: 'c', header: '类别', cell: (l) => l.category },
            { id: 'a', header: '计划金额', cell: (l) => money(l.planned_amount) },
            { id: 'x', header: '', cell: (l) => <Button variant="inline-link" onClick={async () => { await api.deleteBudgetLine(l.id); await load(); await reload(); }}>删除</Button> },
          ]}
        />
        <Table cardId="budget-expenses"
          header={<Header variant="h2" counter={`(${expenses.length})`} actions={<Button onClick={() => setExpModal(true)}>记一笔支出</Button>} help="发票与付款记在这里；材料进度在「采购」页签。">支出</Header>}
          items={expenses}
          empty={<Box textAlign="center" color="inherit"><b>还没有支出</b></Box>}
          columnDefinitions={[
            { id: 'd', header: '日期', cell: (e) => dateStr(e.date) },
            { id: 'c', header: '类别', cell: (e) => e.category },
            { id: 'v', header: '供应商', cell: (e) => text(e.vendor) },
            { id: 'a', header: '金额', cell: (e) => money(e.amount, 2) },
            { id: 'x', header: '', cell: (e) => <Button variant="inline-link" onClick={async () => { await api.deleteExpense(e.id); await load(); await reload(); }}>删除</Button> },
          ]}
        />
      </ColumnLayout>
    </SpaceBetween>
  );

  return (
    <>
      {moneyPanel}

      <Modal visible={lineModal} onDismiss={() => setLineModal(false)} header="添加预算项"
        footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button variant="link" onClick={() => setLineModal(false)}>取消</Button><Button variant="primary" disabled={!lineDraft.category || !lineDraft.planned_amount} onClick={addLine}>添加</Button></SpaceBetween></Box>}>
        <SpaceBetween size="m">
          <FormField label="类别"><Select selectedOption={catOptions.find((o) => o.value === lineDraft.category) ?? null} options={catOptions} placeholder="选择类别" onChange={({ detail }) => setLineDraft((d) => ({ ...d, category: detail.selectedOption.value! }))} /></FormField>
          <FormField label="计划金额（美元）"><Input type="number" value={lineDraft.planned_amount} onChange={({ detail }) => setLineDraft((d) => ({ ...d, planned_amount: detail.value }))} /></FormField>
        </SpaceBetween>
      </Modal>

      <Modal visible={expModal} onDismiss={() => setExpModal(false)} header="记一笔支出"
        footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs"><Button variant="link" onClick={() => setExpModal(false)}>取消</Button><Button variant="primary" disabled={!expDraft.category || !expDraft.amount} onClick={addExpense}>记录</Button></SpaceBetween></Box>}>
        <SpaceBetween size="m">
          <FormField label="类别"><Select selectedOption={catOptions.find((o) => o.value === expDraft.category) ?? null} options={catOptions} placeholder="选择类别" onChange={({ detail }) => setExpDraft((d) => ({ ...d, category: detail.selectedOption.value! }))} /></FormField>
          <FormField label="金额（美元）"><Input type="number" value={expDraft.amount} onChange={({ detail }) => setExpDraft((d) => ({ ...d, amount: detail.value }))} /></FormField>
          <FormField label="日期"><DatePicker value={expDraft.date} onChange={({ detail }) => setExpDraft((d) => ({ ...d, date: detail.value }))} placeholder="YYYY/MM/DD" /></FormField>
          <FormField label="供应商"><Input value={expDraft.vendor} onChange={({ detail }) => setExpDraft((d) => ({ ...d, vendor: detail.value }))} /></FormField>
          <FormField label="备注"><Input value={expDraft.note} onChange={({ detail }) => setExpDraft((d) => ({ ...d, note: detail.value }))} /></FormField>
        </SpaceBetween>
      </Modal>
    </>
  );
}
