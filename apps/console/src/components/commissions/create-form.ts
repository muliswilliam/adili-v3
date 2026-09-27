import { z } from 'zod';

import type {
  CommissionType,
  CreateCommission,
  DirectoryError,
} from '../../server/directory/client';
import {
  NAME_LENGTH,
  OFFICER_CATEGORY_CODES,
  RESERVED_SLUGS,
  SLUG_PATTERN,
} from '../../server/directory/contract';
import { messages as m } from './messages';

/** Fields of the create form, in the order they appear (focus goes to the first invalid one). */
export const CREATE_FIELDS = ['name', 'slug', 'type', 'categories'] as const;
export type CreateField = (typeof CREATE_FIELDS)[number];
export type FieldErrors = Partial<Record<CreateField, string>>;

/** What the user has entered so far. */
export interface CreateDraft {
  name: string;
  slug: string;
  type: CommissionType | '';
  categories: string[];
}

export const EMPTY_DRAFT: CreateDraft = { name: '', slug: '', type: 'hosted', categories: [] };

/** The contract's `CreateCommission` rules with the spec's error copy (S19). */
export const createCommissionForm = z.object({
  name: z.string().trim().min(NAME_LENGTH.min, m.nameError).max(NAME_LENGTH.max, m.nameError),
  slug: z.string().superRefine((slug, context) => {
    if (RESERVED_SLUGS.includes(slug)) {
      context.addIssue({ code: 'custom', message: m.slugReserved });
    } else if (!SLUG_PATTERN.test(slug)) {
      context.addIssue({ code: 'custom', message: m.slugError });
    }
  }),
  type: z.enum(['hosted', 'federated'], { error: m.typeError }),
  categories: z
    .array(z.enum(OFFICER_CATEGORY_CODES, { error: m.categoriesError }))
    .refine((codes) => new Set(codes).size === codes.length, m.categoriesError),
}) satisfies z.ZodType<CreateCommission>;

export type DraftCheck =
  { ok: true; commission: CreateCommission } | { ok: false; errors: FieldErrors };

/** Checks the draft before any request is made; one message per invalid field. */
export function checkDraft(draft: CreateDraft): DraftCheck {
  const parsed = createCommissionForm.safeParse(draft);
  if (parsed.success) return { ok: true, commission: parsed.data };
  const errors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as CreateField;
    errors[field] ??= issue.message;
  }
  return { ok: false, errors };
}

/** The error of one field for the draft as it is now, or undefined when that field is valid. */
export function checkField(draft: CreateDraft, field: CreateField): string | undefined {
  const check = checkDraft(draft);
  return check.ok ? undefined : check.errors[field];
}

/** Keys are lowercase with no spaces; other characters stay so the error can explain them. */
export function normaliseSlug(input: string): string {
  return input.toLowerCase().replace(/\s+/g, '');
}

/** The issuer code reference numbers will carry, once the key is valid. */
export function issuerCodeOf(slug: string): string | null {
  return SLUG_PATTERN.test(slug) && !RESERVED_SLUGS.includes(slug) ? slug.toUpperCase() : null;
}

/** How the form shows a create request that the directory did not accept. */
export interface SubmitFailure {
  fieldErrors: FieldErrors;
  /** Problem errors that name no form field; listed in the summary alert. */
  unmapped: string[];
  alert: 'conflict' | 'error' | 'in-progress' | 'changed' | 'forbidden' | null;
  /**
   * The directory stored this outcome against the Idempotency-Key, so a changed request needs a
   * new key. False after network errors and 5xx: the retry must reuse the key.
   */
  newKey: boolean;
}

export function submitFailure(error: DirectoryError, draft: CreateDraft): SubmitFailure {
  const failure: SubmitFailure = { fieldErrors: {}, unmapped: [], alert: null, newKey: false };
  if (error.kind !== 'problem') {
    return { ...failure, alert: 'error' };
  }
  const { problem } = error;
  if (problem.type === 'idempotency-key-in-use') {
    return { ...failure, alert: 'in-progress' };
  }
  failure.newKey = true;
  if (problem.status === 422) return { ...failure, alert: 'changed' };
  if (problem.status === 403) return { ...failure, alert: 'forbidden' };
  if (problem.status !== 400 && problem.status !== 409) return { ...failure, alert: 'error' };

  for (const { path, message } of problem.errors ?? []) {
    const field = fieldOf(path);
    const copy = field && fieldCopy(problem.status, field, draft);
    if (field && copy) {
      failure.fieldErrors[field] ??= copy;
    } else {
      failure.unmapped.push(path ? `${path}: ${message}` : message);
    }
  }
  if (Object.keys(failure.fieldErrors).length === 0 && failure.unmapped.length === 0) {
    failure.alert = problem.status === 409 ? 'conflict' : 'error';
  }
  return failure;
}

/** `categories.1` → `categories`; paths that are not form fields → null. */
function fieldOf(path: string): CreateField | null {
  const head = path.split('.')[0];
  return (CREATE_FIELDS as readonly string[]).includes(head ?? '') ? (head as CreateField) : null;
}

function fieldCopy(status: number, field: CreateField, draft: CreateDraft): string | null {
  if (status === 409) {
    if (field === 'slug') return m.slugTaken(draft.slug);
    if (field === 'name') return m.nameTaken;
    return null;
  }
  switch (field) {
    case 'name':
      return m.nameError;
    case 'slug':
      return RESERVED_SLUGS.includes(draft.slug) ? m.slugReserved : m.slugError;
    case 'type':
      return m.typeError;
    case 'categories':
      return m.categoriesError;
  }
}
