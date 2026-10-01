import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatDigest,
  looksLikePdf,
  sameDigest,
  sha256Hex,
  Sha256UnavailableError,
} from './sha256';

describe('sha256Hex', () => {
  it('matches the server-side SHA-256 of the same bytes', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7 Adili Online acknowledgement slip');
    const server = createHash('sha256').update(bytes).digest('hex');

    expect(await sha256Hex(new Blob([bytes]))).toBe(server);
    expect(await sha256Hex(bytes)).toBe(server);
  });

  it('gives the known digest of the empty input', async () => {
    expect(await sha256Hex(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  describe('without Web Crypto', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('rejects with Sha256UnavailableError', async () => {
      vi.stubGlobal('crypto', {});

      await expect(sha256Hex(new Uint8Array([1]))).rejects.toBeInstanceOf(Sha256UnavailableError);
    });
  });
});

describe('sameDigest', () => {
  it('ignores case and grouping spaces', () => {
    expect(sameDigest('ABCD 1234', 'abcd1234')).toBe(true);
    expect(sameDigest('abcd1234', 'abcd1235')).toBe(false);
  });
});

describe('formatDigest', () => {
  it('groups the digest by eight', () => {
    expect(formatDigest('0123456789abcdef01')).toBe('01234567 89abcdef 01');
  });
});

describe('looksLikePdf', () => {
  const encode = (text: string) => new TextEncoder().encode(text);

  it('finds the header at the start or after leading junk', () => {
    expect(looksLikePdf(encode('%PDF-1.7\n'))).toBe(true);
    expect(looksLikePdf(encode(`${' '.repeat(500)}%PDF-1.4`))).toBe(true);
  });

  it('rejects other files and a header past the first 1024 bytes', () => {
    expect(looksLikePdf(encode('PK\u0003\u0004 word document'))).toBe(false);
    expect(looksLikePdf(encode(`${' '.repeat(1024)}%PDF-1.4`))).toBe(false);
  });
});
