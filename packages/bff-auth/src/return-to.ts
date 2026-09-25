/**
 * Accepts only same-origin relative paths, so the login flow cannot be abused as an
 * open redirect (`//evil.example`, `https://evil.example`, `/\evil.example`).
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value?.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/';
  }
  try {
    const url = new URL(value, 'http://placeholder.invalid');
    if (url.origin !== 'http://placeholder.invalid') return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}
