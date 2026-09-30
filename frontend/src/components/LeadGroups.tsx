import { systemText } from '../i18n/core.ts';
import { useLanguage } from '../i18n/LanguageProvider';
import { m as uiText } from '../i18n/core.ts';
import Badge from '@cloudscape-design/components/badge';
import Box from '@cloudscape-design/components/box';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Meta, Project, api } from '../api/client';
import { useFlash } from '../lib/flash';
import { money } from '../lib/format';
import { groupBySubstage, heatLabel, isLead, nextUpText } from '../lib/leads';
import Header from './ui/Header';
import Container from './ui/Surface';

/**
 * 线索房按子阶段分组的列表（KAN-50）。
 *
 * 分组与文案规则在 lib/leads.ts，那边是纯函数、可单测；这里只负责渲染与保存。
 *
 * **空组用紧凑标题**，不占一整张卡——六张空卡会把手机屏塞满，而计数本身才是信息。
 */
export default function LeadGroups({
  projects, meta, canEdit, onPatched,
}: {
  projects: Project[] | null;
  meta: Meta | null | undefined;
  canEdit: boolean;
  onPatched: (p: Project) => void;
}) {
  useLanguage();
  if (projects === null) {
    return <Box padding="xxl" textAlign="center"><Spinner size="large" /> {uiText("leadGroups.loading.leads")}</Box>;
  }
  const groups = groupBySubstage(projects, meta);
  if (groups.length === 0) {
    return <Box padding="l" color="text-body-secondary">{uiText("leadGroups.cannot.load.follow.up.stages.refresh.the.page")}</Box>;
  }

  return (
    <SpaceBetween size="l">
      {groups.map((g) => (g.projects.length === 0 ? (
        // 空组：只留一行计数，说明这一档现在没有房子
        <Box key={g.value} color="text-body-secondary" fontSize="body-s">{systemText(g.label)}　{uiText("leadGroups.0.properties")}</Box>
      ) : (
        <Container cardId="lead-group" cardContext={systemText(g.label)} key={g.value} header={<Header variant="h2" counter={`(${g.projects.length})`}>{systemText(g.label)}</Header>}>
          <SpaceBetween size="m">
            {g.projects.map((p) => (
              <LeadRow key={p.id} p={p} meta={meta} canEdit={canEdit} onPatched={onPatched} />
            ))}
          </SpaceBetween>
        </Container>
      )))}
    </SpaceBetween>
  );
}

/** 一条线索。整块可点进项目，但右侧的操作菜单**不能**把点击冒泡成「进详情」。 */
function LeadRow({ p, meta, canEdit, onPatched }: {
  p: Project; meta: Meta | null | undefined; canEdit: boolean; onPatched: (p: Project) => void;
}) {
  useLanguage();
  const navigate = useNavigate();
  const flash = useFlash();
  const [saving, setSaving] = useState(false);

  const heat = heatLabel(p);
  const next = nextUpText(p);
  const subOptions = (meta?.substages?.lead ?? []).map((s) => ({ id: s.value, text: s.label, disabled: s.value === p.substage }));

  const setSubstage = async (value: string) => {
    if (saving) return;                       // 保存中不接第二次点击
    setSaving(true);
    try {
      const updated = await api.patchProject(p.id, { substage: value });
      // **以服务器返回为准。** 期间可能有人确认了 Open Escrow，后端的 sync_legacy_stage
      // 会把这套房推进到下一段——那时它已经不是线索了，不能假装保存成功还留在原组。
      onPatched(updated);
      if (!isLead(updated)) {
        flash({ type: 'info', content: uiText("sentences.has.passed.open.escrow.and.is.no.longer.a.lead", { value1: (p.name) }) });
      } else {
        const label = subOptions.find((o) => o.id === updated.substage)?.text ?? updated.substage;
        flash({ type: 'success', content: uiText("sentences.moved.to", { value1: (p.name), value2: (label) }) });
      }
    } catch (e: unknown) {
      // 保存失败：不动本地状态，这一条留在原组
      flash({ type: 'error', content: uiText("sentences.could.not.change.the.follow.up.stage.of", { value1: (p.name), value2: (e instanceof Error ? e.message : String(e)) }) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ui-lead-row">
      <div className="ui-lead-body">
        <SpaceBetween size="xxs">
          <div className="ui-row-wrap">
            <Link fontSize="heading-s" href={`/projects/${p.id}`} onFollow={(e) => { e.preventDefault(); navigate(`/projects/${p.id}`); }}>{p.name}</Link>
            {heat && <Badge>{heat}</Badge>}
          </div>
          <Box variant="small" color="text-body-secondary">{p.property.address_std}</Box>

          {/* 两个金额并排很容易被读成「低买高卖的价差」，所以各自写全名、标清是参考数据。 */}
          <Box fontSize="body-s">
            {uiText("leadGroups.list.price")} {p.property.list_price == null ? uiText("leadGroups.not.provided") : money(p.property.list_price)}
            <Box variant="span" color="text-body-secondary">　{uiText("leadGroups.automated.valuation")} {p.property.avm_value == null ? uiText("leadGroups.not.provided") : money(p.property.avm_value)}</Box>
          </Box>

          {/* 「待办参考」不是「轮到谁」：next_up 按模板顺序取，判定看证据规则，
              已出价的房子也可能因为没传照片而显示「看房」。角色不是具体的人。 */}
          {next && (
            <Box fontSize="body-s" color="text-body-secondary">
              {uiText("leadGroups.suggested.next.task")}{next.task}{next.roles ? uiText("sentences.responsible.roles", { value1: (next.roles) }) : ''}
            </Box>
          )}
        </SpaceBetween>
      </div>

      {canEdit && (
        // stopPropagation：下拉的点击不能被当成「点了这一条」
        <div onClick={(e) => e.stopPropagation()}>
          <ButtonDropdown
            items={subOptions}
            loading={saving}
            disabled={saving || subOptions.length === 0}
            onItemClick={({ detail }) => { void setSubstage(detail.id); }}
          >
            {uiText("leadGroups.change.follow.up.stage")} </ButtonDropdown>
        </div>
      )}
    </div>
  );
}
