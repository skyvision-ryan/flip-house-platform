import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { I18nProvider } from '@cloudscape-design/components/i18n';
import messages from '@cloudscape-design/components/i18n/messages/all.zh-CN';
import '@cloudscape-design/global-styles/index.css';
// Open Sans 必须真的加载，否则 theme.ts 里的 BASE_STACK 会静默落到第二顺位 Helvetica Neue
// ——macOS 不自带 Open Sans。自托管而不是挂 Google Fonts 外链：离线能用，也不给第三方发请求。
// 必须在 './theme' 之前，字体先就位再套主题。
import '@fontsource/open-sans/400.css';
import '@fontsource/open-sans/600.css';
import '@fontsource/open-sans/700.css';
import './theme';
import App from './App';
import { MetaProvider } from './lib/meta';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider locale="zh-CN" messages={[messages]}>
      <MetaProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </MetaProvider>
    </I18nProvider>
  </React.StrictMode>,
);
