import { describe, expect, it } from 'vitest';

import { clientIp } from './client-ip.js';

const SOCKET = '10.0.0.5';

function headers(forwardedFor?: string) {
  return new Headers(forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor });
}

describe('clientIp', () => {
  it('uses the socket address when no proxy is trusted, whatever the header says', () => {
    expect(clientIp(headers('198.51.100.1'), SOCKET, 0)).toBe(SOCKET);
    expect(clientIp(headers(), SOCKET, 0)).toBe(SOCKET);
  });

  it('uses the entry the trusted proxy appended, ignoring spoofed ones to its left', () => {
    // The browser sent "X-Forwarded-For: 198.51.100.1, 198.51.100.2"; the proxy appended the
    // address it saw.
    expect(clientIp(headers('198.51.100.1, 198.51.100.2, 203.0.113.7'), SOCKET, 1)).toBe(
      '203.0.113.7',
    );
  });

  it('skips one entry per trusted hop', () => {
    // CDN appended the client, then the load balancer appended the CDN.
    expect(clientIp(headers('198.51.100.1, 203.0.113.7, 192.0.2.10'), SOCKET, 2)).toBe(
      '203.0.113.7',
    );
  });

  it('uses the socket address with the default single hop when no proxy is in front (local dev)', () => {
    expect(clientIp(headers(), SOCKET, 1)).toBe(SOCKET);
  });

  it('falls back to the socket address when the header is missing or too short', () => {
    expect(clientIp(headers(), SOCKET, 1)).toBe(SOCKET);
    expect(clientIp(headers('203.0.113.7'), SOCKET, 2)).toBe(SOCKET);
    expect(clientIp(headers(' , '), SOCKET, 1)).toBe(SOCKET);
  });

  it('returns undefined when nothing is known', () => {
    expect(clientIp(headers(), undefined, 0)).toBeUndefined();
  });
});
