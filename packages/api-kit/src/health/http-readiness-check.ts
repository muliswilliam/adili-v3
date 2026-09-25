import { ReadinessCheck } from './readiness-check.js';

/** Ready when `url` answers with a 2xx status. */
export class HttpReadinessCheck extends ReadinessCheck {
  constructor(
    readonly name: string,
    private readonly url: string,
  ) {
    super();
  }

  async check(): Promise<void> {
    const response = await fetch(this.url, { signal: AbortSignal.timeout(2_000) });
    if (!response.ok) {
      throw new Error(`${this.url} answered ${response.status}`);
    }
  }
}
