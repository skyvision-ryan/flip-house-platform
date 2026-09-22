import { useActor } from './actor';
import { useMeta } from './meta';

export type Tier = 'purple' | 'blue' | 'teal' | 'grey';
export const TIER_FALLBACK: Record<Tier, { label: string; color: string }> = {
  purple: { label: '决策', color: '#7A3EE8' }, blue: { label: '统筹', color: '#0972D3' }, teal: { label: '执行', color: '#0E8A8A' }, grey: { label: '外部', color: '#7D8998' },
};

/** 当前身份是谁、哪一级、能做什么。没登录，全靠顶栏“我是”。 */
export function useRole() {
  const { actor } = useActor();
  const meta = useMeta();
  const role = meta?.roles.find((r) => r.code === actor);
  const tier: Tier = (role?.tier as Tier) ?? 'blue';
  const tierInfo = meta?.tiers?.[tier] ?? TIER_FALLBACK[tier];
  const can = (action: string, ...extraOk: string[]) => {
    const ok = meta?.permissions?.[action] ?? ['purple', 'blue'];
    return ok.includes(tier) || ok.includes(actor) || extraOk.includes(actor);
  };
  return { actor, tier, tierLabel: tierInfo.label, duties: role?.duties ?? '', can, canReadMoney: can('read_money') };
}

export function tierOf(meta: ReturnType<typeof useMeta>, code: string): Tier {
  return (meta?.roles.find((r) => r.code === code)?.tier as Tier) ?? 'grey';
}
/**
 * 角色 → tier 颜色。后端 /api/meta 的 tiers[].color 优先，取不到才用本地镜像。
 *
 * 审计 #A09 判「违反」并删掉过这个函数，理由是颜色编码的是角色层级、属分类信息。
 * KAN-64 把它请回来，但只服务**默认关的讲解开关**（见 lib/rolePref.ts）：
 * 日常使用一个色圈都不出现，#A09 对默认态的判定仍然成立。
 */
export function colorOf(meta: ReturnType<typeof useMeta>, code: string): string {
  const t = tierOf(meta, code);
  return meta?.tiers?.[t]?.color ?? TIER_FALLBACK[t].color;
}
