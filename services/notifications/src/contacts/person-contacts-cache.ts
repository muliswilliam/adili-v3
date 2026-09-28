import {
  type ContactLookup,
  type PersonContacts,
  PersonContactsSource,
} from './person-contacts.js';

export interface PersonContactsCacheOptions {
  /** How long an answer is reused. Expiry is the only invalidation. */
  ttlMs: number;
  /** Entries kept; beyond it the oldest is dropped. Bounds memory during a reminder peak. */
  maxEntries: number;
  /** For tests. */
  now?: () => number;
}

interface Entry {
  contacts: PersonContacts;
  expiresAt: number;
}

/**
 * Reuses a person's contacts for a short while, so the SMS and email of one reminder (and a
 * burst of reminders) cost one directory read. Entries are per person and tenant, as the
 * directory answers. Answers without contacts are cached like any other; failed lookups are not.
 * Concurrent lookups of one person share a request.
 */
export class PersonContactsCache extends PersonContactsSource {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<PersonContacts>>();
  private readonly now: () => number;

  constructor(
    private readonly source: PersonContactsSource,
    private readonly options: PersonContactsCacheOptions,
  ) {
    super();
    this.now = options.now ?? Date.now;
  }

  lookup(request: ContactLookup): Promise<PersonContacts> {
    const key = `${request.tenant}/${request.personId}`;
    const entry = this.entries.get(key);
    if (entry && this.now() < entry.expiresAt) {
      return Promise.resolve(entry.contacts);
    }
    this.entries.delete(key);
    let pending = this.pending.get(key);
    if (!pending) {
      pending = this.fetch(key, request).finally(() => this.pending.delete(key));
      this.pending.set(key, pending);
    }
    return pending;
  }

  private async fetch(key: string, request: ContactLookup): Promise<PersonContacts> {
    const contacts = await this.source.lookup(request);
    // Map keeps insertion order, so the first key is the oldest entry.
    while (this.entries.size >= this.options.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    this.entries.set(key, { contacts, expiresAt: this.now() + this.options.ttlMs });
    return contacts;
  }
}
