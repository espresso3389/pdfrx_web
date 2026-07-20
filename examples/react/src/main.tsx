import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@pdfrx/react/styles.css';
import { App } from './App.js';

// StrictMode on purpose: it double-mounts every effect in development, which is
// exactly the case the provider has to survive without leaking a pdfium worker.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
