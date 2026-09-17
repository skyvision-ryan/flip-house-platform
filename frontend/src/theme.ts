import { applyTheme } from '@cloudscape-design/components/theming';

// 只覆盖页面底色（暖白 / 深色）。其余全部沿用 Cloudscape 亮色体系，
// 主按钮用 Cloudscape 默认蓝，不自造品牌色。
applyTheme({
  theme: {
    tokens: {
      colorBackgroundLayoutMain: { light: '#F7F5F1', dark: '#0F1B2A' },
    },
  },
});
