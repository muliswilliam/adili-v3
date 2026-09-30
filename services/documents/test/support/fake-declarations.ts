import {
  type AcknowledgementPayload,
  DeclarationsClient,
  DeclarationsUnavailable,
  VersionNotFound,
} from '../../src/declarations/declarations-client.js';

/**
 * The declarations internal API for tests: answers the payloads it was given per (tenant,
 * declaration, version), `VersionNotFound` for anything else, and records every pull.
 */
export class FakeDeclarations extends DeclarationsClient {
  readonly pulls: { tenant: string; declarationId: string; version: number }[] = [];
  private readonly payloads = new Map<string, AcknowledgementPayload>();
  private down = false;

  given(tenant: string, declarationId: string, version: number, payload: AcknowledgementPayload) {
    this.payloads.set(key(tenant, declarationId, version), payload);
  }

  /** Makes every pull fail as an unreachable declarations service would, until `up`. */
  unavailable(down = true): void {
    this.down = down;
  }

  acknowledgementPayload(
    tenant: string,
    declarationId: string,
    version: number,
  ): Promise<AcknowledgementPayload> {
    this.pulls.push({ tenant, declarationId, version });
    if (this.down) return Promise.reject(new DeclarationsUnavailable('declarations unreachable'));
    const payload = this.payloads.get(key(tenant, declarationId, version));
    return payload
      ? Promise.resolve(structuredClone(payload))
      : Promise.reject(new VersionNotFound(declarationId, version));
  }

  reset(): void {
    this.pulls.length = 0;
    this.payloads.clear();
    this.down = false;
  }
}

function key(tenant: string, declarationId: string, version: number): string {
  return `${tenant}/${declarationId}/${String(version)}`;
}
