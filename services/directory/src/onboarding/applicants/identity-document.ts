import { and, eq, sql } from 'drizzle-orm';

import type { Transaction } from '../../commissions/commissions.service.js';
import { type IdentityDocumentKind, persons } from '../../persons/schema.js';

/** An applicant's identity document, normalised (`startApplicantOnboardingBody`). */
export interface IdentityDocument {
  kind: IdentityDocumentKind;
  /** Digits of a national ID; upper-case letters and digits of a passport number. */
  number: string;
  /** A passport's issuing country (ISO 3166-1 alpha-2); null for a national ID. */
  country: string | null;
}

/** The person columns that hold the document. */
export function documentColumns(document: IdentityDocument) {
  return document.kind === 'national-id'
    ? { nationalId: document.number, passportNumber: null, passportCountry: null }
    : { nationalId: null, passportNumber: document.number, passportCountry: document.country };
}

/** Whether an applicant already onboarded with this document (one person per document). */
export async function applicantExists(
  tx: Transaction,
  document: IdentityDocument,
): Promise<boolean> {
  const [found] = await tx
    .select({ id: persons.id })
    .from(persons)
    .where(
      document.kind === 'national-id'
        ? and(eq(persons.kind, 'applicant'), eq(persons.nationalId, document.number))
        : and(
            eq(persons.passportCountry, document.country ?? ''),
            eq(persons.passportNumber, document.number),
          ),
    )
    .limit(1);
  return found !== undefined;
}

/**
 * Takes turns, for the rest of the transaction, with every other completion for the same
 * document, so two sessions for one document cannot both create a person.
 */
export async function lockDocument(tx: Transaction, document: IdentityDocument): Promise<void> {
  const key = `applicant:${document.kind}:${document.country ?? ''}:${document.number}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}
