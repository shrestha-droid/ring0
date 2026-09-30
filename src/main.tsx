import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { App } from './ui/App';
import { initFromUrl, syncUrl } from './store';
import './styles.css';

// The build pre-renders the default scenario into #root. A share link describes a different
// scenario, so that case renders fresh instead of hydrating markup that won't match.
const fromLink = location.hash.includes('s=');
initFromUrl();
syncUrl();

const root = document.getElementById('root')!;
const app = (
  <StrictMode>
    <App />
  </StrictMode>
);
if (root.hasChildNodes() && !fromLink) hydrateRoot(root, app);
else createRoot(root).render(app);
