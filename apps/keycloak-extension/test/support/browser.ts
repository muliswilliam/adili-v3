import { runInNewContext } from 'node:vm';

/** What the Keycloakify page embeds for the React app (`const kcContext = …` in the page). */
export interface KcContext {
  pageId: string;
  url: { loginAction: string; loginRestartFlowUrl?: string };
  message?: { type: string; summary: string };
  [attribute: string]: unknown;
}

export interface Page {
  status: number;
  url: string;
  /** Where a redirect pointed, when the flow left Keycloak (e.g. to the portal). */
  location?: string;
  html: string;
  kcContext?: KcContext;
}

/**
 * A cookie-keeping HTTP client that walks Keycloak's login pages the way a browser posts them,
 * following redirects inside Keycloak and stopping at the first one that leaves it.
 */
export class Browser {
  private readonly cookies = new Map<string, string>();

  constructor(private readonly keycloakOrigin: string) {}

  get(url: string): Promise<Page> {
    return this.request(url, { method: 'GET' });
  }

  post(url: string, fields: Record<string, string>): Promise<Page> {
    return this.request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    });
  }

  private async request(url: string, init: RequestInit, hops = 0): Promise<Page> {
    if (hops > 10) throw new Error(`too many redirects at ${url}`);
    const response = await fetch(url, {
      ...init,
      redirect: 'manual',
      headers: { ...(init.headers as Record<string, string>), cookie: this.cookieHeader() },
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const index = pair?.indexOf('=') ?? -1;
      if (pair && index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      const next = new URL(location, url).toString();
      await response.body?.cancel();
      if (!next.startsWith(this.keycloakOrigin)) {
        return { status: response.status, url, location: next, html: '' };
      }
      return this.request(next, { method: 'GET' }, hops + 1);
    }
    const html = await response.text();
    return { status: response.status, url, html, kcContext: parseKcContext(html) };
  }

  private cookieHeader(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

/** The page's kcContext; throws when the response was not a Keycloak page. */
export function context(page: Page): KcContext {
  if (!page.kcContext) {
    throw new Error(
      `no Keycloak page at ${page.url} (status ${page.status}, location ${page.location})`,
    );
  }
  return page.kcContext;
}

/** Evaluates the page's kcContext declaration, which is a JavaScript literal rather than JSON. */
function parseKcContext(html: string): KcContext | undefined {
  const start = html.indexOf('const kcContext =');
  if (start === -1) return undefined;
  const end = html.indexOf('kcContext["x-keycloakify"]', start);
  const declaration = html.slice(start, end === -1 ? undefined : end);
  return runInNewContext(`${declaration}; kcContext`, {}) as KcContext;
}
