import type { AddressCandidate } from '../api/client';

/**
 * 手动地址（KAN-71 手动路径）。纯函数，可单测。
 *
 * 后端 `AddressCandidateOut` 五个字段都是裸 `str`，`""` 合法——mock.py 自己的兜底就发
 * `AddressCandidate(address, address, "", "", "")`。所以这里**只强制街道一段**，
 * 城市/州/邮编缺了不拦，`label` 由填了的部分拼出来。
 */
export type ManualAddress = { street: string; city: string; state: string; zip: string };

export const EMPTY_MANUAL: ManualAddress = { street: '', city: '', state: '', zip: '' };

const clean = (s: string) => s.trim();

/** 「街道, 城市, 州 邮编」——哪段空就跳过哪段，不留悬空的逗号。 */
export function composeLabel(a: ManualAddress): string {
  const street = clean(a.street);
  const city = clean(a.city);
  const stateZip = [clean(a.state), clean(a.zip)].filter(Boolean).join(' ');
  return [street, city, stateZip].filter(Boolean).join(', ');
}

/** 返回缺的段；目前只有 `street` 会出现。空数组 = 可以提交。 */
export function validateManualAddress(a: ManualAddress): (keyof ManualAddress)[] {
  return clean(a.street) ? [] : ['street'];
}

/** 转成 createProject 要的 `address`。没有经纬度就不猜。 */
export function toCandidate(a: ManualAddress): AddressCandidate {
  return { label: composeLabel(a), street: clean(a.street), city: clean(a.city), state: clean(a.state), zip: clean(a.zip), lat: null, lng: null };
}

/**
 * 换房子时要不要清掉团队填的两个金额（KAN-71，Ryan 09-22 决定）。
 *
 * 只有**确认切换到另一套房**（上一套房的标准地址与新的不同）且当时已经填了金额，才清。
 * 普通的地址文字修正后重选同一套房、或第一次选房，都不清——金额是这套房的，房子没变就不该动。
 */
export function shouldClearAmounts(
  prevLabel: string | null | undefined,
  nextLabel: string,
  deal: { purchase_price: string; target_arv: string },
): boolean {
  if (!prevLabel || prevLabel === nextLabel) return false;
  return deal.purchase_price !== '' || deal.target_arv !== '';
}
