import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { FakeCipher } from '../src/index.js';
import { describeFieldCipherContract } from './field-cipher.contract.js';

describeFieldCipherContract('FakeCipher', () => ({
  cipher: new FakeCipher(),
  tenant: 'psc',
  otherTenant: 'tsc',
}));

describe('FakeCipher', () => {
  it('derives the same tenant key in every instance', async () => {
    const recordId = randomUUID();
    const sealed = await new FakeCipher().encrypt({ tenant: 'psc', recordId, plaintext: 'x' });

    const opened = await new FakeCipher().decrypt({ tenant: 'psc', recordId, ...sealed });

    expect(opened.toString()).toBe('x');
  });

  it('records calls without the plaintext', async () => {
    const cipher = new FakeCipher();
    const sealed = await cipher.encrypt({ tenant: 'psc', recordId: 'r-1', plaintext: 'secret' });
    await cipher.decrypt({ tenant: 'psc', recordId: 'r-1', ...sealed });

    expect(cipher.calls).toEqual([
      { operation: 'encrypt', tenant: 'psc', recordId: 'r-1' },
      { operation: 'decrypt', tenant: 'psc', recordId: 'r-1' },
    ]);
  });

  it('records key version 1 and remembers which tenant keys were used', async () => {
    const cipher = new FakeCipher();

    const { envelope } = await cipher.encrypt({ tenant: 'eacc', recordId: 'r', plaintext: 'x' });

    expect(envelope.keyVersion).toBe(1);
    expect(cipher.tenantKeys).toEqual(['tenant-eacc']);
  });

  it('can simulate the key service being unavailable', async () => {
    const cipher = new FakeCipher();
    cipher.unavailable = true;

    await expect(
      cipher.encrypt({ tenant: 'psc', recordId: 'r', plaintext: 'x' }),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });
});
