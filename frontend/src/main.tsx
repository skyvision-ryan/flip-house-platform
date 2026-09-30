import { LanguageProvider } from './i18n/LanguageProvider';
import '@cloudscape-design/global-styles/index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { MetaProvider } from './lib/meta';
import './styles.css';
import './theme';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanguageProvider>
      <MetaProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </MetaProvider>
    </LanguageProvider>
  </React.StrictMode>,
);
