/** The OpenBao connection the anchors are signed through. */
export interface OpenBaoSignerOptions {
  url: string;
  token: string;
  /** The Transit key; an Ed25519 key of that name is created on first use. */
  key: string;
  /** Per request. Defaults to 5 seconds. */
  timeoutMs?: number;
}

export class AnchorSignerUnavailable extends Error {}

/**
 * Signs anchor statements with an OpenBao Transit Ed25519 key (ADR-008 Pipeline step 5: "signed
 * with a key held in OpenBao"); the key never leaves OpenBao. Verification goes through Transit
 * too, so every key version that signed an anchor still verifies it after a rotation.
 */
export class OpenBaoAnchorSigner {
  private readonly baseUrl: string;
  private ensured: Promise<void> | undefined;

  constructor(private readonly options: OpenBaoSignerOptions) {
    this.baseUrl = `${options.url.replace(/\/+$/, '')}/v1`;
  }

  get keyName(): string {
    return this.options.key;
  }

  async sign(statement: string): Promise<{ signature: string; keyVersion: number }> {
    await this.ensureKey();
    const body = await this.request<{ data: { signature: string } }>(
      'POST',
      `transit/sign/${this.options.key}`,
      { input: Buffer.from(statement, 'utf8').toString('base64') },
    );
    const match = /^vault:v(\d+):(.+)$/.exec(body.data.signature);
    if (!match?.[1] || !match[2]) {
      throw new AnchorSignerUnavailable('Transit returned an unexpected signature');
    }
    return { signature: match[2], keyVersion: Number(match[1]) };
  }

  async verify(statement: string, signature: string, keyVersion: number): Promise<boolean> {
    const body = await this.request<{ data: { valid: boolean } }>(
      'POST',
      `transit/verify/${this.options.key}`,
      {
        input: Buffer.from(statement, 'utf8').toString('base64'),
        signature: `vault:v${String(keyVersion)}:${signature}`,
      },
    );
    return body.data.valid;
  }

  /** The key's public half of a version (base64), for the archived anchor. */
  async publicKey(keyVersion: number): Promise<string | null> {
    const body = await this.request<{ data: { keys: Record<string, { public_key?: string }> } }>(
      'GET',
      `transit/keys/${this.options.key}`,
    );
    return body.data.keys[String(keyVersion)]?.public_key ?? null;
  }

  private ensureKey(): Promise<void> {
    // Creating a key that exists is a no-op in Transit.
    this.ensured ??= this.request('POST', `transit/keys/${this.options.key}`, {
      type: 'ed25519',
      exportable: false,
    }).then(
      () => undefined,
      (error: unknown) => {
        this.ensured = undefined;
        throw error;
      },
    );
    return this.ensured;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/${path}`, {
        method,
        headers: {
          'X-Vault-Token': this.options.token,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 5_000),
      });
    } catch (error) {
      throw new AnchorSignerUnavailable(`OpenBao ${method} ${path} failed`, { cause: error });
    }
    if (!response.ok) {
      const failure = (await response.json().catch(() => ({}))) as { errors?: string[] };
      throw new AnchorSignerUnavailable(
        `OpenBao ${method} ${path} answered ${String(response.status)}${
          failure.errors?.length ? `: ${failure.errors.join('; ')}` : ''
        }`,
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}
