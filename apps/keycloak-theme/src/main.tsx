import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { KcPage } from './kc.gen';

// Dev preview: `pnpm dev`, then open /?page=login.ftl (or any Keycloak page ID).
if (import.meta.env.DEV && !window.kcContext) {
  const { getKcContextMock } = await import('./login/mock');
  const pageId = new URLSearchParams(window.location.search).get('page') ?? 'login.ftl';
  window.kcContext = getKcContextMock({
    pageId: pageId as Parameters<typeof getKcContextMock>[0]['pageId'],
    overrides: {},
  });
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    {window.kcContext ? <KcPage kcContext={window.kcContext} /> : <h1>No Keycloak context</h1>}
  </StrictMode>,
);
