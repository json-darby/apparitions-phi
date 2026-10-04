import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource/noto-sans-thai-looped/thai-400.css';
import '@fontsource/noto-sans-thai-looped/thai-500.css';
import '@fontsource/noto-sans-thai-looped/thai-600.css';
import '@fontsource/noto-sans-thai-looped/thai-700.css';
import './styles/global.css';
import './styles/shell.css';
import { App } from './app/App';
// listens for the browser's install offer from the first moment
import './app/install';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
