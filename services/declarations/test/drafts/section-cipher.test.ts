import { FakeCipher } from '@adili/data-access/testing';
import { describe, expect, it } from 'vitest';

import { SectionCipher } from '../../src/drafts/section-cipher.js';

/** A Valkey that never answers, as one does while it is unreachable and commands queue. */
const silentValkey = {
  get: () => new Promise<string | null>(() => undefined),
  set: () => new Promise<'OK'>(() => undefined),
};

describe('SectionCipher', () => {
  it('opens a section by decrypting when the cache does not answer', async () => {
    const cipher = new FakeCipher();
    const sections = new SectionCipher(cipher, silentValkey);
    const sealed = await sections.seal('psc', 'declaration-1', 'bio', { note: 'kept' });

    const opened = await sections.open('psc', {
      ...sealed,
      declarationId: 'declaration-1',
      sectionKey: 'bio',
      savedVersion: 1,
    });

    expect(opened).toEqual({ note: 'kept' });
    expect(cipher.calls.map((call) => call.operation)).toEqual(['encrypt', 'decrypt']);
  });

  it('gives up caching a saved section when the cache does not answer', async () => {
    const sections = new SectionCipher(new FakeCipher(), silentValkey);

    await expect(
      sections.cache(
        { declarationId: 'declaration-1', sectionKey: 'bio', savedVersion: 1 },
        {
          note: 'kept',
        },
      ),
    ).resolves.toBeUndefined();
  });
});
