import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { type FieldCipher, FieldCipherError, type SealedField } from '../src/index.js';

export interface ContractTenants {
  /** Two distinct tenants the adapter can use. */
  tenant: string;
  otherTenant: string;
}

/** Behaviour every `FieldCipher` adapter must satisfy (fake and OpenBao alike). */
export function describeFieldCipherContract(
  name: string,
  setup: () => { cipher: FieldCipher } & ContractTenants,
): void {
  describe(`${name} satisfies the FieldCipher contract`, () => {
    const plaintext = 'Spouse: Wanjiru Kamau, KRA PIN A012345678Z, KES 1,250,000.50';

    it('round-trips a record', async () => {
      const { cipher, tenant } = setup();
      const recordId = randomUUID();

      const sealed = await cipher.encrypt({ tenant, recordId, plaintext });
      const opened = await cipher.decrypt({ tenant, recordId, ...sealed });

      expect(opened.toString('utf8')).toBe(plaintext);
    });

    it('round-trips binary plaintext', async () => {
      const { cipher, tenant } = setup();
      const recordId = randomUUID();
      const bytes = Buffer.from([0, 1, 2, 250, 255]);

      const sealed = await cipher.encrypt({ tenant, recordId, plaintext: bytes });

      expect(await cipher.decrypt({ tenant, recordId, ...sealed })).toEqual(bytes);
    });

    it('writes a v1 envelope recording tenant, key version, wrapped key, IV and tag', async () => {
      const { cipher, tenant } = setup();

      const { envelope } = await cipher.encrypt({ tenant, recordId: randomUUID(), plaintext });

      expect(envelope).toEqual({
        v: 1,
        tenant,
        keyVersion: expect.any(Number) as number,
        wrappedDek: expect.stringMatching(BASE64) as string,
        iv: expect.stringMatching(BASE64) as string,
        tag: expect.stringMatching(BASE64) as string,
      });
      expect(envelope.keyVersion).toBeGreaterThanOrEqual(1);
      expect(Buffer.from(envelope.iv, 'base64')).toHaveLength(12);
      expect(Buffer.from(envelope.tag, 'base64')).toHaveLength(16);
    });

    it('uses a fresh data key and IV for every record', async () => {
      const { cipher, tenant } = setup();
      const recordId = randomUUID();

      const first = await cipher.encrypt({ tenant, recordId, plaintext });
      const second = await cipher.encrypt({ tenant, recordId, plaintext });

      expect(second.envelope.wrappedDek).not.toBe(first.envelope.wrappedDek);
      expect(second.envelope.iv).not.toBe(first.envelope.iv);
      expect(second.ciphertext).not.toBe(first.ciphertext);
    });

    it('never puts the plaintext in the ciphertext or envelope', async () => {
      const { cipher, tenant } = setup();

      const sealed = await cipher.encrypt({ tenant, recordId: randomUUID(), plaintext });
      const stored = JSON.stringify(sealed);

      for (const fragment of ['Wanjiru', 'A012345678Z', '1,250,000.50']) {
        expect(stored).not.toContain(fragment);
        expect(stored).not.toContain(Buffer.from(fragment).toString('base64'));
        expect(Buffer.from(sealed.ciphertext, 'base64').toString('latin1')).not.toContain(fragment);
      }
    });

    it('refuses to decrypt for another tenant', async () => {
      const { cipher, tenant, otherTenant } = setup();
      const recordId = randomUUID();
      const sealed = await cipher.encrypt({ tenant, recordId, plaintext });

      await expectDecryptionFailure(cipher.decrypt({ tenant: otherTenant, recordId, ...sealed }));
      // Rewriting the envelope does not help: the wrapped key belongs to the first tenant.
      await expectDecryptionFailure(
        cipher.decrypt({
          tenant: otherTenant,
          recordId,
          ciphertext: sealed.ciphertext,
          envelope: { ...sealed.envelope, tenant: otherTenant },
        }),
      );
    });

    it('fails when the record id (AAD) does not match', async () => {
      const { cipher, tenant } = setup();
      const sealed = await cipher.encrypt({ tenant, recordId: randomUUID(), plaintext });

      await expectDecryptionFailure(cipher.decrypt({ tenant, recordId: randomUUID(), ...sealed }));
    });

    it('fails when the ciphertext, IV or tag is tampered with', async () => {
      const { cipher, tenant } = setup();
      const recordId = randomUUID();
      const sealed = await cipher.encrypt({ tenant, recordId, plaintext });

      const tampered: SealedField[] = [
        { ...sealed, ciphertext: flipFirstByte(sealed.ciphertext) },
        { ...sealed, envelope: { ...sealed.envelope, iv: flipFirstByte(sealed.envelope.iv) } },
        { ...sealed, envelope: { ...sealed.envelope, tag: flipFirstByte(sealed.envelope.tag) } },
      ];
      for (const candidate of tampered) {
        await expectDecryptionFailure(cipher.decrypt({ tenant, recordId, ...candidate }));
      }
    });

    it('rejects an unsupported envelope version', async () => {
      const { cipher, tenant } = setup();
      const recordId = randomUUID();
      const sealed = await cipher.encrypt({ tenant, recordId, plaintext });

      await expectDecryptionFailure(
        cipher.decrypt({
          tenant,
          recordId,
          ciphertext: sealed.ciphertext,
          envelope: { ...sealed.envelope, v: 2 as 1 },
        }),
      );
    });

    it('rejects tenant slugs that are not safe key names', async () => {
      const { cipher } = setup();

      await expect(
        cipher.encrypt({ tenant: '../sys', recordId: randomUUID(), plaintext }),
      ).rejects.toThrow(/tenant/);
    });
  });
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function flipFirstByte(base64: string): string {
  const bytes = Buffer.from(base64, 'base64');
  bytes[0] = (bytes[0] ?? 0) ^ 0xff;
  return bytes.toString('base64');
}

async function expectDecryptionFailure(promise: Promise<unknown>): Promise<void> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(FieldCipherError);
  expect((error as FieldCipherError).code).toBe('decryption-failed');
}
