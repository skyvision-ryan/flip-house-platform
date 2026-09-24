import { applyTheme } from '@cloudscape-design/components/theming';

/** 产品主题：保留 Cloudscape 交互和状态语义，按本轮授权用克制的橙色突出主操作。
 * 中英文正文 15/24，辅助文字 13/20，标题 20/28；配色只在此定义。
 */
const BASE_STACK = '"Open Sans", "Helvetica Neue", "PingFang SC", Arial, sans-serif';
export const DISPLAY_STACK = '"Helvetica Neue", Helvetica, "PingFang SC", Arial, sans-serif';

/**
 * 页面底色，Cloudscape colorBackgroundLayoutMain 的亮色默认值。
 * 导出是因为登录页在 AppLayout 之外，拿不到这个令牌——不从这里取，两边就会各写一个灰
 * （审计 #A17 记的就是这个问题）。
 */
export const PAGE_BG = '#f5f6f8';

applyTheme({
  theme: {
    tokens: {
      colorBackgroundLayoutMain: { light: PAGE_BG, dark: '#0F1B2A' },
      fontFamilyBase: BASE_STACK,
      fontFamilyHeading: DISPLAY_STACK,
      fontFamilyDisplay: DISPLAY_STACK,
      fontSizeBodyM: '15px',
      lineHeightBodyM: '24px',
      fontSizeBodyS: '13px',
      lineHeightBodyS: '20px',
      fontSizeHeadingXl: '28px',
      lineHeightHeadingXl: '36px',
      fontSizeHeadingL: '20px',
      lineHeightHeadingL: '28px',
      fontSizeHeadingM: '17px',
      lineHeightHeadingM: '26px',
      fontWeightHeadingL: '600',
      fontWeightHeadingM: '600',
      borderRadiusContainer: '8px',
      borderRadiusButton: '6px',
      colorBackgroundButtonPrimaryDefault: { light: '#ff9900', dark: '#ff9900' },
      colorBackgroundButtonPrimaryHover: { light: '#ec8b00', dark: '#ec8b00' },
      colorBackgroundButtonPrimaryActive: { light: '#d97f00', dark: '#d97f00' },
      colorBorderButtonPrimaryDefault: { light: '#c67600', dark: '#c67600' },
      colorBorderButtonPrimaryHover: { light: '#b96d00', dark: '#b96d00' },
      colorBorderButtonPrimaryActive: { light: '#a66000', dark: '#a66000' },
      colorTextButtonPrimaryDefault: { light: '#161d26', dark: '#161d26' },
      colorTextButtonPrimaryHover: { light: '#161d26', dark: '#161d26' },
      colorTextButtonPrimaryActive: { light: '#161d26', dark: '#161d26' },
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

// 自有组件共用同一套产品令牌：橙色仅作主操作与品牌强调，蓝色用于链接，红绿仅表状态。
const productTokens = {
  text: '#161d26', secondary: '#536273', page: PAGE_BG, surface: '#ffffff', border: '#d8dee6',
  orange: '#ff9900', 'orange-soft': '#fff1d6', blue: '#0972d3', 'help-bg': '#f4f8fc', 'help-border': '#d5e3ef',
};
for (const [key, value] of Object.entries(productTokens)) document.documentElement.style.setProperty(`--ui-${key}`, value);
