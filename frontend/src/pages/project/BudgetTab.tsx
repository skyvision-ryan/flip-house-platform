import { useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Container from '@cloudscape-design/components/container';
import DatePicker from '@cloudscape-design/components/date-picker';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import Modal from '@cloudscape-design/components/modal';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table from '@cloudscape-design/components/table';
import Tabs from '@cloudscape-design/components/tabs';
import { api, BudgetLine, BudgetSummary, Expense, ProcurementItem, ProcurementSummary } from '../../api/client';
import { useFlash } from '../../lib/flash';
import { dateStr, money, pct, text } from '../../lib/format';
import { useMeta } from '../../lib/meta';
import { useRole } from '../../lib/role';
import ReviewTag from '../../components/ReviewTag';
import OwnerTag from '../../components/OwnerTag';
import { DeltaBadge, InlineBar, Meter, StatTile, compactMoney } from '../../components/charts';

const STATUS_TONE: Record<string, 'error' | 'warning' | 'success' | 'info' | 'stopped'> = {
  pending_spec: 'warning',
  pending_order: 'info',
  ordered: 'info',
  received: 'success',
  exception: 'error',
  na: 'stopped',
};

export default function BudgetTab({ projectId, reload, section }: { projectId: number; reload: () => Promise<any>; section?: string | null }) {
  const meta = useMeta();
  const role = useRole();
  const flash = useFlash();
  const canMoney = role.canReadMoney;
  const [summary, setSummary] = useState<BudgetSummary | null>(null);
  const [lines, setLines] = useState<BudgetLine[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [procItems, setProcItems] = useState<ProcurementItem[]>([]);
  const [procSummary, setProcSummary] = useState<ProcurementSummary | null>(null);
  const [procMissing, setProcMissing] = useState(false);
  const [lineModal, setLineModal] = useState(false);
  const [expModal, setExpModal] = useState(false);
  const [lineDraft, setLineDraft] = useState({ category: '', planned_amount: '' });
  const [expDraft, setExpDraft] = useState({ category: '', amount: '', date: '', vendor: '', note: '' });
  const [waveFilter, setWaveFilter] = useState<{ label: string; value: string }>({ label: '全部节点', value: '' });
  const [statusFilter, setStatusFilter] = useState<{ label: string; value: string }>({ label: '全部状态', value: '' });
  const [activeTab, setActiveTab] = useState(section === 'procurement' || !canMoney ? 'procurement' : 'money');

  const load = useCallback(async () => {
    const proc = await api.procurement(projectId).catch(() => null);
    if (proc) { setProcItems(proc.items); setProcSummary(proc.summary); setProcMissing(!!proc.template_missing); }
    if (canMoney) {
      const [s, l, e] = await Promise.all([api.budgetSummary(projectId), api.budgetLines(projectId), api.expenses(projectId)]);
      setSummary(s); setLines(l); setExpenses(e);
    }
  }, [projectId, canMoney]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (section === 'procurement') setActiveTab('procurement'); }, [section]);

  const catOptions = meta?.budget_categories.map((c) => ({ label: c, value: c })) ?? [];
  const waveOptions = [{ label: '全部节点', value: '' }, ...(meta?.procurement_waves ?? [])];
  const statusOptions = [{ label: '全部状态', value: '' }, ...(meta?.procurement_statuses ?? [])];
  const statusLabel = (v: string) => meta?.procurement_statuses.find((s) => s.value === v)?.label ?? v;
  const waveLabel = (v: string) => meta?.procurement_waves.find((s) => s.value === v)?.label ?? v;

  const filteredProc = useMemo(() => procItems.filter((i) => {
    if (waveFilter.value && i.wave !== waveFilter.value) return false;
    if (statusFilter.value && i.status !== statusFilter.value) return false;
    return true;
  }), [procItems, waveFilter.value, statusFilter.value]);

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
  const setProcStatus = async (item: ProcurementItem, status: string) => {
    const next = await api.patchProcurement(item.id, { status });
    setProcItems(next.items); setProcSummary(next.summary);
    await reload();
    flash({ type: 'success', content: `「${item.name}」→ ${statusLabel(status)}` });
  };

  const moneyPanel = (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2"><ReviewTag id="A" /><OwnerTag block="budget.summary" />汇总</Header>}>
        <SpaceBetween size="m">
          <ColumnLayout columns={4} variant="text-grid">
            <StatTile label="总预算" value={compactMoney(summary?.planned_total)} sub={`${lines.length} 个预算项`} />
            <StatTile label="已支出" value={compactMoney(summary?.spent_total)} sub={`${expenses.length} 笔`} />
            <StatTile label="剩余" value={compactMoney(summary?.remaining)} tone={summary && summary.remaining < 0 ? 'bad' : undefined} sub={summary && summary.remaining < 0 ? '已超支' : '预算 − 已支出'} />
            <StatTile label="已用比例" value={pct(summary?.used_pct)} tone={summary?.used_pct != null && summary.used_pct > 105 ? 'bad' : undefined} sub="超过 105% 记为有风险" />
          </ColumnLayout>
          {summary && summary.planned_total > 0 && (
            <Meter value={summary.spent_total} max={summary.planned_total} label="预算已用" reading={`${compactMoney(summary.spent_total)} / ${compactMoney(summary.planned_total)}`} targetLabel="预算" note={summary.remaining >= 0 ? `剩余 ${compactMoney(summary.remaining)}` : `已超支 ${compactMoney(-summary.remaining)}，红色那段就是超出的部分`} />
          )}
        </SpaceBetween>
      </Container>

      <Table
        header={<Header variant="h2" counter={`(${summary?.categories.length ?? 0})`} description="按类别对比计划与实际。"><ReviewTag id="B" /><OwnerTag block="budget.summary" />预算 vs 实际</Header>}
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
        <Table
          header={<Header variant="h2" counter={`(${lines.length})`} actions={<Button onClick={() => setLineModal(true)}>添加预算项</Button>}><ReviewTag id="C" /><OwnerTag block="budget.lines" />预算项</Header>}
          items={lines}
          empty={<Box textAlign="center" color="inherit"><b>还没有预算项</b></Box>}
          columnDefinitions={[
            { id: 'c', header: '类别', cell: (l) => l.category },
            { id: 'a', header: '计划金额', cell: (l) => money(l.planned_amount) },
            { id: 'x', header: '', cell: (l) => <Button variant="inline-link" onClick={async () => { await api.deleteBudgetLine(l.id); await load(); await reload(); }}>删除</Button> },
          ]}
        />
        <Table
          header={<Header variant="h2" counter={`(${expenses.length})`} actions={<Button onClick={() => setExpModal(true)}>记一笔支出</Button>} description="发票与付款记在这里；材料进度在「采购」页签。"><ReviewTag id="D" /><OwnerTag block="budget.expenses" />支出</Header>}
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

  const procurementPanel = (
    <SpaceBetween size="l">
      <div id="procurement" />
      <Container header={<Header variant="h2" description="水电检查前那组材料都到货（或不适用），「分阶段采购」才算有证据。异常项优先处理。" actions={procMissing ? <Button variant="primary" onClick={async () => { const r = await api.initProcurement(projectId); setProcItems(r.items); setProcSummary(r.summary); setProcMissing(false); flash({ type: 'success', content: `已按采购表模板建了 ${r.items.length} 行` }); }}>按模板初始化</Button> : undefined}><ReviewTag id="E" /><OwnerTag block="budget.procurement" />采购清单</Header>}>
        {procMissing && <Box color="text-body-secondary" margin={{ bottom: 's' }}>这套房还没有采购清单，点右上角按 J 的采购表模板建 37 行。</Box>}
        <ColumnLayout columns={5} variant="text-grid">
          <StatTile label="待选型" value={String(procSummary?.pending_spec ?? 0)} />
          <StatTile label="待下单" value={String(procSummary?.pending_order ?? 0)} />
          <StatTile label="已下单" value={String(procSummary?.ordered ?? 0)} />
          <StatTile label="已到货" value={String(procSummary?.received ?? 0)} />
          <StatTile label="异常" value={String(procSummary?.exception ?? 0)} tone={(procSummary?.exception ?? 0) > 0 ? 'bad' : undefined} />
        </ColumnLayout>
      </Container>
      <Table
        header={
          <Header
            variant="h2"
            counter={`(${filteredProc.length})`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Select selectedOption={waveFilter} options={waveOptions} onChange={({ detail }) => setWaveFilter(detail.selectedOption as any)} />
                <Select selectedOption={statusFilter} options={statusOptions} onChange={({ detail }) => setStatusFilter(detail.selectedOption as any)} />
              </SpaceBetween>
            }
          >
            材料明细
          </Header>
        }
        items={filteredProc}
        empty={<Box textAlign="center" color="inherit">没有匹配的采购项</Box>}
        columnDefinitions={[
          { id: 'n', header: '材料', minWidth: 200, cell: (i) => <div><div style={{ fontWeight: 600 }}>{i.name}</div>{i.note && <Box variant="small" color="text-body-secondary">{i.note}</Box>}</div> },
          { id: 'w', header: '节点', cell: (i) => waveLabel(i.wave) },
          {
            id: 's', header: '状态', width: 140,
            cell: (i) => <StatusIndicator type={STATUS_TONE[i.status] ?? 'info'}>{statusLabel(i.status)}</StatusIndicator>,
          },
          {
            id: 'a', header: '改状态', minWidth: 160,
            cell: (i) => (
              <Select
                selectedOption={{ label: statusLabel(i.status), value: i.status }}
                options={meta?.procurement_statuses ?? []}
                onChange={({ detail }) => setProcStatus(i, detail.selectedOption.value!)}
              />
            ),
          },
        ]}
      />
    </SpaceBetween>
  );

  return (
    <>
      {canMoney ? (
        <Tabs
          activeTabId={activeTab}
          onChange={({ detail }) => setActiveTab(detail.activeTabId)}
          tabs={[
            { id: 'money', label: '预算与支出', content: moneyPanel },
            { id: 'procurement', label: `采购${procSummary ? `（待办 ${(procSummary.pending_spec + procSummary.pending_order + procSummary.exception)}）` : ''}`, content: procurementPanel },
          ]}
        />
      ) : procurementPanel}

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
