import { describe, expect, it } from 'vitest';

import { createDocumentsClient, DOCUMENTS_TIMEOUTS_MS, documentsTimeoutMs } from './client';

describe('documentsTimeoutMs', () => {
  it('waits out the scan on completion, briefly otherwise', () => {
    expect(documentsTimeoutMs('GET', '/v1/uploads/abc')).toBe(DOCUMENTS_TIMEOUTS_MS.read);
    expect(documentsTimeoutMs('POST', '/v1/uploads')).toBe(DOCUMENTS_TIMEOUTS_MS.write);
    expect(documentsTimeoutMs('POST', '/v1/uploads/abc/complete')).toBe(
      DOCUMENTS_TIMEOUTS_MS.complete,
    );
    expect(DOCUMENTS_TIMEOUTS_MS.complete).toBeGreaterThan(60_000);
  });
});

describe('createDocumentsClient', () => {
  it('sends the bearer token to the documents service', async () => {
    const seen: Request[] = [];
    const fetchImpl: typeof fetch = (input) => {
      if (input instanceof Request) seen.push(input);
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'x' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };
    const client = createDocumentsClient({
      baseUrl: 'http://documents.test',
      accessToken: 'token-1',
      fetch: fetchImpl,
    });
    await client.POST('/v1/uploads', {
      params: { header: { 'Idempotency-Key': '0199a0b4-0000-7000-8000-000000000001' } },
      body: { purpose: 'roster-import', contentType: 'text/csv', declaredSize: 10 },
    });
    const request = seen[0];
    expect(request?.url).toBe('http://documents.test/v1/uploads');
    expect(request?.headers.get('authorization')).toBe('Bearer token-1');
    expect(request?.headers.get('idempotency-key')).toBe('0199a0b4-0000-7000-8000-000000000001');
  });
});
