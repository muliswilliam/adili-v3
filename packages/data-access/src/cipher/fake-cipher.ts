import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import {
  type DecryptFieldInput,
  type EncryptFieldInput,
  EnvelopeFieldCipher,
  FieldCipherError,
  type KeyWrapper,
  type SealedField,
  tenantKeyName,
} from './field-cipher.js';

export interface FakeCipherCall {
  operation: 'encrypt' | 'decrypt';
  tenant: string;
  recordId: string;
}

/**
 * In-memory `FieldCipher` for tests and local runs without OpenBao. Real AES-256-GCM envelope
 * encryption, but tenant keys are derived from the slug, so every instance (and every test run)
 * can decrypt what another produced. Never use outside tests and local development.
 */
export class FakeCipher extends EnvelopeFieldCipher {
  /** Calls in order, without plaintext. */
  readonly calls: FakeCipherCall[] = [];
  /** When true, every call fails as if the key service were down. */
  unavailable = false;
  private readonly wrapper: FakeKeyWrapper;

  constructor() {
    const wrapper = new FakeKeyWrapper();
    super(wrapper);
    this.wrapper = wrapper;
  }

  /** Tenant key names used so far, in first-use order (mirrors lazy creation in OpenBao). */
  get tenantKeys(): string[] {
    return [...this.wrapper.used];
  }

  override async encrypt(input: EncryptFieldInput): Promise<SealedField> {
    this.calls.push({ operation: 'encrypt', tenant: input.tenant, recordId: input.recordId });
    this.failIfUnavailable();
    return super.encrypt(input);
  }

  override async decrypt(input: DecryptFieldInput): Promise<Buffer> {
    this.calls.push({ operation: 'decrypt', tenant: input.tenant, recordId: input.recordId });
    this.failIfUnavailable();
    return super.decrypt(input);
  }

  private failIfUnavailable(): void {
    if (this.unavailable) {
      throw new FieldCipherError('unavailable', 'Fake key service is unavailable');
    }
  }
}

const KEY_VERSION = 1;

class FakeKeyWrapper implements KeyWrapper {
  readonly used = new Set<string>();

  wrap(tenant: string, dataKey: Buffer): Promise<{ wrappedDek: string; keyVersion: number }> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keyFor(tenant), iv);
    const wrapped = Buffer.concat([cipher.update(dataKey), cipher.final()]);
    return Promise.resolve({
      wrappedDek: Buffer.concat([iv, cipher.getAuthTag(), wrapped]).toString('base64'),
      keyVersion: KEY_VERSION,
    });
  }

  unwrap(tenant: string, { wrappedDek, keyVersion }: { wrappedDek: string; keyVersion: number }) {
    try {
      if (keyVersion !== KEY_VERSION) throw new Error(`Unknown key version ${keyVersion}`);
      const bytes = Buffer.from(wrappedDek, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', this.keyFor(tenant), bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Promise.resolve(
        Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]),
      );
    } catch (error) {
      return Promise.reject(
        new FieldCipherError('decryption-failed', 'Data key did not unwrap', { cause: error }),
      );
    }
  }

  private keyFor(tenant: string): Buffer {
    const name = tenantKeyName(tenant);
    this.used.add(name);
    return createHash('sha256').update(`adili-fake-kek:${name}`).digest();
  }
}
