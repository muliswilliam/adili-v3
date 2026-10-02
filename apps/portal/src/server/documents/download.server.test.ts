import { describe, expect, it } from 'vitest';

import { issuedDocumentResponse } from './download.server';

const PATH = '/api/documents/0192f1a0-5a11-7000-8000-00000000d001/download';

describe('issuedDocumentResponse', () => {
  it("redirects to the documents service's presigned link, uncached", () => {
    const response = issuedDocumentResponse(
      { status: 'ok', downloadUrl: 'http://localhost:8333/issued/letter.pdf?X-Amz-Signature=x' },
      PATH,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      'http://localhost:8333/issued/letter.pdf?X-Amz-Signature=x',
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('sends a signed-out declarant to sign in, and back to the document after', () => {
    const response = issuedDocumentResponse({ status: 'unauthenticated' }, PATH);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      `/auth/login?returnTo=${encodeURIComponent(PATH)}`,
    );
  });

  it("is a 404 for a document that is not the declarant's, a 503 when the service is down", () => {
    expect(issuedDocumentResponse({ status: 'not-found' }, PATH).status).toBe(404);
    expect(issuedDocumentResponse({ status: 'unavailable' }, PATH).status).toBe(503);
  });
});
