import { type PersonContacts, PersonContactsSource } from './person-contacts.js';

/** In-memory directory for tests: answers from `set`, records lookups and can fail once. */
export class FakePersonContacts extends PersonContactsSource {
  readonly lookups: string[] = [];
  private readonly contacts = new Map<string, PersonContacts>();
  private failure: Error | undefined;
  private hanging = false;

  lookup(personId: string): Promise<PersonContacts> {
    this.lookups.push(personId);
    if (this.hanging) {
      this.hanging = false;
      // Like a stalled directory: never settles.
      return new Promise(() => undefined);
    }
    const failure = this.failure;
    if (failure) {
      this.failure = undefined;
      return Promise.reject(failure);
    }
    return Promise.resolve(this.contacts.get(personId) ?? { email: null, phone: null });
  }

  set(personId: string, contacts: PersonContacts): void {
    this.contacts.set(personId, contacts);
  }

  /** The next lookup rejects with `error`. */
  failNext(error: Error): void {
    this.failure = error;
  }

  /** The next lookup never settles. */
  hangNext(): void {
    this.hanging = true;
  }

  reset(): void {
    this.lookups.length = 0;
    this.contacts.clear();
    this.failure = undefined;
    this.hanging = false;
  }
}
