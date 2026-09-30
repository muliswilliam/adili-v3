import { IssuanceDependencyUnavailable } from './errors.js';

export interface OpenBaoOptions {
  /** Server address, e.g. `http://localhost:8200`. */
  url: string;
  token: string;
  /** Per request. Defaults to 2 seconds (ADR-013 synchronous budget). */
  timeoutMs?: number;
}

/** Transit signature options: RSA keys take a hash and padding, Ed25519 keys neither. */
export interface TransitSignOptions {
  hashAlgorithm?: 'sha2-256';
  signatureAlgorithm?: 'pkcs1v15';
}

/**
 * The few OpenBao calls issuance makes: KV v2 reads (the signing certificate) and Transit
 * signatures (PAdES and verification records), whose keys never leave OpenBao. Every failure,
 * from an unreachable server to a missing key, is `IssuanceDependencyUnavailable('signer')`.
 */
export class OpenBao {
  private readonly baseUrl: string;

  constructor(private readonly options: OpenBaoOptions) {
    this.baseUrl = `${options.url.replace(/\/+$/, '')}/v1`;
  }

  /** The data of a KV v2 secret at `mount`/`path`. */
  async readKv(mount: string, path: string): Promise<Record<string, string>> {
    const body = await this.request<{ data: { data: Record<string, string> } }>(
      'GET',
      `${mount}/data/${path}`,
    );
    return body.data.data;
  }

  /** Signs `input` with Transit key `key`; returns the raw signature and the key version used. */
  async sign(
    key: string,
    input: Uint8Array,
    options: TransitSignOptions = {},
  ): Promise<{ signature: Buffer; keyVersion: number }> {
    const body = await this.request<{ data: { signature: string } }>(
      'POST',
      `transit/sign/${key}`,
      {
        input: Buffer.from(input).toString('base64'),
        ...(options.hashAlgorithm ? { hash_algorithm: options.hashAlgorithm } : {}),
        ...(options.signatureAlgorithm ? { signature_algorithm: options.signatureAlgorithm } : {}),
      },
    );
    const match = /^vault:v(\d+):(.+)$/.exec(body.data.signature);
    if (!match?.[1] || !match[2]) {
      throw new IssuanceDependencyUnavailable('signer', 'Transit returned an unexpected signature');
    }
    return { signature: Buffer.from(match[2], 'base64'), keyVersion: Number(match[1]) };
  }

  /** The public keys of a Transit key by version, as Transit reports them (base64 or PEM). */
  async publicKeys(key: string): Promise<Record<string, string>> {
    const body = await this.request<{
      data: { keys: Record<string, { public_key: string }> };
    }>('GET', `transit/keys/${key}`);
    return Object.fromEntries(
      Object.entries(body.data.keys).map(([version, { public_key }]) => [version, public_key]),
    );
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const what = `OpenBao ${method} ${path}`;
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/${path}`, {
        method,
        headers: {
          'X-Vault-Token': this.options.token,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 2_000),
      });
    } catch (error) {
      throw new IssuanceDependencyUnavailable('signer', `${what} failed`, { cause: error });
    }
    if (!response.ok) {
      // OpenBao error bodies name the problem ("permission denied"), never key material.
      const failure = (await response.json().catch(() => ({}))) as { errors?: string[] };
      const reason = failure.errors?.length ? failure.errors.join('; ') : '';
      throw new IssuanceDependencyUnavailable(
        'signer',
        `${what} answered ${response.status}${reason ? `: ${reason}` : ''}`,
      );
    }
    return (await response.json()) as T;
  }
}
