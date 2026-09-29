import type { PersonKey } from '@adili/forms';
import { isDeepStrictEqual } from 'node:util';

import type { Transaction } from '../db/transaction.js';
import { isRecord } from '../guards.js';
import { assessSections } from './completeness.js';
import { planStatements, type StatementPerson } from './household.js';
import { type DeclarationRow, incomePeriodOf, sectionIs, type SectionRow } from './repository.js';
import {
  declarationSections,
  type SectionCompleteness,
  type SectionMetadata,
  type StoredEnvelope,
} from './schema.js';
import type { SealedSection, SectionCipher } from './section-cipher.js';
import {
  displayName,
  emptyStatement,
  type SectionContents,
  sectionMetadata,
  type StatementFrame,
  type StatementKey,
  statementKey,
  statementPersonKey,
} from './sections.js';

/**
 * The financial statements' lifecycle (spec 05 S5): what a household save does to them, writing
 * that in the save's transaction, and whose each statement is by name.
 */

/** A statement section a household save creates, restores, renames or archives. */
export interface StatementChange {
  key: StatementKey;
  /** As reported in `sectionsChanged`; none for a rename only. */
  action?: 'created' | 'restored' | 'archived';
  insert: boolean;
  completeness: SectionCompleteness;
  metadata: SectionMetadata;
  /** New contents, when they change: sealed, and to cache at `savedVersion`. */
  contents?: SectionContents;
  ciphertext?: Buffer;
  envelope?: StoredEnvelope;
  savedVersion?: number;
}

/**
 * What a household save does to the financial statements (`rows`, archived ones included): an
 * empty statement for each person new to it, the statement of each person back in it restored,
 * the statement of each person gone from it (or a child no longer under eighteen) archived, and
 * the name on each live statement kept in step with the household. Nothing is deleted before
 * discard. Sealed ahead of the save's transaction, at the version it will write.
 */
export async function statementChanges(
  cipher: SectionCipher,
  declaration: DeclarationRow,
  rows: readonly SectionRow[],
  wanted: StatementPerson[],
  savedVersion: number,
): Promise<StatementChange[]> {
  const byKey = new Map(rows.map((row) => [row.sectionKey, row]));
  const plan = planStatements(
    wanted,
    rows.map((row) => ({
      personKey: statementPersonKey(row.sectionKey) ?? 'officer',
      archived: row.metadata.archived === true,
    })),
  );
  const frame = (who: StatementPerson) => ({
    personKey: who.personKey,
    personName: who.personName,
    statementDate: declaration.statementDate,
    incomePeriod: incomePeriodOf(declaration),
  });
  const seal = async (
    key: StatementKey,
    contents: SectionContents,
  ): Promise<SealedSection & { contents: SectionContents }> => ({
    contents,
    ...(await cipher.seal(declaration.tenant, declaration.id, key, contents)),
  });

  const created = plan.create.map(async (who): Promise<StatementChange> => {
    const key = statementKey(who.personKey);
    const contents = emptyStatement(frame(who) as StatementFrame);
    return {
      key,
      action: 'created',
      insert: true,
      completeness: 'not-started',
      metadata: sectionMetadata(key, contents),
      savedVersion,
      ...(await seal(key, contents)),
    };
  });
  const renamed = [...plan.restore, ...plan.keep].map(
    async (who): Promise<StatementChange | null> => {
      const key = statementKey(who.personKey);
      const row = byKey.get(key);
      if (!row) return null;
      const restoring = row.metadata.archived === true;
      const stored = await cipher.open(declaration.tenant, row);
      const sameName = isDeepStrictEqual(stored.personName, who.personName);
      if (!restoring && sameName) return null;
      const contents = sameName ? stored : { ...stored, ...frame(who) };
      const metadata = { ...row.metadata };
      delete metadata.archived;
      return {
        key,
        ...(restoring && { action: 'restored' as const }),
        insert: false,
        // A statement never saved stays not started; one saved is assessed again.
        completeness:
          row.updatedAt === null ? 'not-started' : statementCompleteness(who.personKey, contents),
        metadata,
        ...(sameName ? {} : { savedVersion, ...(await seal(key, contents)) }),
      };
    },
  );
  const archived = plan.archive.map((personKey): StatementChange => {
    const key = statementKey(personKey);
    return {
      key,
      action: 'archived',
      insert: false,
      completeness: 'archived',
      metadata: { ...byKey.get(key)?.metadata, archived: true },
    };
  });
  const changes = await Promise.all([...created, ...renamed]);
  return [...changes.filter((change) => change !== null), ...archived];
}

/** Writes a household save's statement changes in its transaction. */
export async function writeStatementChanges(
  tx: Transaction,
  declarationId: string,
  changes: readonly StatementChange[],
  now: Date,
): Promise<void> {
  // Statements are listed by creation within a kind: a millisecond apart, they keep the order the
  // household lists the people in.
  const createdAt = now.getTime();
  let created = 0;
  for (const change of changes) {
    const { ciphertext, envelope, savedVersion } = change;
    const sealed =
      ciphertext && envelope && savedVersion !== undefined
        ? { ciphertext, envelope, savedVersion }
        : undefined;
    if (change.insert) {
      if (!sealed) throw new Error('A new statement must be sealed');
      await tx.insert(declarationSections).values({
        declarationId,
        sectionKey: change.key,
        completeness: change.completeness,
        metadata: change.metadata,
        createdAt: new Date(createdAt + created++),
        ...sealed,
      });
      continue;
    }
    await tx
      .update(declarationSections)
      .set({ completeness: change.completeness, metadata: change.metadata, ...sealed })
      .where(sectionIs(declarationId, change.key));
  }
}

/**
 * Display names by person key, from the sections that hold them (`named`: bio, household and the
 * archived statements): the officer from bio, spouses and children from household, and people
 * removed from the household from their archived statements.
 */
export async function personNames(
  cipher: SectionCipher,
  declaration: DeclarationRow,
  named: readonly SectionRow[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const archived: SectionRow[] = [];
  for (const section of named) {
    if (section.completeness === 'archived') {
      archived.push(section);
      continue;
    }
    const contents = await cipher.open(declaration.tenant, section);
    if (section.sectionKey === 'bio') {
      const name = displayName(contents.name);
      if (name) names.set('officer', name);
      continue;
    }
    for (const [kind, list] of [
      ['spouse', contents.spouses],
      ['child', contents.children],
    ] as const) {
      const items = isRecord(list) && Array.isArray(list.items) ? list.items : [];
      for (const item of items) {
        if (!isRecord(item) || typeof item.id !== 'string') continue;
        const name = displayName(item.name);
        if (name) names.set(`${kind}:${item.id}`, name);
      }
    }
  }
  for (const section of archived) {
    const personKey = statementPersonKey(section.sectionKey);
    if (!personKey || names.has(personKey)) continue;
    const name = displayName((await cipher.open(declaration.tenant, section)).personName);
    if (name) names.set(personKey, name);
  }
  return names;
}

/** A statement's completeness on its own (statements are assessed one by one). */
function statementCompleteness(
  personKey: PersonKey,
  contents: SectionContents,
): 'complete' | 'incomplete' {
  const assessed = assessSections({
    bio: undefined,
    household: undefined,
    statements: new Map([[personKey, contents]]),
  });
  return assessed.get(statementKey(personKey))?.completeness ?? 'incomplete';
}
