import { bootTheme } from '@adili/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Not kc.gen's KcPage: it loads the login theme on demand, one more request between Keycloak's page
// and anything on screen. Importing it here puts the whole theme in the entry bundle.
import KcPage from './login/KcPage';

// Dev preview: `pnpm dev`, then open /?page=login.ftl (any Keycloak page ID) or a named state
// from src/login/stories.ts, e.g. /?story=otp-wrong.
if (import.meta.env.DEV && !window.kcContext) {
  const { getKcContextMock } = await import('./login/mock');
  const { stories } = await import('./login/stories');
  const params = new URLSearchParams(window.location.search);
  const storyName = params.get('story');
  const pageId = params.get('page') ?? 'login.ftl';
  window.kcContext =
    storyName && storyName in stories
      ? stories[storyName as keyof typeof stories]()
      : getKcContextMock({
          pageId: pageId as Parameters<typeof getKcContextMock>[0]['pageId'],
          overrides: {},
        });
}

// The theme the portal, console and verify picked (shared cookie), or the device's.
bootTheme();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    {window.kcContext ? <KcPage kcContext={window.kcContext} /> : <h1>No Keycloak context</h1>}
  </StrictMode>,
);
