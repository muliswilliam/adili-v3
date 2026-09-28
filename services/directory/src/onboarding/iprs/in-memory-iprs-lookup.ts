import { type IprsPerson, IprsLookup, IprsUnavailable } from './iprs-lookup.js';

/**
 * `IprsLookup` for tests: answers from the people it was given (null for anyone else), records
 * the national IDs asked for, and can be made unavailable.
 */
export class InMemoryIprsLookup extends IprsLookup {
  private readonly people = new Map<string, IprsPerson>();
  private readonly lookups: string[] = [];
  private unavailable = 0;

  find(nationalId: string): Promise<IprsPerson | null> {
    this.lookups.push(nationalId);
    if (this.unavailable > 0) {
      this.unavailable -= 1;
      return Promise.reject(new IprsUnavailable('unavailable on request'));
    }
    return Promise.resolve(this.people.get(nationalId) ?? null);
  }

  /** IPRS holds `person` under `nationalId`. */
  givenPerson(nationalId: string, person: IprsPerson): void {
    this.people.set(nationalId, person);
  }

  /** Makes the next `count` lookups fail with `IprsUnavailable`. */
  failNext(count = 1): void {
    this.unavailable = count;
  }

  /** National IDs looked up, oldest first. */
  calls(): readonly string[] {
    return [...this.lookups];
  }

  reset(): void {
    this.people.clear();
    this.lookups.length = 0;
    this.unavailable = 0;
  }
}
