import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { FileRow, StepItem } from '../api/client';
import { useMeta } from '../lib/meta';
import { useRole } from '../lib/role';
import { actionLabel, actionMode, canActOn, canConfirm } from '../lib/stepActions';
import { attachmentsFor, factOf, limitsOf } from '../lib/stepDisplay';
import { RoleNames } from './RoleLabel';
import HelpText from './HelpText';
import ExpandableSection from './ui/ExpandableSection';
import KeyValuePairs from './ui/Facts';

const shortDate = (iso?: string | null) => (iso ? iso.slice(5, 10).replace('-', '/') : '');

function FileLines({ rows, empty }: { rows: FileRow[]; empty: string }) {
  useLanguage();
  if (!rows.length) return <Box color="text-body-secondary" fontSize="body-s">{empty}</Box>;
  return (
    <SpaceBetween size="xxs">
      {rows.map((f) => (
        <Box key={f.id} fontSize="body-s">
          {f.filename}
          <Box variant="span" color="text-body-secondary">
            {'　'}
            {f.uploaded_by ?? '—'} · {shortDate(f.uploaded_at)}
          </Box>
        </Box>
      ))}
    </SpaceBetween>
  );
}

/**
 * 事项详情：把一件事说清楚——谁负责、这件事是什么、要交什么、怎么算完成、
 * 现在是什么状态（附依据）、已经交了什么。只陈述后端给的事实，不做推导。
 */
export default function TaskDetail({
  item,
  stageLabel,
  files,
  onPrimary,
  onDismiss,
}: {
  item: StepItem | null;
  stageLabel: string;
  files: FileRow[];
  onPrimary: (it: StepItem) => void;
  onDismiss: () => void;
}) {
  useLanguage();
  const meta = useMeta();
  const role = useRole();

  if (!item) return <Modal visible={false} onDismiss={onDismiss} header="" />;

  const fact = factOf(item);
  const isOwner = item.owners.includes(role.actor);
  const limits = item.done ? [] : limitsOf(item, role.actor, role.can('tick_any'), isOwner);
  const { bound, byType } = attachmentsFor(item, files);
  const dv = item.deliverable;

  const canDo = item.gate && item.confirm.length > 0 ? canConfirm(item, role) : canActOn(item, role);
  const mode = actionMode(item);
  const showPrimary = canDo && mode !== 'view' && !item.done;

  const duties = item.owners
    .map((c) => meta?.roles.find((r) => r.code === c)?.duties)
    .filter(Boolean) as string[];

  const kv = [
    {
      label: uiText("taskDetail.responsible.role"),
      value: (
        <SpaceBetween size="xxs">
          <Box>
            <RoleNames codes={item.owners} />
          </Box>
          {duties.map((d) => (
            <HelpText key={d} inline>{d}</HelpText>
          ))}
        </SpaceBetween>
      ),
    },
    ...(item.purpose ? [{ label: uiText("taskDetail.task.purpose"), value: <Box>{systemText(item.purpose)}</Box> }] : []),
    ...(dv ? [{ label: uiText("taskDetail.required.deliverable"), value: <Box>{systemText(dv.label)}</Box> }] : []),
    ...(item.done_when ? [{ label: uiText("taskDetail.completion.criteria"), value: <Box>{systemText(item.done_when)}</Box> }] : []),
    {
      label: uiText("taskDetail.current.state"),
      value: (
        <SpaceBetween size="xxs">
          <StatusIndicator type={fact.indicator}>{systemText(fact.label)}</StatusIndicator>
          {fact.basis.map((b) => (
            <Box key={b} color="text-body-secondary" fontSize="body-s">{uiText("stepsPanel.evidence")}{systemText(b)}</Box>
          ))}
          {fact.hint && (
            <Box color="text-body-secondary" fontSize="body-s">{fact.hint}</Box>
          )}
        </SpaceBetween>
      ),
    },
  ];

  return (
    <Modal
      visible
      onDismiss={onDismiss}
      header={
        <SpaceBetween size="xxs">
          <Box variant="h2">{item.title}</Box>
          <Box color="text-body-secondary" fontSize="body-s">
            {stageLabel}
            {item.ws ? ` · ${item.ws}` : ''}
          </Box>
        </SpaceBetween>
      }
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss}>{uiText("myTodoTable.close")}</Button>
            {showPrimary && (
              <Button variant="primary" onClick={() => onPrimary(item)}>
                {actionLabel(item, { actor: role.actor, canDo: true })}
              </Button>
            )}
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="l">
        <KeyValuePairs columns={1} items={kv} />

        {limits.length > 0 && (
          <Alert type="info" header={uiText("taskDetail.action.restrictions")}>
            <SpaceBetween size="xxs">
              {limits.map((l) => <Box key={l}>{l}</Box>)}
            </SpaceBetween>
          </Alert>
        )}

        <ExpandableSection
          variant="footer"
          defaultExpanded
          headerText={uiText("sentences.photos.files.linked.to.this.item", { value1: (bound.length) })}
        >
          <FileLines rows={bound} empty={uiText("taskDetail.no.photos.or.files.are.linked.to.this.task")} />
        </ExpandableSection>

        {byType.length > 0 && (
          <ExpandableSection variant="footer" headerText={uiText("sentences.other.project.documents.of.this.type", { value1: (byType.length) })}>
            <SpaceBetween size="xs">
              <Box color="text-body-secondary" fontSize="body-s">
                {uiText("taskDetail.matched.by.file.type.not.a.submission.for.this")} </Box>
              <FileLines rows={byType} empty="" />
            </SpaceBetween>
          </ExpandableSection>
        )}
      </SpaceBetween>
    </Modal>
  );
}
