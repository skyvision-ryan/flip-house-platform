/** Ryan 授权的员工身份色；以海军蓝、航空绿、赛车红、皇家紫为视觉参考，不代表品牌官方色。 */
export const employeeColors = {
  navy: '#00205B',
  green: '#005C5D',
  red: '#D40000',
  purple: '#6F2C91',
  sapphire: '#0057B8',
  burgundy: '#8B1E3F',
  bronze: '#80551C',
  foreground: '#FFFFFF',
} as const;

export const employeeColorKeys = ['navy', 'green', 'red', 'purple', 'sapphire', 'burgundy', 'bronze'] as const;

/** 颜色绑定内部账号 ID，不随分派、角色、姓名或列表排序变化。 */
export function employeeColorKey(id: number) {
  return employeeColorKeys[((id - 1) % employeeColorKeys.length + employeeColorKeys.length) % employeeColorKeys.length];
}
