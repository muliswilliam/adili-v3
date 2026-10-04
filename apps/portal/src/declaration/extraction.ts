import { confidenceLevel, type ConfidenceLevel, countyName, formatMoney } from '@adili/ui';

import type {
  Json,
  JsonObject,
  LoadedSuggestion,
  LoadedSuggestionSet,
} from '../server/declarations.server';
import type { DocumentKind } from '../server/declarations/types';
import { fieldText as text, type PatchEntry, readPath, suggestionKind } from './suggestions';
import { FAILURE_REASONS, READ_FIELD_LABELS } from './copy';
import { DOCUMENT_KIND_LABELS } from './labels';

/**
 * Pure rules for "Read into the form" (spec 05b S6, #316): which document kind to offer first,
 * how a `document` suggestion reads, and what applying it would change.
 *
 * A document's suggestion names its fields by their declaration.v1 path within the item
 * (`details.registration`, `outstanding.kesCents`, `location.county`), typed as the item types
 * them, and keeps how each was read in `sourceRef`:
 *   `sourceRef` = { documentKind, fields: [{name, confidence, page}], warnings, attachmentId }
 * A field without its own entry takes the suggestion's `confidence`. Anything malformed is left
 * out rather than refused. Why a reading failed is the set's `reason`.
 */

/** Every kind the contract has, in the order the sheet offers them. */
export const DOCUMENT_KINDS = Object.keys(DOCUMENT_KIND_LABELS) as readonly DocumentKind[];

/** The kind to offer first for an item of this type. */
export function defaultKind(itemType: string | undefined): DocumentKind {
  return suggestionKind(itemType).documentKind;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function score(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

/**
 * How the review sheet takes a field's value: typed, picked from the counties, as an amount
 * (held in cents), or ticked.
 */
export type ReadFieldInput = 'text' | 'county' | 'money' | 'boolean';

export interface ReadField {
  /** The field's path in the item, e.g. `details.registration`. */
  key: string;
  label: string;
  input: ReadFieldInput;
  /** As text: an amount's cents in digits, a tick `true` or `false`. */
  value: string;
  /** 0-1, or null when neither the field nor the suggestion has one. */
  confidence: number | null;
  page: number | null;
}

export interface DocumentReading {
  documentKind: DocumentKind | null;
  fields: ReadField[];
  warnings: string[];
}

function inputOf(key: string, value: unknown): ReadFieldInput {
  if (key === 'location.county') return 'county';
  if (key.endsWith('.kesCents')) return 'money';
  return typeof value === 'boolean' ? 'boolean' : 'text';
}

/** A read value as the sheet holds it; '' when there is nothing to show. */
function valueText(value: unknown): string {
  return typeof value === 'boolean' ? String(value) : text(value);
}

/** A `document` suggestion in the convention above. */
export function readSuggestion(suggestion: LoadedSuggestion): DocumentReading {
  const ref = record(suggestion.sourceRef) ?? {};
  const perField = new Map<string, { confidence: number | null; page: number | null }>();
  if (Array.isArray(ref.fields)) {
    for (const entry of ref.fields) {
      const field = record(entry);
      if (!field || typeof field.name !== 'string') continue;
      const page = field.page;
      perField.set(field.name, {
        confidence: score(field.confidence),
        page: typeof page === 'number' && Number.isInteger(page) && page > 0 ? page : null,
      });
    }
  }

  // In the order the reading gave them, then any the reading did not list.
  const keys = [...new Set([...perField.keys(), ...Object.keys(suggestion.fields)])];
  const fields = keys
    .filter((key) => key in suggestion.fields && valueText(suggestion.fields[key]) !== '')
    .map((key): ReadField => {
      const own = perField.get(key);
      return {
        key,
        label: READ_FIELD_LABELS[key] ?? key,
        input: inputOf(key, suggestion.fields[key]),
        value: valueText(suggestion.fields[key]),
        confidence: own?.confidence ?? score(suggestion.confidence),
        page: own?.page ?? null,
      };
    });

  const kind = ref.documentKind;
  return {
    documentKind: DOCUMENT_KINDS.includes(kind as DocumentKind) ? (kind as DocumentKind) : null,
    fields,
    warnings: Array.isArray(ref.warnings)
      ? ref.warnings.filter((each): each is string => typeof each === 'string' && each !== '')
      : [],
  };
}

/** A field's level, or null when it has no confidence. */
export function levelOf(field: ReadField): ConfidenceLevel | null {
  return field.confidence === null ? null : confidenceLevel(field.confidence);
}

/** Where a reading stands, from its set as last listed. */
export type ReadingState =
  | { status: 'reading' }
  | { status: 'ready'; suggestion: LoadedSuggestion }
  | { status: 'failed'; reason: string }
  | { status: 'not-enabled' };

export function readingState(set: LoadedSuggestionSet): ReadingState {
  if (set.status === 'pending') return { status: 'reading' };
  if (set.status === 'not-enabled') return { status: 'not-enabled' };
  if (set.status === 'ready') {
    const suggestion = set.suggestions.find((each) => each.status === 'new');
    if (suggestion) return { status: 'ready', suggestion };
  }
  return {
    status: 'failed',
    reason: set.reason ? FAILURE_REASONS[set.reason] : FAILURE_REASONS.unknown,
  };
}

/** Some document set says reading is off for this Commission. */
export function readingNotEnabledIn(sets: LoadedSuggestionSet[]): boolean {
  return sets.some((set) => set.source === 'document' && set.status === 'not-enabled');
}

/** An edited value typed as the field takes it: an amount's cents as a number, a tick as one. */
function typed(field: ReadField | undefined, value: string): Json {
  const trimmed = value.trim();
  if (field?.input === 'money') {
    return /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
  }
  if (field?.input === 'boolean') return trimmed === 'true';
  return trimmed;
}

/** The fields to accept: the suggestion's, with the declarant's edits typed over them. */
export function acceptedFields(
  suggestion: LoadedSuggestion,
  edited: Record<string, string>,
): JsonObject {
  const fields = readSuggestion(suggestion).fields;
  const typedEdits = Object.fromEntries(
    Object.entries(edited).map(([key, value]) => [
      key,
      typed(
        fields.find((field) => field.key === key),
        value,
      ),
    ]),
  );
  return { ...suggestion.fields, ...typedEdits };
}

/** A value the declarant already entered that applying would meet. */
export interface Clash {
  entry: PatchEntry;
  existing: string;
}

/** A value of `key` as the sheet shows it: amounts in shillings, counties by name. */
function display(key: string, value: unknown): string {
  if (typeof value === 'boolean') return String(value);
  if (key.endsWith('.kesCents') && typeof value === 'number') return formatMoney(value);
  const shown = text(value);
  return key === 'location.county' && shown ? countyName(shown) : shown;
}

/**
 * The item fields that already hold something else than what applying would write. They are
 * kept unless the declarant chooses to replace them (`overwrite`).
 */
export function clashes(item: unknown, fields: JsonObject): Clash[] {
  return Object.entries(fields).flatMap(([key, value]): Clash[] => {
    const wanted = valueText(value);
    if (wanted === '') return [];
    const current = readPath(item, key);
    const existing = valueText(current);
    if (existing === '' || existing === wanted) return [];
    return [
      {
        entry: {
          path: key,
          label: READ_FIELD_LABELS[key] ?? key,
          value: wanted,
          display: display(key, value),
        },
        existing: display(key, current),
      },
    ];
  });
}
