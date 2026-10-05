import { describe, expect, it } from 'vitest';

import { createNonce, isHttps, issuerOrigin, securityHeaders } from './security-headers';

describe('securityHeaders', () => {
  it('lets only the nonce-carrying scripts run and refuses framing', () => {
    const headers = securityHeaders({ nonce: 'abc', dev: false, https: true });
    const csp = headers.get('content-security-policy') ?? '';

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'nonce-abc' 'strict-dynamic'");
    expect(csp).toContain("style-src 'self';");
    expect(csp).toContain("style-src-attr 'unsafe-inline'");
    expect(csp).toContain("connect-src 'self';");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe/);
    expect(headers.get('referrer-policy')).toBe('same-origin');
    expect(headers.get('x-frame-options')).toBe('DENY');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('strict-transport-security')).toContain('max-age=');
  });

  it('lets sign-out and the demo switch, form posts redirected to Keycloak, leave for Keycloak only', () => {
    const csp =
      securityHeaders({
        nonce: 'abc',
        dev: false,
        https: true,
        identityProvider: issuerOrigin('https://auth.example.ke:8080/realms/adili'),
      }).get('content-security-policy') ?? '';
    expect(csp).toContain("form-action 'self' https://auth.example.ke:8080;");
    expect(
      securityHeaders({ nonce: 'abc', dev: false, https: true }).get('content-security-policy'),
    ).toContain("form-action 'self';");
    expect(issuerOrigin('not a url')).toBeUndefined();
  });

  it('allows what Vite needs in development only', () => {
    const csp = securityHeaders({ nonce: 'abc', dev: true, https: false }).get(
      'content-security-policy',
    );
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("connect-src 'self' ws: wss:");
  });

  it('sends HSTS only over https', () => {
    expect(
      securityHeaders({ nonce: 'abc', dev: false, https: false }).has('strict-transport-security'),
    ).toBe(false);
  });
});

describe('createNonce', () => {
  it('is fresh, 128 bits in base64', () => {
    const nonce = createNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(createNonce()).not.toBe(nonce);
  });
});

describe('isHttps', () => {
  it('trusts the edge proxy, then the request URL', () => {
    const behindProxy = new Request('http://portal:3010/', {
      headers: { 'x-forwarded-proto': 'https' },
    });
    expect(isHttps(behindProxy)).toBe(true);
    expect(isHttps(new Request('http://localhost:3010/'))).toBe(false);
    expect(isHttps(new Request('https://portal.example/'))).toBe(true);
  });
});
