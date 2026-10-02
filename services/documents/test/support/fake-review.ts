import {
  ReviewClient,
  type ReviewRecord,
  ReviewRecordNotFound,
  ReviewUnavailable,
} from '../../src/review/review-client.js';

/**
 * The review internal API for tests: answers the payloads it was given per (record, tenant, id),
 * `ReviewRecordNotFound` for anything else, and records every pull.
 */
export class FakeReview extends ReviewClient {
  readonly pulls: { record: ReviewRecord; tenant: string; id: string }[] = [];
  private readonly payloads = new Map<string, unknown>();
  private down = false;

  /** The payload of `record` `id` the review service holds for `tenant`. */
  given(record: ReviewRecord, tenant: string, id: string, payload: unknown): void {
    this.payloads.set(key(record, tenant, id), payload);
  }

  /** Makes every pull fail as an unreachable review service would, until `unavailable(false)`. */
  unavailable(down = true): void {
    this.down = down;
  }

  payload(record: ReviewRecord, tenant: string, id: string): Promise<unknown> {
    this.pulls.push({ record, tenant, id });
    if (this.down) return Promise.reject(new ReviewUnavailable('review unreachable'));
    const payload = this.payloads.get(key(record, tenant, id));
    return payload === undefined
      ? Promise.reject(new ReviewRecordNotFound(record, id))
      : Promise.resolve(structuredClone(payload));
  }
}

function key(record: ReviewRecord, tenant: string, id: string): string {
  return `${record}/${tenant}/${id}`;
}
