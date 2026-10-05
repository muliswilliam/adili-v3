import { createHash } from 'node:crypto';

import { AnchorArchive } from '../../src/anchoring/archive.js';
import type { OpenBaoAnchorSigner } from '../../src/anchoring/openbao-signer.js';

/** The `audit-archive` bucket, in memory. */
export class FakeArchive extends AnchorArchive {
  readonly objects = new Map<string, string>();

  put(key: string, body: string): Promise<void> {
    this.objects.set(key, body);
    return Promise.resolve();
  }

  check(): Promise<void> {
    return Promise.resolve();
  }

  reset(): void {
    this.objects.clear();
  }
}

/**
 * The anchors' signer without OpenBao: a keyed hash stands in for the Ed25519 signature, so a
 * changed statement no longer verifies. The real signer has its own suite against OpenBao.
 */
export class FakeSigner implements Pick<
  OpenBaoAnchorSigner,
  'keyName' | 'sign' | 'verify' | 'publicKey'
> {
  readonly keyName = 'audit-anchor';

  sign(statement: string): Promise<{ signature: string; keyVersion: number }> {
    return Promise.resolve({ signature: this.mac(statement), keyVersion: 1 });
  }

  verify(statement: string, signature: string): Promise<boolean> {
    return Promise.resolve(signature === this.mac(statement));
  }

  publicKey(): Promise<string | null> {
    return Promise.resolve('fake-public-key');
  }

  private mac(statement: string): string {
    return createHash('sha256').update(`fake-key:${statement}`).digest('base64');
  }
}
