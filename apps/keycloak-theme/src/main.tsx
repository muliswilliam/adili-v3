import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { KcPage } from './kc.gen';

// Dev preview: `pnpm dev`, then open /?page=login.ftl (or any Keycloak page ID), or a named
// state of the activation flow such as /?preview=activation-landing (see login/previews.ts).
if (import.meta.env.DEV && !window.kcContext) {
  const { getKcContextMock } = await import('./login/mock');
  const { previews } = await import('./login/previews');
  const search = new URLSearchParams(window.location.search);
  const preview = search.get('preview');
  const pageId = search.get('page') ?? 'login.ftl';
  window.kcContext =
    preview && preview in previews
      ? previews[preview as keyof typeof previews]()
      : getKcContextMock({
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
