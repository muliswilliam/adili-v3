import { confidenceLevel, type ConfidenceLevel } from '@adili/ui';

import type {
  DocumentKind,
  JsonObject,
  LoadedSuggestion,
  LoadedSuggestionSet,
} from '../../server/declarations.server';
import {
  declaredType,
  editFields,
  type PatchEntry,
  readPath,
  suggestionPatch,
} from './suggestions';

/**
 * Pure rules for "Read into the form" (spec 05b S6, #316): which document kind to offer first,
 * how a `document` suggestion reads, and what applying it would change.
 *
 * The contract gives a suggestion one confidence and no pages, warnings or failure reason
 * (contract gap 3), so the portal reads them from `sourceRef` in this convention, which the
 * mock emits:
 *   `fields` = {name: value}
 *   `sourceRef` = { documentKind?, fields?: [{name, confidence, page?}], warnings?: string[],
 *                   reason?: string }
 * A field without its own entry takes the suggestion's `confidence`. Anything malformed is
 * left out rather than refused.
 */

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  'title-deed': 'Title deed',
  logbook: 'Logbook',
  payslip: 'Payslip',
  'bank-letter': 'Bank letter',
  'share-certificate': 'Share certificate',
  other: 'Other',
};

/** Every kind the contract has, in the order the sheet offers them. */
export const DOCUMENT_KINDS = Object.keys(DOCUMENT_KIND_LABELS) as readonly DocumentKind[];

export const EXTRACTION_COPY = {
  menu: 'Read into the form',
  notEnabled: 'Read into the form: not enabled for your Commission',
  title: 'Read into the form',
  kindLegend: 'What is this document?',
  aiLabel: 'AI-assisted',
  aiNote: 'You check every field before anything is added.',
  read: 'Read document',
  cancel: 'Cancel',
  close: 'Close',
  reading: 'Reading…',
  readingHint: 'This can take up to a minute.',
  reviewTitle: 'Check what was read',
  reviewHint: 'Edit anything that is wrong.',
  page: (page: number) => `Page ${String(page)}`,
  checked: 'I checked this against the document',
  kept: (value: string) => `You entered: ${value} (kept)`,
  replaced: (value: string) => `You entered: ${value} (replaced)`,
  replace: 'Replace details I already entered',
  tickLow: (count: number) => `Tick the Low field${count === 1 ? '' : 's'} to continue.`,
  addNew: 'Add as new item',
  applyHere: 'Apply to this item',
  nothingRead: 'Nothing could be read from this document. You can enter the details manually.',
  failed: (reason: string) =>
    `Could not read this document (${reason}). You can enter the details manually.`,
  tryAgain: 'Try again',
  notEnabledBody: 'Reading documents into the form is not enabled for your Commission.',
  refreshing: 'Section changed. Refreshing…',
  applied: 'Details applied to this item',
  added: 'Added as a new item',
  applyFailed: 'The details could not be added. Try again.',
  rowDetail: 'Read into the form',
} as const;

/** Why a reading failed, when the service did not say (the contract has no reason: gap 3). */
export const FAILURE_REASONS = {
  unknown: 'the document could not be processed',
  timeout: 'it took too long',
  unavailable: 'the service is not available now',
  refused: 'the file is not ready to be read',
  missing: 'the file is no longer attached',
} as const;

/** The kind to offer first for an item of this type. */
export function defaultKind(itemType: string | undefined): DocumentKind {
  const type = declaredType(itemType ?? '');
  if (type === 'vehicle') return 'logbook';
  if (type === 'land' || type === 'building') return 'title-deed';
  if (type === 'shareholding' || type === 'securities') return 'share-certificate';
  if (['bank-account', 'mortgage', 'loan', 'guarantee'].includes(type)) return 'bank-letter';
  return 'other';
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

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/** Labels for fields "Edit and add" does not offer. */
const EXTRA_LABELS: Record<string, string> = { county: 'County' };

export interface ReadField {
  /** The suggestion field name, e.g. `registration`. */
  key: string;
  label: string;
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

/** A `document` suggestion in the sourceRef convention above. */
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

  const known = editFields(suggestion.itemType);
  const keys = [
    ...known.map(({ key }) => key).filter((key) => key !== 'description'),
    ...Object.keys(EXTRA_LABELS),
    'description',
  ];
  const fields = keys
    .filter((key) => text(suggestion.fields[key]) !== '')
    .map((key): ReadField => {
      const own = perField.get(key);
      return {
        key,
        label: known.find((each) => each.key === key)?.label ?? EXTRA_LABELS[key] ?? key,
        value: text(suggestion.fields[key]),
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

/** The set's reason for failing, if a suggestion in it carries one; the generic one otherwise. */
function reasonIn(set: LoadedSuggestionSet): string {
  for (const suggestion of set.suggestions) {
    const reason = text(record(suggestion.sourceRef)?.reason);
    if (reason) return reason;
  }
  return FAILURE_REASONS.unknown;
}

export function readingState(set: LoadedSuggestionSet): ReadingState {
  if (set.status === 'pending') return { status: 'reading' };
  if (set.status === 'not-enabled') return { status: 'not-enabled' };
  if (set.status === 'ready') {
    const suggestion = set.suggestions.find((each) => each.status === 'new');
    if (suggestion) return { status: 'ready', suggestion };
  }
  return { status: 'failed', reason: reasonIn(set) };
}

/** Some document set says reading is off for this Commission. */
export function extractionOff(sets: LoadedSuggestionSet[]): boolean {
  return sets.some((set) => set.source === 'document' && set.status === 'not-enabled');
}

/** The fields to accept: the suggestion's, with the declarant's edits trimmed over them. */
export function acceptedFields(
  suggestion: LoadedSuggestion,
  edited: Record<string, string>,
): JsonObject {
  const trimmed = Object.fromEntries(
    Object.entries(edited).map(([key, value]) => [key, value.trim()]),
  );
  return { ...suggestion.fields, ...trimmed };
}

/** A value the declarant already entered that applying would meet. */
export interface Clash {
  entry: PatchEntry;
  existing: string;
}

/**
 * The item fields that already hold something else than what applying would write. They are
 * kept unless the declarant chooses to replace them (`overwrite`).
 */
export function clashes(item: unknown, fields: JsonObject, itemType: string): Clash[] {
  return suggestionPatch({ itemType, fields }).flatMap((entry) => {
    const existing = text(readPath(item, entry.path));
    return existing !== '' && existing !== entry.value ? [{ entry, existing }] : [];
  });
}
