import { cleanup, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach } from 'vitest';

import KcPage from './src/login/KcPage';
import { stories } from './src/login/stories';

// Testing Library only auto-cleans with Vitest globals, which we keep off.
afterEach(cleanup);

// KcPage lazy-loads each page, so the first render of a page suspends: it waits on the page's
// dynamic import, then React holds the reveal for its 300ms Suspense fallback throttle. A test
// doing that first render leaves `findBy*` under 700ms of its 1s timeout for everything else,
// which a loaded full run overshoots. Rendering every page once up front resolves the lazy pages
// for the whole worker, so tests render synchronously. Later files in a worker find them resolved
// already (`isolate: false`), and this costs nothing.
const onePerPage = new Map(
  Object.values(stories).map((story) => {
    const kcContext = story();
    return [kcContext.pageId, kcContext] as const;
  }),
);
for (const kcContext of onePerPage.values()) render(createElement(KcPage, { kcContext }));
await waitFor(
  () => {
    if (document.querySelectorAll('h1').length < onePerPage.size) {
      throw new Error('Pages still loading');
    }
  },
  { timeout: 30_000 },
);
cleanup();
