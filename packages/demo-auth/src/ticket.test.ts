import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { mintDemoTicket } from './ticket.ts';

const SECRET = 'test-demo-ticket-secret';
const NOW = new Date('2026-10-09T08:00:00Z');

describe('mintDemoTicket', () => {
  it('signs v1.<payload> with HMAC-SHA256 over the version and payload', () => {
    const ticket = mintDemoTicket({
      demoKey: 'reviewer',
      secret: SECRET,
      now: NOW,
      nonce: 'n0nce-n0nce-n0nce-1',
    });
    const [version, payload, signature] = ticket.split('.');

    expect(version).toBe('v1');
    expect(JSON.parse(Buffer.from(payload ?? '', 'base64url').toString())).toEqual({
      k: 'reviewer',
      exp: NOW.getTime() / 1000 + 60,
      n: 'n0nce-n0nce-n0nce-1',
    });
    expect(signature).toBe(
      createHmac('sha256', SECRET).update(`v1.${payload}`).digest('base64url'),
    );
  });

  it('gives each ticket its own nonce', () => {
    const nonceOf = (ticket: string) =>
      (JSON.parse(Buffer.from(ticket.split('.')[1] ?? '', 'base64url').toString()) as { n: string })
        .n;

    expect(nonceOf(mintDemoTicket({ demoKey: 'reviewer', secret: SECRET }))).not.toBe(
      nonceOf(mintDemoTicket({ demoKey: 'reviewer', secret: SECRET })),
    );
  });

  it('refuses keys Keycloak would refuse, an empty secret and long lifetimes', () => {
    expect(() => mintDemoTicket({ demoKey: 'Reviewer!', secret: SECRET })).toThrow();
    expect(() => mintDemoTicket({ demoKey: 'reviewer', secret: '' })).toThrow();
    expect(() =>
      mintDemoTicket({ demoKey: 'reviewer', secret: SECRET, ttlSeconds: 121 }),
    ).toThrow();
  });
});
