import { useActor } from './actor';
import { useMeta } from './meta';

export type Tier = 'purple' | 'blue' | 'teal' | 'grey';
export const TIER_FALLBACK: Record<Tier, { label: string }> = {
  purple: { label: '决策' }, blue: { label: '统筹' }, teal: { label: '执行' }, grey: { label: '外部' },
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
 * KAN-75：写任务的按钮按**登录账号**判断，不按顶栏「我是」的临时身份——
 * 后端写接口只认 Cookie 里的账号（require_user），管理员切身份看到的按钮会 403。
 */
export function userCan(meta: ReturnType<typeof useMeta>, me: { role_code: string } | null, action: string): boolean {
  if (!me) return false;
  const ok = meta?.permissions?.[action] ?? ['purple', 'blue'];
  return ok.includes(tierOf(meta, me.role_code)) || ok.includes(me.role_code);
}
