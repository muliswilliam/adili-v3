import type { PersonKey } from '@adili/forms';

/**
 * Paragraph 9's material changes (Act s.31(3)-(4), Regs r.21), composed by the service rather
 * than typed twice: the officer's marital-status change from bio, then every item flagged as
 * changed since the last declaration, person by person in First Schedule order, each with a
 * reference to its item. A flag still missing its kind or explanation is left out; its statement
 * reports it as incomplete. Pure: the caller passes the live (not archived) statements.
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
}

const CATEGORIES = ['income', 'assets', 'liabilities'] as const;

export function composeMaterialChanges({ bio, statements }: ComposedFrom): MaterialChangeEntry[] {
  const entries: MaterialChangeEntry[] = [];
  const marital = record(record(bio).maritalStatusChange);
  const maritalExplanation = text(marital.explanation);
  if (marital.changed === true && maritalExplanation) {
    entries.push({ kind: 'marital-status', explanation: maritalExplanation });
  }
  for (const [personKey, contents] of statements) {
    const statement = record(contents);
    for (const category of CATEGORIES) {
      const items = Array.isArray(statement[category]) ? (statement[category] as unknown[]) : [];
      for (const value of items) {
        const item = record(value);
        const change = record(item.change);
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
  return entries;
}

/** A string with something in it, else undefined. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
