/**
 * Response headers for every page and server function of the portal.
 *
 * Scripts run only with the request's nonce ('strict-dynamic' lets them load the app's chunks).
 * The browser talks to this origin only: server functions proxy the services. Nothing may frame
 * the page. Keycloak is a top-level redirect, not a connection from the page.
 */
export interface SecurityHeaderOptions {
  /** A fresh random value per response, on every script tag the server renders. */
  nonce: string;
  /** `vite dev`: Vite injects styles and connects its HMR socket. */
  dev: boolean;
  /** The visitor reached the app over https (directly or through the edge proxy). */
  https: boolean;
  /**
   * Keycloak's origin. Sign-out and the demo switch are form posts that redirect there, and
   * form-action also governs where a submitted form may be redirected.
   */
  identityProvider?: string;
}

export function securityHeaders({
  nonce,
  dev,
  https,
  identityProvider,
}: SecurityHeaderOptions): Headers {
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'`,
    dev ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'",
    // Widths and fades are style attributes on server-rendered HTML. style-src does not
    // cover those, and hydration does not put them back.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    dev ? "connect-src 'self' ws: wss:" : "connect-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    identityProvider ? `form-action 'self' ${identityProvider}` : "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ');
  const headers = new Headers({
    'content-security-policy': csp,
    'x-content-type-options': 'nosniff',
    // same-origin, not no-referrer: no-referrer makes browsers send `Origin: null` on the app's own
    // form posts, so logout and the demo switch, which refuse foreign origins, refused every post.
    // Other origins still get no referrer.
    'referrer-policy': 'same-origin',
    'x-frame-options': 'DENY',
    'permissions-policy':
      'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
  });
  if (https) headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  return headers;
}

/** The origin of an OIDC issuer URL, for form-action; undefined when unset or malformed. */
export function issuerOrigin(issuer: string | undefined): string | undefined {
  if (!issuer) return undefined;
  try {
    return new URL(issuer).origin;
  } catch {
    return undefined;
  }
}

/** 128 random bits, base64: a CSP nonce. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/** Whether the visitor's connection is https, trusting the edge proxy's X-Forwarded-Proto. */
export function isHttps(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  return (forwarded ?? new URL(request.url).protocol.replace(':', '')) === 'https';
}
