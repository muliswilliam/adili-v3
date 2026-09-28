import {
  type ContactLookup,
  type PersonContacts,
  PersonContactsSource,
} from './person-contacts.js';

/** In-memory directory for tests: answers from `set`, records lookups and can fail once. */
export class FakePersonContacts extends PersonContactsSource {
  readonly lookups: ContactLookup[] = [];
  private readonly contacts = new Map<string, { contacts: PersonContacts; tenant?: string }>();
  private failure: Error | undefined;
  private hanging = false;

  lookup(request: ContactLookup): Promise<PersonContacts> {
    this.lookups.push({ ...request });
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
    const known = this.contacts.get(request.personId);
    const visible = known && (known.tenant === undefined || known.tenant === request.tenant);
    return Promise.resolve(visible ? known.contacts : { email: null, phone: null });
  }

  /** The person's contacts, at `tenant` only when given (else at any tenant). */
  set(personId: string, contacts: PersonContacts, tenant?: string): void {
    this.contacts.set(personId, { contacts, tenant });
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
