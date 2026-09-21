/**
 * 评审标注（黄底圆标）的开关偏好（审计 #A07）。
 *
 * **默认关。** 圆标不表示任何状态，却是全页饱和度最高的颜色（97.6%），工作台一屏 21 个。
 * 它只在开会口头引用功能块时才需要，所以改成默认关、顶栏一键开——组件本体和字母 ID
 * 一个不动，开会时点一下就全回来。
 *
 * 抽成模块是为了能单测：这是本票唯一真正改了语义的地方，缺 key 时的返回值从 true 变成 false。
 */
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
