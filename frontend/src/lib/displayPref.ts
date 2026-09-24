/** 两个独立的显示偏好；存储不可用时仍可在当前页面切换。 */
export const HELP_PREF_KEY = 'display.help.v1';
export function readHelpPref(storage: Pick<Storage, 'getItem'>): boolean {
  try { return storage.getItem(HELP_PREF_KEY) === 'on'; } catch { return false; }
}
export function writeHelpPref(storage: Pick<Storage, 'setItem'>, on: boolean): void {
  try { storage.setItem(HELP_PREF_KEY, on ? 'on' : 'off'); } catch { /* 本轮状态仍有效 */ }
}
