import { applyTheme } from '@cloudscape-design/components/theming';
import { brandOverrides } from './brand';
import { productTokens } from './tokens';

export const BASE_STACK = '"Helvetica Neue", Helvetica, Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Source Han Sans SC", sans-serif';
export const DISPLAY_STACK = BASE_STACK;

// 默认字号、行高、间距、圆角、背景和状态色都由 Cloudscape 决定。
applyTheme({ theme: { tokens: {
  fontFamilyBase: BASE_STACK,
  fontFamilyHeading: DISPLAY_STACK,
  fontFamilyDisplay: DISPLAY_STACK,
  ...brandOverrides,
} } });

// Cloudscape 将主题变量挂在 body；别名也必须在同一作用域解析，避免在 html 上提前落到默认值。
for (const [key, value] of Object.entries(productTokens)) {
  document.body.style.setProperty(`--ui-${key}`, value);
}
