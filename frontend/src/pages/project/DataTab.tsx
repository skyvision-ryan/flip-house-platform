import Box from '@cloudscape-design/components/box';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import Tabs from '@cloudscape-design/components/tabs';
import { useCallback, useEffect, useState } from 'react';
import { api, PropertyData } from '../../api/client';
import FieldWithSource from '../../components/FieldWithSource';
import KeyValuePairs from '../../components/ui/Facts';
import Header from '../../components/ui/Header';
import Container from '../../components/ui/Surface';
import Table from '../../components/ui/Table';
import UtilitiesPanel from '../../components/UtilitiesPanel';
import { useFlash } from '../../lib/flash';
import { dateStr, money, pct, text } from '../../lib/format';

export default function DataTab({ projectId, reload, section }: { projectId: number; reload: () => Promise<any>; section?: string | null }) {
  const flash = useFlash();
  const [data, setData] = useState<PropertyData | null>(null);
  const [activeTab, setActiveTab] = useState(section === 'utilities' ? 'utilities' : 'specs');

  const load = useCallback(() => api.propertyData(projectId).then(setData), [projectId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (section === 'utilities') setActiveTab('utilities');
  }, [section]);

  if (!data) return <Box padding="l" textAlign="center"><Spinner /></Box>;

  const conflicts = data.fields.filter((f) => f.has_conflict).length;

  return (
    <Tabs
      activeTabId={activeTab}
      onChange={({ detail }) => setActiveTab(detail.activeTabId)}
      tabs={[
        {
          id: 'specs',
          label: '房产规格',
          content: (
            <Container cardId="property-data" header={<Header variant="h2" description={conflicts ? `${conflicts} 个字段来源冲突，需选择主值。` : undefined} help="点击字段旁的来源标签，查看获取时间与把握度。">房产、结构与地块</Header>}>
              <div className="ui-field-grid">
                {data.fields.map((f) => (
                  <FieldWithSource
                    key={f.key}
                    field={f}
                    onSave={async (v) => { setData(await api.patchField(projectId, f.key, v)); await reload(); flash({ type: 'success', content: `${f.label} 已更新，来源标记为“人工”` }); }}
                    onSetPrimary={async (sid) => { setData(await api.setPrimary(projectId, f.key, sid)); await reload(); }}
                  />
                ))}
              </div>
            </Container>
          ),
        },
        {
          id: 'utilities',
          label: '水电瓦斯',
          content: (
            <Container cardId="property-utilities" header={<Header variant="h2" help="分别记录服务公司、开户信息和当前状态。账号凭证仍按现有权限显示。">水、电、瓦斯账户</Header>}>
              <UtilitiesPanel projectId={projectId} onChanged={reload} />
            </Container>
          ),
        },
        {
          id: 'owner',
          label: '业主',
          content: (
            <Container cardId="property-owner" header={<Header variant="h2">业主信息</Header>}>
              {data.owner ? (
                <KeyValuePairs columns={3} items={[
                  { label: '业主', value: text(data.owner.name) },
                  { label: '邮寄地址', value: text(data.owner.mailing_address) },
                  { label: '持有自', value: dateStr(data.owner.owner_since) },
                  { label: '电话', value: text(data.owner.phone) },
                  { label: '邮箱', value: text(data.owner.email) },
                ]} />
              ) : <Box color="text-body-secondary">无业主信息</Box>}
            </Container>
          ),
        },
        {
          id: 'mortgage',
          label: '按揭',
          content: (
            <Table cardId="property-mortgages"
              header={<Header variant="h2" counter={`(${data.mortgages.length})`}>当前按揭</Header>}
              items={data.mortgages}
              empty={<Box textAlign="center" color="inherit">无按揭记录</Box>}
              columnDefinitions={[
                { id: 'd', header: '登记日期', cell: (m) => dateStr(m.recording_date) },
                { id: 'l', header: '贷方', cell: (m) => text(m.lender) },
                { id: 't', header: '类型', cell: (m) => text(m.loan_type) },
                { id: 'term', header: '期限（月）', cell: (m) => text(m.term_months) },
                { id: 'o', header: '原始金额', cell: (m) => money(m.original_balance) },
                { id: 'e', header: '估算余额', cell: (m) => money(m.est_balance) },
                { id: 'r', header: '利率', cell: (m) => pct(m.rate, 2) },
                { id: 'p', header: '月供', cell: (m) => money(m.payment) },
              ]}
            />
          ),
        },
        {
          id: 'history',
          label: '历史',
          content: (
            <SpaceBetween size="l">
              <Table cardId="property-sales"
                header={<Header variant="h2" counter={`(${data.sales_history.length})`}>成交史</Header>}
                items={data.sales_history}
                empty={<Box textAlign="center" color="inherit">无成交记录</Box>}
                columnDefinitions={[
                  { id: 'd', header: '登记日期', cell: (s) => dateStr(s.recording_date) },
                  { id: 's', header: '卖方', cell: (s) => text(s.seller) },
                  { id: 'b', header: '买方', cell: (s) => text(s.buyer) },
                  { id: 't', header: '契约类型', cell: (s) => text(s.doc_type) },
                  { id: 'a', header: '金额', cell: (s) => money(s.amount) },
                ]}
              />
            </SpaceBetween>
          ),
        },
      ]}
    />
  );
}
