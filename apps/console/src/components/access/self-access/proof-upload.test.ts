import { describe, expect, it, vi } from 'vitest';

import type { Upload } from '../../../server/documents/client';
import {
  PROOF_MAX_BYTES,
  type ProofUploadDeps,
  proofContentType,
  uploadProof,
} from './proof-upload';

function upload(overrides: Partial<Upload>): Upload {
  return {
    id: '0199c000-0000-7000-8000-0000000000a1',
    purpose: 'access-representation',
    state: 'clean',
    rejection: null,
    contentType: 'application/pdf',
    detectedType: 'application/pdf',
    declaredSize: 2048,
    size: 2048,
    sha256: 'a'.repeat(64),
    fileName: 'authority.pdf',
    createdAt: '2026-10-02T07:00:00.000Z',
    completedAt: '2026-10-02T07:00:02.000Z',
    ...overrides,
  };
}

function deps(overrides: Partial<ProofUploadDeps> = {}): ProofUploadDeps {
  return {
    reserve: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        data: {
          id: '0199c000-0000-7000-8000-0000000000a1',
          uploadUrl: 'https://storage.test/put',
          expiresAt: '2026-10-02T07:15:00.000Z',
          maxSize: PROOF_MAX_BYTES,
        },
      }),
    ),
    putFile: vi.fn(() => Promise.resolve('ok' as const)),
    complete: vi.fn(() => Promise.resolve({ ok: true as const, data: upload({}) })),
    newKey: () => 'key',
    ...overrides,
  };
}

const pdf = () => new File([new Uint8Array(2048)], 'authority.pdf', { type: 'application/pdf' });

describe('proofContentType', () => {
  it('takes the browser type, else the extension; anything else is refused', () => {
    expect(proofContentType({ name: 'x.bin', type: 'image/png' })).toBe('image/png');
    expect(proofContentType({ name: 'Scan.JPEG', type: '' })).toBe('image/jpeg');
    expect(proofContentType({ name: 'letter.docx', type: '' })).toBeNull();
  });
});

describe('uploadProof', () => {
  it('reserves an access-representation upload, sends the bytes and completes it clean', async () => {
    const d = deps();
    const scanning = vi.fn();
    const outcome = await uploadProof(pdf(), d, { onScanning: scanning });
    expect(outcome).toEqual({
      kind: 'clean',
      uploadId: '0199c000-0000-7000-8000-0000000000a1',
      size: 2048,
    });
    expect(d.reserve).toHaveBeenCalledWith(
      { contentType: 'application/pdf', declaredSize: 2048, fileName: 'authority.pdf' },
      'key',
    );
    expect(d.putFile).toHaveBeenCalledWith(
      'https://storage.test/put',
      expect.any(File),
      'application/pdf',
      expect.any(Object),
    );
    expect(scanning).toHaveBeenCalledOnce();
  });

  it('reports an infected or refused file, and a lost upload as failed', async () => {
    expect(
      await uploadProof(
        pdf(),
        deps({
          complete: () => Promise.resolve({ ok: true, data: upload({ state: 'infected' }) }),
        }),
      ),
    ).toEqual({ kind: 'infected' });
    expect(
      await uploadProof(
        pdf(),
        deps({
          complete: () =>
            Promise.resolve({
              ok: true,
              data: upload({ state: 'rejected', rejection: 'size' }),
            }),
        }),
      ),
    ).toEqual({ kind: 'rejected-size' });
    expect(await uploadProof(pdf(), deps({ putFile: () => Promise.resolve('failed') }))).toEqual({
      kind: 'failed',
    });
  });

  it('refuses a wrong type in the browser and asks a lapsed session to sign in', async () => {
    const d = deps();
    expect(await uploadProof(new File(['x'], 'letter.docx'), d)).toEqual({ kind: 'rejected-type' });
    expect(d.reserve).not.toHaveBeenCalled();
    expect(
      await uploadProof(
        pdf(),
        deps({ reserve: () => Promise.resolve({ ok: false, error: { kind: 'unauthenticated' } }) }),
      ),
    ).toEqual({ kind: 'unauthenticated' });
  });
});
