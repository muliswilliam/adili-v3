import type { PersonKey } from '@adili/forms';

import { recordOf } from '../guards.js';

/**
 * Paragraph 9's material changes (Act s.31(3)-(4), Regs r.21), composed by the service rather
 * than typed twice: the declarant's marital-status change from bio, then every item flagged as
 * changed since the last declaration, person by person in First Schedule order, each with a
 * reference to its item, then the declarant's directorships and memberships flagged as changed.
 * A flag still missing its kind or explanation is left out; its section reports it as
 * incomplete. Pure: the caller passes the live (not archived) statements.
 */

/** `declaration.v1` `MaterialChangeEntry`. */
export interface MaterialChangeEntry {
  personKey?: PersonKey;
  itemId?: string;
  itemDescription?: string;
  kind: string;
  explanation: string;
}

export interface ComposedFrom {
  bio: unknown;
  /** Live statements by person key, in First Schedule order. */
  statements: readonly (readonly [PersonKey, unknown])[];
  /** Paragraph 9's `registrableInterests`, as saved; absent before `other` is. */
  interests?: unknown;
}

/** The registrable interests that carry a change flag, and what names each entry. */
const INTERESTS = [
  { list: 'directorships', kind: 'directorship', name: 'company' },
  { list: 'memberships', kind: 'membership', name: 'entity' },
] as const;

const CATEGORIES = ['income', 'assets', 'liabilities'] as const;

export function composeMaterialChanges({
  bio,
  statements,
  interests,
}: ComposedFrom): MaterialChangeEntry[] {
  const entries: MaterialChangeEntry[] = [];
  const marital = recordOf(recordOf(bio).maritalStatusChange);
  const maritalExplanation = text(marital.explanation);
  if (marital.changed === true && maritalExplanation) {
    entries.push({ kind: 'marital-status', explanation: maritalExplanation });
  }
  for (const [personKey, contents] of statements) {
    const statement = recordOf(contents);
    for (const category of CATEGORIES) {
      const items = Array.isArray(statement[category]) ? (statement[category] as unknown[]) : [];
      for (const value of items) {
        const item = recordOf(value);
        const change = recordOf(item.change);
        const kind = text(change.kind);
        const explanation = text(change.explanation);
        if (change.changed !== true || !kind || !explanation) continue;
        entries.push({
          personKey,
          ...(typeof item.id === 'string' && { itemId: item.id }),
          ...(typeof item.description === 'string' && { itemDescription: item.description }),
          kind,
          explanation,
        });
      }
    }
  }
  const registrable = recordOf(interests);
  for (const { list, kind, name } of INTERESTS) {
    const items = Array.isArray(registrable[list]) ? (registrable[list] as unknown[]) : [];
    for (const value of items) {
      const interest = recordOf(value);
      const change = recordOf(interest.change);
      const explanation = text(change.explanation);
      if (change.changed !== true || !text(change.kind) || !explanation) continue;
      entries.push({
        personKey: 'officer',
        ...(typeof interest[name] === 'string' && { itemDescription: interest[name] }),
        kind,
        explanation,
      });
    }
  }
  return entries;
}

/** A string with something in it, else undefined. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}
