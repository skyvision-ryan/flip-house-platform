import { systemText } from '../../i18n/core.ts';
import { useLanguage } from '../../i18n/LanguageProvider';
import { m as uiText } from '../../i18n/core.ts';
import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
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
  useLanguage();
  const flash = useFlash();
  const [error, setError] = useState('');
  const [data, setData] = useState<PropertyData | null>(null);
  const [activeTab, setActiveTab] = useState(section === 'utilities' ? 'utilities' : 'specs');

  const load = useCallback(() => api.propertyData(projectId).then(d => { setData(d); setError(''); }).catch(e => setError(e.message)), [projectId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (section === 'utilities') setActiveTab('utilities');
  }, [section]);

  if (error) return <Alert type="error" action={<Button onClick={load}>{uiText("addProject.retry")}</Button>}>{systemText(error)}</Alert>;
  if (!data) return <Box padding="l" textAlign="center"><Spinner /></Box>;

  const conflicts = data.fields.filter((f) => f.has_conflict).length;

  return (
    <Tabs
      activeTabId={activeTab}
      onChange={({ detail }) => setActiveTab(detail.activeTabId)}
      tabs={[
        {
          id: 'specs',
          label: uiText("dataTab.property.specifications"),
          content: (
            <Container cardId="property-data" header={<Header variant="h2" description={conflicts ? uiText("sentences.fields.have.conflicting.sources.select.primary.values", { value1: (conflicts) }) : undefined} help={uiText("dataTab.select.a.field.s.source.label.to.view.retrieval")}>{uiText("dataTab.property.building.and.parcel")}</Header>}>
              <div className="ui-field-grid">
                {data.fields.map((f) => (
                  <FieldWithSource
                    key={f.key}
                    field={f}
                    onSave={async (v) => { setData(await api.patchField(projectId, f.key, v)); await reload(); flash({ type: 'success', content: uiText("sentences.updated.source.marked.manual", { value1: (systemText(f.label)) }) }); }}
                    onSetPrimary={async (sid) => { setData(await api.setPrimary(projectId, f.key, sid)); await reload(); }}
                  />
                ))}
              </div>
            </Container>
          ),
        },
        {
          id: 'utilities',
          label: uiText("dataTab.utilities"),
          content: (
            <Container cardId="property-utilities" header={<Header variant="h2" help={uiText("dataTab.record.providers.account.details.and.current.status.separately.credentials")}>{uiText("dataTab.water.electricity.and.gas.accounts")}</Header>}>
              <UtilitiesPanel projectId={projectId} onChanged={reload} />
            </Container>
          ),
        },
        {
          id: 'owner',
          label: uiText("addProject.property.owner"),
          content: (
            <Container cardId="property-owner" header={<Header variant="h2">{uiText("cardRegistry.ownership")}</Header>}>
              {data.owner ? (
                <KeyValuePairs columns={3} items={[
                  { label: uiText("addProject.property.owner"), value: text(data.owner.name) },
                  { label: uiText("addProject.mailing.address"), value: text(data.owner.mailing_address) },
                  { label: uiText("addProject.owned.since"), value: dateStr(data.owner.owner_since) },
                  { label: uiText("dataTab.phone"), value: text(data.owner.phone) },
                  { label: uiText("login.email"), value: text(data.owner.email) },
                ]} />
              ) : <Box color="text-body-secondary">{uiText("addProject.no.ownership.information")}</Box>}
            </Container>
          ),
        },
        {
          id: 'mortgage',
          label: uiText("addProject.mortgages"),
          content: (
            <Table cardId="property-mortgages"
              header={<Header variant="h2" counter={`(${data.mortgages.length})`}>{uiText("cardRegistry.current.mortgages")}</Header>}
              items={data.mortgages}
              empty={<Box textAlign="center" color="inherit">{uiText("addProject.no.mortgage.records")}</Box>}
              columnDefinitions={[
                { id: 'd', header: uiText("addProject.recording.date"), cell: (m) => dateStr(m.recording_date) },
                { id: 'l', header: uiText("addProject.lender"), cell: (m) => text(m.lender) },
                { id: 't', header: uiText("dataTab.type"), cell: (m) => text(m.loan_type) },
                { id: 'term', header: uiText("dataTab.term.months"), cell: (m) => text(m.term_months) },
                { id: 'o', header: uiText("addProject.original.principal"), cell: (m) => money(m.original_balance) },
                { id: 'e', header: uiText("addProject.estimated.balance"), cell: (m) => money(m.est_balance) },
                { id: 'r', header: uiText("addProject.interest.rate"), cell: (m) => pct(m.rate, 2) },
                { id: 'p', header: uiText("dataTab.monthly.payment"), cell: (m) => money(m.payment) },
              ]}
            />
          ),
        },
        {
          id: 'history',
          label: uiText("dataTab.history"),
          content: (
            <SpaceBetween size="l">
              <Table cardId="property-sales"
                header={<Header variant="h2" counter={`(${data.sales_history.length})`}>{uiText("cardRegistry.sales.history")}</Header>}
                items={data.sales_history}
                empty={<Box textAlign="center" color="inherit">{uiText("addProject.no.sales.records")}</Box>}
                columnDefinitions={[
                  { id: 'd', header: uiText("addProject.recording.date"), cell: (s) => dateStr(s.recording_date) },
                  { id: 's', header: uiText("addProject.seller"), cell: (s) => text(s.seller) },
                  { id: 'b', header: uiText("addProject.buyer"), cell: (s) => text(s.buyer) },
                  { id: 't', header: uiText("dataTab.deed.type"), cell: (s) => text(s.doc_type) },
                  { id: 'a', header: uiText("procurementItemRow.amount"), cell: (s) => money(s.amount) },
                ]}
              />
            </SpaceBetween>
          ),
        },
      ]}
    />
  );
}
