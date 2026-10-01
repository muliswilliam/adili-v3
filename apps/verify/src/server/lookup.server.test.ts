import createClient from 'openapi-fetch';
import { describe, expect, it } from 'vitest';

import { DEFAULT_RETRY_AFTER_SECONDS, lookUp } from './lookup.server';
import { MOCK_CODES, mockVerificationFetch } from './verification/mock.server';
import type { paths } from './verification/schema.gen';

function client(send: (request: Request) => Promise<Response> = mockVerificationFetch) {
  return createClient<paths>({ baseUrl: 'http://verification.test', fetch: send });
}

const answer =
  (status: number, body: unknown, headers: Record<string, string> = {}) =>
  () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      }),
    );

describe('lookUp against the verification-api mock', () => {
  it('returns a valid restricted document with its public fields and hash', async () => {
    const outcome = await lookUp(client(), MOCK_CODES.valid);
    expect(outcome).toMatchObject({
      kind: 'found',
      result: {
        verificationId: MOCK_CODES.valid,
        status: 'valid',
        disclosureLevel: 'restricted',
        document: {
          type: 'acknowledgement-slip',
          issuerName: 'Teachers Service Commission',
          reference: 'DCI-TSC-2026-0012345-8',
          version: 2,
        },
      },
    });
    expect(outcome.kind === 'found' && outcome.result.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('links a superseded document to the current one only when the API gives the id', async () => {
    expect(await lookUp(client(), MOCK_CODES.superseded)).toMatchObject({
      result: { status: 'superseded', supersededBy: MOCK_CODES.valid },
    });
    expect(await lookUp(client(), MOCK_CODES.supersededUnlinked)).toMatchObject({
      result: { status: 'superseded', supersededBy: null },
    });
  });

  it('returns revoked with its reason category, expired, and confidential without fields', async () => {
    expect(await lookUp(client(), MOCK_CODES.revoked)).toMatchObject({
      result: { status: 'revoked', revokedReason: 'issued-in-error' },
    });
    expect(await lookUp(client(), MOCK_CODES.expired)).toMatchObject({
      result: { status: 'expired' },
    });
    expect(await lookUp(client(), MOCK_CODES.confidential)).toMatchObject({
      result: { status: 'valid', disclosureLevel: 'confidential', document: null },
    });
  });

  it('answers not-found for an unknown well-formed code (404, same shape)', async () => {
    expect(await lookUp(client(), MOCK_CODES.notFound)).toEqual({ kind: 'not-found' });
  });

  it('answers malformed for a 400', async () => {
    expect(await lookUp(client(), 'ADL-7Q4U')).toEqual({ kind: 'malformed' });
  });

  it('answers rate-limited with the seconds to wait', async () => {
    expect(await lookUp(client(), MOCK_CODES.rateLimited)).toEqual({
      kind: 'rate-limited',
      retryAfterSeconds: 42,
    });
  });

  it('answers unavailable for a 5xx', async () => {
    expect(await lookUp(client(), MOCK_CODES.unavailable)).toEqual({ kind: 'unavailable' });
  });
});

describe('lookUp against other answers', () => {
  it('reads the wait from Retry-After, then RateLimit-Reset, then defaults', async () => {
    const problem = { type: 'about:blank', title: 'Too many', status: 429 };
    expect(
      await lookUp(client(answer(429, problem, { 'retry-after': '17' })), MOCK_CODES.valid),
    ).toEqual({ kind: 'rate-limited', retryAfterSeconds: 17 });
    expect(
      await lookUp(client(answer(429, problem, { 'ratelimit-reset': '9' })), MOCK_CODES.valid),
    ).toEqual({ kind: 'rate-limited', retryAfterSeconds: 9 });
    expect(await lookUp(client(answer(429, problem)), MOCK_CODES.valid)).toEqual({
      kind: 'rate-limited',
      retryAfterSeconds: DEFAULT_RETRY_AFTER_SECONDS,
    });
  });

  it('treats a 200 saying not-found as not found', async () => {
    const body = {
      verificationId: MOCK_CODES.notFound,
      status: 'not-found',
      disclosureLevel: null,
      document: null,
      sha256: null,
      supersededBy: null,
      revokedReason: null,
      checkedAt: '2026-09-30T10:00:00Z',
    };
    expect(await lookUp(client(answer(200, body)), MOCK_CODES.notFound)).toEqual({
      kind: 'not-found',
    });
  });

  it('answers unavailable when the API cannot be reached', async () => {
    const down = () => Promise.reject(new TypeError('fetch failed'));
    expect(await lookUp(client(down), MOCK_CODES.valid)).toEqual({ kind: 'unavailable' });
  });
});
