import { newVerificationId } from '@adili/events/contracts';
import { beforeAll, describe, expect, it } from 'vitest';

import { issued, issuedData } from '../support/events.js';
import {
  randomPublicIp,
  startVerificationApi,
  type VerificationApi,
} from '../support/verification-api.js';

describe('S14 lookups are rate limited per client IP', () => {
  let api: VerificationApi;

  beforeAll(async () => {
    api = await startVerificationApi();
    return () => api.close();
  });

  it('refuses the 31st lookup from one address in a minute, whatever the answers were', async () => {
    const ip = randomPublicIp();
    const slip = issuedData();
    await api.consumers.issued(issued(slip));
    // Known, unknown and malformed codes all draw on the budget.
    const paths = [
      `/v1/verify/${slip.verificationId}`,
      `/v1/verify/${newVerificationId()}`,
      '/v1/verify/not-a-code',
    ];
    for (let lookup = 0; lookup < 30; lookup += 1) {
      const response = await api.get(paths[lookup % 3] ?? '', ip);
      expect(response.statusCode).not.toBe(429);
      expect(response.headers['ratelimit-remaining']).toBe(String(29 - lookup));
    }
    const eventsBefore = (await api.outbox()).length;

    const refused = await api.get(`/v1/verify/${slip.verificationId}`, ip);

    expect(refused.statusCode).toBe(429);
    expect(refused.headers['content-type']).toContain('application/problem+json');
    const retryAfter = Number(refused.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(refused.json()).toMatchObject({
      status: 429,
      code: 'rate-limit-exceeded',
      retryAfterSeconds: retryAfter,
    });
    // A refused lookup is not a check: nothing recorded.
    expect(await api.outbox()).toHaveLength(eventsBefore);

    // Another address has its own budget.
    const other = await api.get(`/v1/verify/${slip.verificationId}`, randomPublicIp());
    expect(other.statusCode).toBe(200);

    // A minute later the address may look up again.
    api.clock.advance(61_000);
    const later = await api.get(`/v1/verify/${slip.verificationId}`, ip);
    expect(later.statusCode).toBe(200);
  });

  it("counts the browser's address the verify app's server forwards", async () => {
    const browser = randomPublicIp();
    const code = newVerificationId();
    for (let lookup = 0; lookup < 30; lookup += 1) {
      await api.app.inject({
        method: 'GET',
        url: `/v1/verify/${code}`,
        remoteAddress: '10.0.0.5',
        headers: { 'x-forwarded-for': browser },
      });
    }

    const refused = await api.app.inject({
      method: 'GET',
      url: `/v1/verify/${code}`,
      remoteAddress: '10.0.0.5',
      headers: { 'x-forwarded-for': browser },
    });
    const otherBrowser = await api.app.inject({
      method: 'GET',
      url: `/v1/verify/${code}`,
      remoteAddress: '10.0.0.5',
      headers: { 'x-forwarded-for': randomPublicIp() },
    });

    expect(refused.statusCode).toBe(429);
    expect(otherBrowser.statusCode).toBe(404);
  });
});
