import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GlobalWorkerOptions } from 'pdfjs-dist';
import App from './App';
import './styles/app.css';

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
