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
