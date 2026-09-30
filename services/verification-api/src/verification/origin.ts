import { isIPv4, isIPv6 } from 'node:net';

/**
 * The coarse origin of a lookup (ADR-010 §5): the IPv4 /24 or IPv6 /48 network `ip` belongs to,
 * enough to see abuse from one network without keeping any person's address. IPv4-mapped IPv6
 * addresses count as IPv4. Null when `ip` is missing or not an address.
 */
export function coarseNetwork(ip: string | undefined): string | null {
  if (!ip) return null;
  const address = ip.replace(/%.*$/, '');
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)?.[1] ?? address;
  if (isIPv4(mapped)) return `${mapped.split('.').slice(0, 3).join('.')}.0/24`;
  if (!isIPv6(address)) return null;
  const prefix = ipv6Groups(address)
    .slice(0, 3)
    .map((group) => Number.parseInt(group, 16).toString(16));
  return `${prefix.join(':')}::/48`;
}

/** The first groups of a valid IPv6 address with `::` expanded (enough for a /48 prefix). */
function ipv6Groups(address: string): string[] {
  const [head = '', tail] = address.split('::');
  const leading = head ? head.split(':') : [];
  if (tail === undefined) return leading;
  const trailing = tail ? tail.split(':') : [];
  // An embedded IPv4 tail takes two groups.
  const width = trailing.at(-1)?.includes('.') ? trailing.length + 1 : trailing.length;
  return [...leading, ...Array<string>(8 - leading.length - width).fill('0'), ...trailing];
}
