import { ReadinessCheck } from '@adili/api-kit';

import {
  EnvelopeFieldCipher,
  FieldCipherError,
  type KeyWrapper,
  tenantKeyName,
  type WrappedDataKey,
} from './field-cipher.js';

export interface OpenBaoOptions {
  /** Server address, e.g. `http://localhost:8200`. */
  url: string;
  token: string;
  /** Enterprise-style namespace, sent as `X-Vault-Namespace` when set. */
  namespace?: string;
  /** Mount path of the Transit engine. Defaults to `transit`. */
  transitMount?: string;
  /** Per-request timeout. Defaults to 2 seconds. */
  timeoutMs?: number;
}

/**
 * `FieldCipher` whose data keys are wrapped by OpenBao Transit key `tenant-<slug>`, created on
 * first use as a non-derived, non-exportable AES-256-GCM key (ADR-006 tenant keys).
 */
export class OpenBaoTransitCipher extends EnvelopeFieldCipher {
  constructor(options: OpenBaoOptions) {
    super(new TransitKeyWrapper(new OpenBaoClient(options), options.transitMount ?? 'transit'));
  }
}

/** Ready when OpenBao is initialised, unsealed and active. Never throws synchronously. */
export class OpenBaoReadinessCheck extends ReadinessCheck {
  readonly name = 'openbao';
  private readonly client: OpenBaoClient;

  constructor(options: OpenBaoOptions) {
    super();
    this.client = new OpenBaoClient(options);
  }

  async check(): Promise<void> {
    const response = await this.client.request('GET', 'sys/health');
    if (!response.ok) {
      // 429 standby, 501 not initialised, 503 sealed.
      throw new Error(`OpenBao health answered ${response.status}`);
    }
  }
}

class TransitKeyWrapper implements KeyWrapper {
  /** Tenant keys known to exist, so creation is checked once per process. */
  private readonly ensured = new Map<string, Promise<void>>();

  constructor(
    private readonly client: OpenBaoClient,
    private readonly mount: string,
  ) {}

  async wrap(tenant: string, dataKey: Buffer): Promise<WrappedDataKey> {
    const key = tenantKeyName(tenant);
    await this.ensureKey(key);
    const response = await this.client.request('POST', `${this.mount}/encrypt/${key}`, {
      plaintext: dataKey.toString('base64'),
    });
    if (!response.ok) {
      throw await unavailable(`Transit encrypt with ${key}`, response);
    }
    const { data } = (await response.json()) as { data: { ciphertext: string } };
    const match = /^vault:v(\d+):(.+)$/.exec(data.ciphertext);
    if (!match?.[1] || !match[2]) {
      throw new FieldCipherError('unavailable', 'Transit returned an unexpected ciphertext');
    }
    return { keyVersion: Number(match[1]), wrappedDek: match[2] };
  }

  async unwrap(tenant: string, { wrappedDek, keyVersion }: WrappedDataKey): Promise<Buffer> {
    const key = tenantKeyName(tenant);
    const response = await this.client.request('POST', `${this.mount}/decrypt/${key}`, {
      ciphertext: `vault:v${keyVersion}:${wrappedDek}`,
    });
    // Transit answers 400 for a missing key, a wrong key or a tampered wrapped key.
    if (response.status === 400) {
      throw new FieldCipherError('decryption-failed', `Data key did not unwrap with ${key}`);
    }
    if (!response.ok) {
      throw await unavailable(`Transit decrypt with ${key}`, response);
    }
    const { data } = (await response.json()) as { data: { plaintext: string } };
    return Buffer.from(data.plaintext, 'base64');
  }

  private ensureKey(key: string): Promise<void> {
    let ensured = this.ensured.get(key);
    if (!ensured) {
      ensured = this.createIfMissing(key);
      this.ensured.set(key, ensured);
      // Retry on the next call rather than caching a failure.
      ensured.catch(() => this.ensured.delete(key));
    }
    return ensured;
  }

  private async createIfMissing(key: string): Promise<void> {
    const existing = await this.client.request('GET', `${this.mount}/keys/${key}`);
    if (existing.ok) return;
    if (existing.status !== 404) {
      throw await unavailable(`Transit key lookup for ${key}`, existing);
    }
    // Creation is idempotent, so concurrent first uses across instances are safe.
    const created = await this.client.request('POST', `${this.mount}/keys/${key}`, {
      type: 'aes256-gcm96',
      derived: false,
      exportable: false,
    });
    if (!created.ok) {
      throw await unavailable(`Transit key creation for ${key}`, created);
    }
  }
}

class OpenBaoClient {
  private readonly baseUrl: string;

  constructor(private readonly options: OpenBaoOptions) {
    this.baseUrl = `${options.url.replace(/\/+$/, '')}/v1`;
  }

  async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { 'X-Vault-Token': this.options.token };
    if (this.options.namespace) headers['X-Vault-Namespace'] = this.options.namespace;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      return await fetch(`${this.baseUrl}/${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 2_000),
      });
    } catch (error) {
      throw new FieldCipherError('unavailable', `OpenBao request failed: ${method} ${path}`, {
        cause: error,
      });
    }
  }
}

async function unavailable(what: string, response: Response): Promise<FieldCipherError> {
  // OpenBao error bodies name the problem ("permission denied"), never key material.
  const body = (await response.json().catch(() => ({}))) as { errors?: string[] };
  const reason = body.errors?.length ? body.errors.join('; ') : `status ${response.status}`;
  return new FieldCipherError('unavailable', `${what} failed: ${reason}`);
}
