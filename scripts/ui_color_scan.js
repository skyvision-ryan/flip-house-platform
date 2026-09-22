/**
 * 界面取色采集器（KAN-49）。**只采集，不判定** —— 判定在 frontend/src/lib/colorPolicy.ts，
 * 那边是纯函数、可单测；这边跑在页面里，没法单测，所以一行业务判断都不放。
 *
 * 两种用法，结果一致：
 *   1. Chrome MCP 的 javascript_tool 注入本文件全文；
 *   2. 直接贴进 DevTools 控制台。
 * 返回 JSON 字符串，落盘到 docs/reference/ui-audit-<日期>/{before,after}/scan-<路由>-<宽度>.json。
 *
 * 采集面只有两处，因为 frontend/src 零 CSS 文件、零 @media、零 CSS-in-JS：
 * 我们自己选的颜色只能从内联 style 属性和手写 SVG 的 fill/stroke 出来。经 Cloudscape
 * props 渲染的颜色带 awsui_* 类，按定义合规，不在采集面内。
 */
(() => {
  const NONE = new Set(['none', 'transparent', 'currentcolor', 'auto', 'initial', 'inherit', '']);

  /** rgba(0,0,0,0) 这类全透明的不算「看得见的颜色」。 */
  const visible = (v) => {
    if (!v || NONE.has(v.trim().toLowerCase())) return false;
    const m = v.match(/^rgba?\(([^)]+)\)$/i);
    if (!m) return true;
    const parts = m[1].split(/[,\s/]+/).filter(Boolean);
    return parts.length < 4 || parseFloat(parts[3]) > 0;
  };

  /** 给每个样本一条能回到 DOM 的路径，审计表里要能按图索骥。 */
  const pathOf = (el) => {
    const seg = [];
    for (let n = el; n && n.nodeType === 1 && seg.length < 6; n = n.parentElement) {
      let s = n.tagName.toLowerCase();
      if (n.id) { seg.unshift(`${s}#${n.id}`); break; }
      const cls = (typeof n.className === 'string' ? n.className : n.className?.baseVal ?? '')
        .split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      if (cls) s += `.${cls}`;
      seg.unshift(s);
    }
    return seg.join(' > ');
  };

  /** 祖先标记：判定阶段据此区分「组件保证了双通道」与「我们自己上的色」。 */
  const flagsOf = (el) => {
    let statusComponent = false, badge = false, charts = false, coverImage = false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cls = typeof n.className === 'string' ? n.className : n.className?.baseVal ?? '';
      if (/awsui_root/.test(cls) && /status-indicator|alert|flashbar/.test(cls)) statusComponent = true;
      if (/awsui_badge/.test(cls)) badge = true;
      if (n.dataset && n.dataset.chart != null) charts = true;
      if (n.dataset && n.dataset.coverImage != null) coverImage = true;
      if (n.getAttribute && n.getAttribute('role') === 'img' && n.tagName.toLowerCase() === 'svg') coverImage = coverImage || false;
    }
    return { statusComponent, badge, charts, coverImage };
  };

  const BOX_PROPS = ['backgroundColor', 'borderTopColor', 'borderRightColor',
    'borderBottomColor', 'borderLeftColor', 'outlineColor'];
  const SVG_PROPS = ['fill', 'stroke'];

  /** 元素自己有文字才算「文字颜色看得见」；否则 color 只是继承值，屏幕上并不出现。 */
  const hasOwnText = (el) => [...el.childNodes]
    .some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);

  const samples = [];
  for (const el of document.querySelectorAll('[style], svg *')) {
    if (!el.getClientRects || el.getClientRects().length === 0) continue;
    const cs = getComputedStyle(el);
    const flags = flagsOf(el);
    const inSvg = el.ownerSVGElement != null || el.tagName.toLowerCase() === 'svg';
    // SVG 里只有 fill/stroke 画得出东西；HTML 元素看盒子属性，外加真有文字时的 color。
    const props = inSvg
      ? SVG_PROPS
      : [...BOX_PROPS, ...(hasOwnText(el) ? ['color'] : [])];
    for (const prop of props) {
      const value = cs[prop];
      if (!visible(value)) continue;
      // 边框色只在真有边框宽度时才算数，否则每个元素都会报四条。
      if (prop.startsWith('border')) {
        const side = prop.replace('border', '').replace('Color', '');
        if (parseFloat(cs[`border${side}Width`]) === 0) continue;
        if (cs[`border${side}Style`] === 'none') continue;
      }
      if (prop === 'outlineColor' && parseFloat(cs.outlineWidth) === 0) continue;
      samples.push({ path: pathOf(el), prop, value, ...flags });
    }
  }

  /** 顺带抓一份运行时令牌反查表，与 design-tokens 的 JSON 真值交叉验证。 */
  const tokens = {};
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }   // 跨域样式表读不到，跳过
    for (const rule of rules ?? []) {
      if (!rule.style) continue;
      for (const name of rule.style) {
        if (name.startsWith('--color-') || name.startsWith('--font-family-')) {
          tokens[name] = rule.style.getPropertyValue(name).trim();
        }
      }
    }
  }

  return JSON.stringify({
    route: location.pathname + location.search,
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    actor: localStorage.getItem('actor'),
    reviewTags: localStorage.getItem('reviewTags'),
    roleColors: localStorage.getItem('roleColors'),
    bodyFontFamily: getComputedStyle(document.body).fontFamily,
    sampleCount: samples.length,
    samples,
    tokens,
  });
})()
