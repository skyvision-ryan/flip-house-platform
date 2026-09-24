/** 卡片数字编号默认关闭；沿用现有开关偏好，旧字母编号已由固定组件注册表取代。 */
export const REVIEW_PREF_KEY = 'reviewTags';

/** 只认显式写进去的 'on'；没设置过、读不到、存的是别的值，一律当关。 */
export function readReviewPref(storage: Pick<Storage, 'getItem'>): boolean {
  try {
    return storage.getItem(REVIEW_PREF_KEY) === 'on';
  } catch {
    return false;
  }
}

export function writeReviewPref(storage: Pick<Storage, 'setItem'>, on: boolean): void {
  try {
    storage.setItem(REVIEW_PREF_KEY, on ? 'on' : 'off');
  } catch {
    /* 隐私模式下写不进去就算了，本轮仍然生效 */
  }
}
