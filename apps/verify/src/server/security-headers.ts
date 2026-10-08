/**
 * Response headers for every page and server function of the public verify app (ADR-010:
 * "noindex, no personal data in URLs, strict security headers").
 *
 * Scripts run only with the request's nonce ('strict-dynamic' lets them load the app's chunks);
 * nothing may frame the page (except the demo host's presentation deck, DEMO_FRAME_ANCESTORS),
 * send the URL on as a referrer or be fetched from another origin.
 * The file check reads files locally, so `connect-src 'self'` also guards S15: a script could
 * not upload a file anywhere but this origin, and this app has no endpoint that takes one.
 */
export interface SecurityHeaderOptions {
  /** A fresh random value per response, on every script tag the server renders. */
  nonce: string;
  /** `vite dev`: Vite injects styles and connects its HMR socket. */
  dev: boolean;
  /** The visitor reached the app over https (directly or through the edge proxy). */
  https: boolean;
  /**
   * Origins allowed to frame the page: the demo host's presentation deck, which embeds app views
   * (DEMO_FRAME_ANCESTORS). Empty, as everywhere but the demo host, nothing may frame it.
   */
  frameAncestors?: string[];
}

export function securityHeaders({
  nonce,
  dev,
  https,
  frameAncestors = [],
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
    "form-action 'self'",
    frameAncestors.length > 0
      ? `frame-ancestors 'self' ${frameAncestors.join(' ')}`
      : "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ');
  const headers = new Headers({
    'content-security-policy': csp,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'permissions-policy':
      'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'x-robots-tag': 'noindex, nofollow',
    // A status can change at any time (superseded, revoked); no page is kept anywhere.
    'cache-control': 'no-store',
  });
  // X-Frame-Options cannot name origins; browsers that know frame-ancestors ignore it anyway.
  if (frameAncestors.length === 0) headers.set('x-frame-options', 'DENY');
  if (https) headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  return headers;
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

/** The origin of a configured URL, for a CSP source; undefined when unset or malformed. */
export function urlOrigin(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** DEMO_FRAME_ANCESTORS, comma-separated URLs, as CSP origins; malformed entries are dropped. */
export function frameAncestorsFrom(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => urlOrigin(entry.trim()))
    .filter((origin): origin is string => origin !== undefined);
}
