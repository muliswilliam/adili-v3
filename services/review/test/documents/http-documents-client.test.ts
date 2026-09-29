import { describe, expect, it, vi } from 'vitest';

import { DocumentsUnavailable } from '../../src/documents/documents-client.js';
import { HttpDocumentsClient } from '../../src/documents/http-documents-client.js';

const UPLOAD = '0199b000-0000-7000-8000-000000000001';

function client(...responses: Response[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  const tokens = { token: vi.fn(() => Promise.resolve('service-token')), invalidate: vi.fn() };
  return {
    fetch,
    documents: new HttpDocumentsClient({ documentsUrl: 'http://documents.test', tokens, fetch }),
  };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

describe('HttpDocumentsClient', () => {
  it("asks for an upload's download link acting for the Commission; 404 is none", async () => {
    const link = {
      id: UPLOAD,
      purpose: 'declaration-attachment',
      state: 'clean',
      downloadUrl: 'https://objects.test/uploads/x?signature=y',
      expiresAt: '2027-12-10T09:05:00.000Z',
      sha256: 'a'.repeat(64),
      size: 1024,
    };
    const { documents, fetch } = client(json(link), json({ title: 'Not Found' }, 404));

    expect(await documents.getUploadDownload(UPLOAD, 'psc')).toEqual({
      downloadUrl: link.downloadUrl,
      expiresAt: link.expiresAt,
    });
    expect(await documents.getUploadDownload(UPLOAD, 'psc')).toBeNull();
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect((url as URL).href).toBe(`http://documents.test/internal/v1/uploads/${UPLOAD}/download`);
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer service-token',
      'x-acting-tenant': 'psc',
    });
  });

  it('is unavailable on any other answer', async () => {
    const { documents } = client(json({ type: 'upload-not-clean' }, 409));
    await expect(documents.getUploadDownload(UPLOAD, 'psc')).rejects.toThrow(DocumentsUnavailable);
  });
});
