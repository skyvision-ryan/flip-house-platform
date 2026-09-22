/**
 * 角色色圈（节标题前按 tier 上色的圆标）的开关偏好（审计 #A09）。
 *
 * **默认关。** 和评审黄标（#A07）是同一类东西：不是业务 UI，是开会时一眼指认
 * 「这块归谁」的标记。KAN-49 判 #A09「违反」的理由是**颜色编码的是角色层级，
 * 属分类信息不是状态**——那条判定针对的是「默认常亮、且是唯一通道」的用法。
 * 放在一个显式的、默认关的开关后面，日常使用看不到，讲解时一键点开，两边都成立。
 *
 * 键和评审标注**各用各的**（`roleColors` vs `reviewTags`）：两个开关互不影响，
 * 开会时可以只开其中一个。共用一个键就没法单独开了。
 *
 * 抽成模块和 reviewPref 一样是为了能单测——`Pick<Storage, ...>` 就是为了注入假 storage。
 */
export const ROLE_PREF_KEY = 'roleColors';

/** 只认显式写进去的 'on'；没设置过、读不到、存的是别的值，一律当关。 */
export function readRolePref(storage: Pick<Storage, 'getItem'>): boolean {
  try {
    return storage.getItem(ROLE_PREF_KEY) === 'on';
  } catch {
    return false;
  }
}

export function writeRolePref(storage: Pick<Storage, 'setItem'>, on: boolean): void {
  try {
    storage.setItem(ROLE_PREF_KEY, on ? 'on' : 'off');
  } catch {
    /* 隐私模式下写不进去就算了，本轮仍然生效 */
  }
}
