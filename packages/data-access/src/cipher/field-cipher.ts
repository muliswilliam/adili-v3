import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Stored beside the ciphertext of every encrypted field. Holds no secret on its own: the data
 * key is wrapped by the tenant's key in the key service.
 */
export interface FieldEnvelope {
  v: 1;
  /** Responsible Commission slug whose key wrapped the data key. */
  tenant: string;
  /** Version of the tenant key that wrapped the data key (key rotation). */
  keyVersion: number;
  /** Base64 data key as wrapped by the tenant key. */
  wrappedDek: string;
  /** Base64 96-bit AES-GCM nonce. */
  iv: string;
  /** Base64 128-bit AES-GCM authentication tag. */
  tag: string;
}

export interface SealedField {
  /** Base64 AES-256-GCM ciphertext. */
  ciphertext: string;
  envelope: FieldEnvelope;
}

export interface EncryptFieldInput {
  tenant: string;
  /** Stable id of the row or document the value belongs to; bound into the AAD. */
  recordId: string;
  plaintext: string | Uint8Array;
}

export interface DecryptFieldInput extends SealedField {
  /** Tenant the caller acts for; must own the envelope. */
  tenant: string;
  recordId: string;
}

export type FieldCipherErrorCode =
  /** Wrong tenant, wrong record id, tampered data or unknown envelope version. */
  | 'decryption-failed'
  /** The key service could not be reached or refused the request. */
  | 'unavailable';

export class FieldCipherError extends Error {
  constructor(
    readonly code: FieldCipherErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'FieldCipherError';
  }
}

/**
 * Encrypts highly confidential fields with the Commission's key before they reach the
 * database. Also the Nest injection token: `constructor(private readonly cipher: FieldCipher)`.
 */
export abstract class FieldCipher {
  abstract encrypt(input: EncryptFieldInput): Promise<SealedField>;
  /** Resolves to the plaintext bytes; rejects with `FieldCipherError`. */
  abstract decrypt(input: DecryptFieldInput): Promise<Buffer>;
}

/** Wraps data keys with a per-tenant key encryption key held by a key service. */
export interface KeyWrapper {
  wrap(tenant: string, dataKey: Buffer): Promise<{ wrappedDek: string; keyVersion: number }>;
  /** Rejects with `FieldCipherError('decryption-failed')` when the key does not unwrap. */
  unwrap(tenant: string, wrapped: { wrappedDek: string; keyVersion: number }): Promise<Buffer>;
}

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const TENANT_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * Envelope encryption: AES-256-GCM per record under a fresh data key, the data key wrapped by
 * the tenant's key, and the AAD binding tenant and record id so a ciphertext cannot be moved
 * to another tenant or row.
 */
export class EnvelopeFieldCipher extends FieldCipher {
  constructor(private readonly keys: KeyWrapper) {
    super();
  }

  async encrypt({ tenant, recordId, plaintext }: EncryptFieldInput): Promise<SealedField> {
    assertTenant(tenant);
    const dataKey = randomBytes(32);
    try {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, dataKey, iv, { authTagLength: TAG_BYTES });
      cipher.setAAD(aad(tenant, recordId));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const { wrappedDek, keyVersion } = await this.keys.wrap(tenant, dataKey);
      return {
        ciphertext: ciphertext.toString('base64'),
        envelope: {
          v: 1,
          tenant,
          keyVersion,
          wrappedDek,
          iv: iv.toString('base64'),
          tag: cipher.getAuthTag().toString('base64'),
        },
      };
    } finally {
      dataKey.fill(0);
    }
  }

  async decrypt({ tenant, recordId, ciphertext, envelope }: DecryptFieldInput): Promise<Buffer> {
    assertTenant(tenant);
    // Envelopes come from storage, so the version is checked at runtime.
    const version: unknown = envelope.v;
    if (version !== 1) {
      throw new FieldCipherError(
        'decryption-failed',
        `Unsupported envelope version ${String(version)}`,
      );
    }
    if (envelope.tenant !== tenant) {
      throw new FieldCipherError('decryption-failed', 'Envelope belongs to another tenant');
    }
    const dataKey = await this.keys.unwrap(tenant, envelope);
    try {
      const decipher = createDecipheriv(ALGORITHM, dataKey, Buffer.from(envelope.iv, 'base64'), {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(aad(tenant, recordId));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]);
    } catch (error) {
      throw new FieldCipherError('decryption-failed', 'Ciphertext did not authenticate', {
        cause: error,
      });
    } finally {
      dataKey.fill(0);
    }
  }
}

/** Name of the tenant's key encryption key in the key service. */
export function tenantKeyName(tenant: string): string {
  assertTenant(tenant);
  return `tenant-${tenant}`;
}

function assertTenant(tenant: string): void {
  // The slug becomes part of a key service path.
  if (!TENANT_SLUG.test(tenant)) {
    throw new TypeError(`Invalid tenant slug: ${JSON.stringify(tenant)}`);
  }
}

function aad(tenant: string, recordId: string): Buffer {
  // JSON-encoded so no (tenant, recordId) pair can collide with another.
  return Buffer.from(JSON.stringify(['adili-field-v1', tenant, recordId]));
}
