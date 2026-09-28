/** A person's verified contacts (directory.yaml `PersonContacts`); null where none is verified. */
export interface PersonContacts {
  email: string | null;
  /** E.164. */
  phone: string | null;
}

/** The directory did not answer a contact lookup usably (unreachable, refused, timed out). */
export class ContactLookupError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ContactLookupError';
  }
}

/** Whose contacts, for a message sent for which tenant. */
export interface ContactLookup {
  personId: string;
  /** The Commission the message is sent for: the person must be onboarded there. */
  tenant: string;
}

/**
 * Where a person's contacts come from. An unknown person, or one not onboarded at the tenant, has
 * no contacts; any failure to find out throws `ContactLookupError`, so "no contact" is never a
 * guess.
 */
export abstract class PersonContactsSource {
  abstract lookup(request: ContactLookup): Promise<PersonContacts>;
}
