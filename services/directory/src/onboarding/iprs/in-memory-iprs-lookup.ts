import { type IprsPerson, IprsLookup, IprsUnavailable } from './iprs-lookup.js';

/**
 * `IprsLookup` for tests: answers from the people it was given (null for anyone else), records
 * the national IDs asked for, can be made unavailable, and holds the next lookup until released
 * (to see what waits on it).
 */
export class InMemoryIprsLookup extends IprsLookup {
  private readonly people = new Map<string, IprsPerson>();
  private readonly lookups: string[] = [];
  private unavailable = 0;
  private hold: Promise<void> | undefined;

  async find(nationalId: string): Promise<IprsPerson | null> {
    this.lookups.push(nationalId);
    const hold = this.hold;
    this.hold = undefined;
    await hold;
    if (this.unavailable > 0) {
      this.unavailable -= 1;
      throw new IprsUnavailable('unavailable on request');
    }
    return this.people.get(nationalId) ?? null;
  }

  /** Holds the next lookup (after recording it) until the returned function is called. */
  holdNext(): () => void {
    let release: () => void = () => undefined;
    this.hold = new Promise((resolve) => {
      release = resolve;
    });
    return release;
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
    this.hold = undefined;
  }
}
