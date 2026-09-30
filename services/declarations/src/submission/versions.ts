import { ZodValidationPipe } from '@adili/api-kit';
import type { FieldCipher } from '@adili/data-access';
import type { DeclarationV1 } from '@adili/forms';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { Transaction } from '../db/transaction.js';
import { isUuid } from '../guards.js';
import { declarationVersions } from './schema.js';

/** Reads of submitted versions, inside a transaction the caller opened (person or tenant). */

/** A `version` path parameter: a positive integer, else 400. */
export const versionNumber = new ZodValidationPipe(z.coerce.number().int().min(1));

export type VersionRow = typeof declarationVersions.$inferSelect;

/** The AAD record id of a version's snapshot: a snapshot cannot move to another version. */
export function versionRecordId(versionId: string): string {
  return `declaration-version:${versionId}`;
}

/**
 * The version's `declaration.v1` document as it was submitted, decrypted with the Commission's
 * key: the exact canonical JSON its `canonicalSha256` is the hash of, parsed.
 */
export async function openSnapshot(cipher: FieldCipher, row: VersionRow): Promise<DeclarationV1> {
  const plaintext = await cipher.decrypt({
    tenant: row.tenant,
    recordId: versionRecordId(row.id),
    ciphertext: row.snapshotCiphertext.toString('base64'),
    envelope: row.envelope,
  });
  return JSON.parse(plaintext.toString('utf8')) as DeclarationV1;
}

/** A version of the declaration by number, as the transaction's context lets it be seen. */
export async function versionRow(
  tx: Transaction,
  declarationId: string,
  version: number,
  { lock = false }: { lock?: boolean } = {},
): Promise<VersionRow | null> {
  if (!isUuid(declarationId)) return null;
  const query = tx
    .select()
    .from(declarationVersions)
    .where(
      and(
        eq(declarationVersions.declarationId, declarationId),
        eq(declarationVersions.version, version),
      ),
    )
    .limit(1);
  const [row] = lock ? await query.for('update') : await query;
  return row ?? null;
}
