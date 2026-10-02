import {
  ClarificationNotFound,
  ReviewClient,
  ReviewUnavailable,
} from '../../src/review/review-client.js';

/**
 * The review internal API for tests: answers the letter payloads it was given per (tenant,
 * clarification), `ClarificationNotFound` for anything else, and records every pull.
 */
export class FakeReview extends ReviewClient {
  readonly pulls: { tenant: string; clarificationId: string }[] = [];
  private readonly payloads = new Map<string, unknown>();
  private down = false;

  given(tenant: string, clarificationId: string, payload: unknown): void {
    this.payloads.set(`${tenant}/${clarificationId}`, payload);
  }

  /** Makes every pull fail as an unreachable review service would, until `unavailable(false)`. */
  unavailable(down = true): void {
    this.down = down;
  }

  clarificationLetterPayload(tenant: string, clarificationId: string): Promise<unknown> {
    this.pulls.push({ tenant, clarificationId });
    if (this.down) return Promise.reject(new ReviewUnavailable('review unreachable'));
    const payload = this.payloads.get(`${tenant}/${clarificationId}`);
    return payload === undefined
      ? Promise.reject(new ClarificationNotFound(clarificationId))
      : Promise.resolve(structuredClone(payload));
  }
}
