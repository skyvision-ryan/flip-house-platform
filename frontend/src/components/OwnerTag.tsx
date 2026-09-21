import Box from '@cloudscape-design/components/box';
import { useMeta } from '../lib/meta';
import { useActor } from '../lib/actor';
import { SURFACE, TEXT, TEXT_2, BORDER } from './charts/palette';

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
 * 这里不画圆（第三刀）：每个标题前挂一颗 22px 粗体圆标，一屏下来就是一排黑圈，
 * 比标题本身还抢眼。标题要的只是「这块归谁」，一行次要文字就够了。
 * 勾选框旁边那种需要辨认「谁点的」的地方仍用 OwnerDot。
 */
export default function OwnerTag({ block, codes }: { block?: string; codes?: string[] }) {
  const meta = useMeta();
  const { actor } = useActor();
  const list = (codes ?? (block ? meta?.owner_map?.[block] : undefined) ?? []).map((c) => (c === '当前身份' ? actor : c));
  if (!list.length) return null;
  return (
    <Box variant="span" color="text-body-secondary" fontSize="body-s">负责 {list.join('、')}</Box>
  );
}
