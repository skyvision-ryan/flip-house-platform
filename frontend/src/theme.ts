import { applyTheme } from '@cloudscape-design/components/theming';

/**
 * 只覆盖页面底色和字体。其余全部沿用 Cloudscape 亮色体系，
 * 主按钮用 Cloudscape 默认蓝，不自造品牌色。
 *
 * 字体是一处**有意偏离**，理由与回退见 docs/界面风格与AWS对照.md 第 6 节（审计 #A18 #A19）：
 * 官方栈是 `"Open Sans", Helvetica, Arial, sans-serif`，Helvetica 本就是第二顺位，
 * 我们只是把它提到首位；文档没有禁止换字体。回退 = 删掉 FONT_STACK 和它的三处使用。
 *
 * 三个字体令牌必须一起覆盖：fontFamilyHeading 与 fontFamilyDisplay 是独立令牌、
 * 各自一份字面量，不引用 base。只改 base，在装了 Open Sans 的机器上标题与正文会分家。
 * 这三个是纯字符串令牌，不是 colorBackgroundLayoutMain 那种 { light, dark } 结构。
 *
 * PingFang SC 兜底必须保留，否则中文掉字。
 */
const FONT_STACK = '"Helvetica Neue", Helvetica, "PingFang SC", Arial, sans-serif';

/**
 * 页面底色。导出是因为登录页在 AppLayout 之外，拿不到 colorBackgroundLayoutMain 令牌，
 * 原先它自己硬写了 #f2f3f3——登录页冷灰、进去之后暖白，同一产品两个底色（审计 #A17）。
 * 从这里取，两边就只有一个真值。
 */
export const PAGE_BG = '#F7F5F1';

applyTheme({
  theme: {
    tokens: {
      colorBackgroundLayoutMain: { light: PAGE_BG, dark: '#0F1B2A' },
      fontFamilyBase: FONT_STACK,
      fontFamilyHeading: FONT_STACK,
      fontFamilyDisplay: FONT_STACK,
    },
  },
});

/**
 * 令牌只管 Cloudscape 组件。我们自己的内联 style 元素（顶栏、Dashboard 的卡片等）不带
 * awsui 类，拿不到这些令牌——实测 body 的计算字体是 "PingFang SC"，即 Chrome 对 lang="zh-CN"
 * 的默认值，和组件的 Open Sans 是**两种字体**。中文两边都落到 PingFang 看不出来，
 * 但数字、日期、代号是两种字形。所以根元素也要声明一次，让未被组件包住的文字跟上。
 */
document.documentElement.style.fontFamily = FONT_STACK;
