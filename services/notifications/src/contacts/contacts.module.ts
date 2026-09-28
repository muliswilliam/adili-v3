import { Module } from '@nestjs/common';
import { ServiceTokenClient } from '@adili/api-kit';

import { config } from '../config.js';
import {
  DIRECTORY_PERSON_CONTACTS_SCOPE,
  DirectoryPersonContacts,
} from './directory-person-contacts.js';
import { PersonContactsSource } from './person-contacts.js';
import { PersonContactsCache } from './person-contacts-cache.js';

/** The uncached directory lookup; tests replace it with `FakePersonContacts`. */
export const DIRECTORY_CONTACTS = Symbol('DIRECTORY_CONTACTS');

/** Contacts are reused for 10 minutes; a changed contact reaches reminders after that. */
export const CONTACTS_TTL_MS = 10 * 60_000;

/**
 * A person's verified contacts for person recipients: `PersonContactsSource` is the directory
 * lookup (`GET /internal/v1/persons/{personId}/contacts`) behind a 10-minute cache.
 */
@Module({
  providers: [
    {
      provide: DIRECTORY_CONTACTS,
      useFactory: () =>
        new DirectoryPersonContacts({
          directoryUrl: config.DIRECTORY_URL,
          tokens: new ServiceTokenClient({
            issuerUrl: config.OIDC_ISSUER_URL,
            clientId: config.KEYCLOAK_CLIENT_ID,
            clientSecret: config.KEYCLOAK_CLIENT_SECRET,
            scopes: [DIRECTORY_PERSON_CONTACTS_SCOPE],
            timeoutMs: config.CONTACT_LOOKUP_TIMEOUT_MS,
          }),
          timeoutMs: config.CONTACT_LOOKUP_TIMEOUT_MS,
        }),
    },
    {
      provide: PersonContactsSource,
      inject: [DIRECTORY_CONTACTS],
      useFactory: (directory: PersonContactsSource) =>
        new PersonContactsCache(directory, { ttlMs: CONTACTS_TTL_MS, maxEntries: 100_000 }),
    },
  ],
  exports: [PersonContactsSource],
})
export class ContactsModule {}
