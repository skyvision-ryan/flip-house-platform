import { createContext, useContext } from 'react';
import Box from '@cloudscape-design/components/box';
import { useMeta } from '../lib/meta';
import { useActor } from '../lib/actor';
import { colorOf } from '../lib/role';
import { SURFACE, TEXT, TEXT_2, BORDER } from './charts/palette';

/**
 * 角色色圈开关（KAN-64）。**默认关**，口径与理由见 lib/rolePref.ts。
 * 和评审标注（ReviewTag.tsx 的 ReviewContext）是并列的两个开关，互不影响。
 */
export const RoleColorContext = createContext<boolean>(false);
export const useRoleColorsOn = () => useContext(RoleColorContext);

/**
 * 负责角色的圆标：单字母画圆，多字（设计师 / 园丁 / 负责人 / ？）画胶囊。
 *
 * 审计 #A09：原先底色取自后端 tier 配置的紫/蓝/青/灰，颜色编码的是**角色层级**，
 * 属分类信息不是状态，违反「颜色只表状态」。现在一律中性底，层级靠 OwnerNames 的文字。
 * 圆标宽度刻意不变（22px 单字母）——15 个使用点里有紧凑表格，加文字会全面变宽。
 * 后端 /api/meta 仍然下发 tiers[].color，只是界面不再消费（审计 #A23）。
 */
export function OwnerDot({ code, title }: { code: string; title?: string }) {
  const meta = useMeta();
  const single = [...code].length === 1;
  const unknown = code === '?';
  const tierLabel = meta?.tiers?.[meta?.roles.find((r) => r.code === code)?.tier ?? '']?.label;
  return (
    <span
      title={title ?? `${code}${tierLabel ? `（${tierLabel}）` : ''}`}
      aria-label={title ?? `负责角色：${code}`}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        minWidth: 22, height: 22, borderRadius: 11, padding: single ? 0 : '0 7px',
        background: SURFACE, color: unknown ? TEXT_2 : TEXT,
        border: unknown ? `1px dashed ${BORDER}` : `1px solid ${BORDER}`,
        fontWeight: 700, fontSize: single ? 13 : 11, lineHeight: 1,
        marginRight: 4, verticalAlign: 'middle', flexShrink: 0, userSelect: 'none', whiteSpace: 'nowrap',
      }}
    >
      {code}
    </span>
  );
}

/**
 * 负责角色，圆标 + 可见代号。手机上没有 hover，代号必须直接看得见。
 *
 * 圆标留在这里是因为它用在勾选框旁边——那里要一眼看出是谁点的确认。
 * 但**不再拼级别词**：原先渲染成「D决策 J决策」，级别是这个人的属性，
 * 不是这套房的状态，堆在事项卡上只是噪声。级别还在 OwnerDot 的 title 里，悬停可看。
 */
export function OwnerNames({ codes, prefix }: { codes: string[]; prefix?: string }) {
  if (!codes.length) return null;
  return (
    <Box variant="span" color="text-body-secondary" fontSize="body-s">
      {prefix}
      {codes.map((c) => (
        <Box key={c} variant="span" margin={{ right: 'xs' }}>
          <OwnerDot code={c} />
        </Box>
      ))}
    </Box>
  );
}

/**
 * 按功能块名从字典取负责人；也可直接传 codes。用在各节标题前面。
 *
 * 两种形态，由「角色色圈」开关决定（KAN-64）：
 * - **关**（默认）：一行次要文字「负责 D、J」。每个标题前挂一颗 22px 粗体圆标，
 *   一屏下来就是一排圈，比标题本身还抢眼；日常看板不需要这个。
 * - **开**：按 tier 上色的圆标，讲解时一眼分得出决策 / 统筹 / 执行 / 外部。
 *
 * 色值走 colorOf()，从后端 /meta 的 tiers[].color 取，回落 lib/role.ts 的
 * TIER_FALLBACK——**本文件不能出现裸 hex**，hexGuard.test.ts 的允许名单里没有它。
 *
 * 勾选框、表格里那些要辨认「谁点的」的地方仍用 OwnerDot，不受这个开关影响。
 */
export default function OwnerTag({ block, codes }: { block?: string; codes?: string[] }) {
  const meta = useMeta();
  const { actor } = useActor();
  const colorsOn = useRoleColorsOn();
  const list = (codes ?? (block ? meta?.owner_map?.[block] : undefined) ?? []).map((c) => (c === '当前身份' ? actor : c));
  if (!list.length) return null;

  if (colorsOn) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', marginRight: 8, verticalAlign: 'middle' }}>
        {list.map((c) => <TierDot key={c} code={c} color={colorOf(meta, c)} />)}
      </span>
    );
  }
  // 调用处紧接着就是标题文字（<OwnerTag />检查记录），中间没有空格，
  // 不留间距会读成「负责 Z检查记录」。
  return (
    <Box variant="span" color="text-body-secondary" fontSize="body-s">
      <span style={{ display: 'inline-block', marginRight: 8 }}>负责 {list.join('、')}</span>
    </Box>
  );
}

/**
 * 开关打开时的 tier 色圆标。几何与 OwnerDot 一致，只是底色来自角色层级。
 *
 * `?` 单独一档：字典里 `budget.lines` 的负责人就写的 `"?"`（流程里没写、待确认）。
 * 它不是某一级，填成 tier 灰会读成「外部负责」。照 KAN-49 之前的样子画虚线空圈。
 */
function TierDot({ code, color }: { code: string; color: string }) {
  const single = [...code].length === 1;
  const unknown = code === '?';
  return (
    <span
      title={unknown ? '负责角色待确认' : code}
      aria-label={unknown ? '负责角色待确认' : `负责角色：${code}`}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        minWidth: 22, height: 22, borderRadius: 11, padding: single ? 0 : '0 7px',
        background: unknown ? SURFACE : color, color: unknown ? TEXT_2 : SURFACE,
        border: unknown ? `1px dashed ${BORDER}` : 'none',
        fontWeight: 700, fontSize: single ? 13 : 11, lineHeight: 1,
        marginRight: 4, verticalAlign: 'middle', flexShrink: 0, userSelect: 'none', whiteSpace: 'nowrap',
      }}
    >
      {code}
    </span>
  );
}
