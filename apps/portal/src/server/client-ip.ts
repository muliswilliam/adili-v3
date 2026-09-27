/**
 * The browser's address, for the directory's per-IP rate limits.
 *
 * X-Forwarded-For is a list the client can start: every proxy appends the address it received
 * the request from, so only entries appended by proxies we run can be trusted. With
 * `trustedHops` proxies in front of the portal, the client is the entry `trustedHops` from the
 * right; anything to its left is whatever the browser sent. With no trusted proxies (0) the
 * header is ignored and the socket address is the client.
 *
 * When the header has fewer entries than trusted hops, the proxies are not configured as
 * expected; the socket address is used rather than guessing.
 */
export function clientIp(
  headers: { get: (name: string) => string | null },
  socketAddress: string | undefined,
  trustedHops: number,
): string | undefined {
  if (trustedHops <= 0) return socketAddress;
  const entries = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries[entries.length - trustedHops] ?? socketAddress;
}
