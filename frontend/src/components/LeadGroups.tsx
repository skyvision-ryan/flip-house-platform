import { useState } from 'react';
import Box from '@cloudscape-design/components/box';
import Badge from '@cloudscape-design/components/badge';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import { useNavigate } from 'react-router-dom';
import { Meta, Project, api } from '../api/client';
import { useFlash } from '../lib/flash';
import { money } from '../lib/format';
import { groupBySubstage, heatLabel, isLead, nextUpText } from '../lib/leads';

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
  if (projects === null) {
    return <Box padding="xxl" textAlign="center"><Spinner size="large" /> 正在读取线索</Box>;
  }
  const groups = groupBySubstage(projects, meta);
  if (groups.length === 0) {
    return <Box padding="l" color="text-body-secondary">读不到子阶段字典，先刷新一次页面。</Box>;
  }

  return (
    <SpaceBetween size="l">
      {groups.map((g) => (g.projects.length === 0 ? (
        // 空组：只留一行计数，说明这一档现在没有房子
        <Box key={g.value} color="text-body-secondary" fontSize="body-s">{g.label}　0 套</Box>
      ) : (
        <Container key={g.value} header={<Header variant="h2" counter={`(${g.projects.length})`}>{g.label}</Header>}>
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
        flash({ type: 'info', content: `${p.name} 已经过了 Open escrow，不再是线索；子阶段没有保存。` });
      } else {
        const label = subOptions.find((o) => o.id === updated.substage)?.text ?? updated.substage;
        flash({ type: 'success', content: `${p.name} 移到「${label}」` });
      }
    } catch (e: unknown) {
      // 保存失败：不动本地状态，这一条留在原组
      flash({ type: 'error', content: `没能修改「${p.name}」的子阶段：${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 12, minWidth: 0 }}>
      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
        <SpaceBetween size="xxs">
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <Link fontSize="heading-s" href={`/projects/${p.id}`} onFollow={(e) => { e.preventDefault(); navigate(`/projects/${p.id}`); }}>{p.name}</Link>
            {heat && <Badge>{heat}</Badge>}
          </div>
          <Box variant="small" color="text-body-secondary">{p.property.address_std}</Box>

          {/* 两个金额并排很容易被读成「低买高卖的价差」，所以各自写全名、标清是参考数据。 */}
          <Box fontSize="body-s">
            挂牌价 {money(p.property.list_price) || '未提供'}
            <Box variant="span" color="text-body-secondary">　·　自动估值 {money(p.property.avm_value) || '未提供'}</Box>
          </Box>

          {/* 「待办参考」不是「轮到谁」：next_up 按模板顺序取，判定看证据规则，
              已出价的房子也可能因为没传照片而显示「看房」。角色不是具体的人。 */}
          {next && (
            <Box fontSize="body-s" color="text-body-secondary">
              待办参考：{next.task}{next.roles ? `　负责角色 ${next.roles}` : ''}
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
            改子阶段
          </ButtonDropdown>
        </div>
      )}
    </div>
  );
}
