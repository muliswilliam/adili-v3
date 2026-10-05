import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { RootDocument } from './root-document';

/** Server-renders the document as the request handler does: a router carrying the CSP nonce. */
function renderDocument(theme: 'system' | 'light' | 'dark') {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory(),
    isServer: true,
    ssr: { nonce: 'n0nce' },
  });
  return renderToString(
    <RouterContextProvider router={router}>
      <RootDocument theme={theme}>page</RootDocument>
    </RouterContextProvider>,
  );
}

describe('RootDocument', () => {
  it('puts the CSP nonce on every inline script, so the theme script runs before the first paint', () => {
    const html = renderDocument('system');
    const scripts = html.match(/<script[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) expect(script).toContain('nonce="n0nce"');
    expect(html).toContain('adili_theme');
  });

  it('renders an explicit theme choice on <html>', () => {
    expect(renderDocument('dark')).toMatch(/<html[^>]*data-theme="dark"/);
    expect(renderDocument('light')).toMatch(/<html[^>]*data-theme="light"/);
    expect(renderDocument('system')).not.toMatch(/<html[^>]*data-theme=/);
  });
});
