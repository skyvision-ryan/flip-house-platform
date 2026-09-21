import { applyTheme } from '@cloudscape-design/components/theming';

/**
 * 只覆盖页面底色和字体。其余全部沿用 Cloudscape 亮色体系，
 * 主按钮用 Cloudscape 默认蓝，不自造品牌色。
 *
 * 字体分两层（KAN-63 观感修订）：
 * - **正文是控制台字体**：Open Sans 打头，和 Cloudscape 自己的栈一致，长段中英文混排更安静。
 * - **标题和展示字才用地铁字体**：Helvetica Neue 打头，只出现在 heading / display 令牌
 *   和 StatTile 的大数字上，用来撑起层次。
 *
 * 这是一处**有意偏离**，理由与回退见 docs/界面风格与AWS对照.md 第 6 节（审计 #A18 #A19）。
 * 官方栈是 `"Open Sans", Helvetica, Arial, sans-serif`，Helvetica 本就是第二顺位，
 * 我们只是在标题上把它提到首位；文档没有禁止换字体。
 * 回退 = 把 DISPLAY_STACK 的三处使用改回 BASE_STACK。
 *
 * 三个字体令牌**必须分别赋值**：fontFamilyHeading 与 fontFamilyDisplay 是独立令牌、
 * 各自一份字面量，不引用 base。它们是纯字符串令牌，不是 colorBackgroundLayoutMain
 * 那种 { light, dark } 结构。
 *
 * 两个栈都保留 PingFang SC 兜底，否则中文掉字。
 */
const BASE_STACK = '"Open Sans", "Helvetica Neue", "PingFang SC", Arial, sans-serif';
export const DISPLAY_STACK = '"Helvetica Neue", Helvetica, "PingFang SC", Arial, sans-serif';

/**
 * 页面底色，Cloudscape colorBackgroundLayoutMain 的亮色默认值。
 * 导出是因为登录页在 AppLayout 之外，拿不到这个令牌——不从这里取，两边就会各写一个灰
 * （审计 #A17 记的就是这个问题）。
 */
export const PAGE_BG = '#f2f3f3';

applyTheme({
  theme: {
    tokens: {
      colorBackgroundLayoutMain: { light: PAGE_BG, dark: '#0F1B2A' },
      fontFamilyBase: BASE_STACK,
      fontFamilyHeading: DISPLAY_STACK,
      fontFamilyDisplay: DISPLAY_STACK,
    },
  },
});

/**
 * 令牌只管 Cloudscape 组件。我们自己的内联 style 元素（顶栏、Dashboard 的卡片等）不带
 * awsui 类，拿不到这些令牌——实测 body 的计算字体是 "PingFang SC"，即 Chrome 对 lang="zh-CN"
 * 的默认值，和组件的字体是**两种**。中文两边都落到 PingFang 看不出来，但数字、日期、
 * 代号是两种字形。所以根元素也要声明一次，让未被组件包住的文字跟上正文栈。
 */
document.documentElement.style.fontFamily = BASE_STACK;
