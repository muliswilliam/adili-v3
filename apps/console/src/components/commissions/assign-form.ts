import { z } from 'zod';

import type { AssignReportingOfficer, DirectoryError } from '../../server/directory/client';
import { EMAIL_MAX_LENGTH, OFFICER_NAME_LENGTH } from '../../server/directory/contract';
import { messages as m } from './messages';
import { normalisePhone } from './phone';

/** Fields of the assign dialog, in the order they appear (focus goes to the first invalid one). */
export const ASSIGN_FIELDS = ['name', 'email', 'phone'] as const;
export type AssignField = (typeof ASSIGN_FIELDS)[number];
export type AssignFieldErrors = Partial<Record<AssignField, string>>;

/** What the admin has typed so far. */
export interface AssignDraft {
  name: string;
  email: string;
  phone: string;
}

export const EMPTY_ASSIGN_DRAFT: AssignDraft = { name: '', email: '', phone: '' };

/** A pragmatic email check (the directory has the final say): one @, a dot in the domain. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** The contract's `AssignReportingOfficer` rules with the spec's error copy. */
const assignForm = z.object({
  name: z
    .string()
    .trim()
    .min(OFFICER_NAME_LENGTH.min, m.officerNameError)
    .max(OFFICER_NAME_LENGTH.max, m.officerNameError),
  email: z
    .string()
    .trim()
    .max(EMAIL_MAX_LENGTH, m.officerEmailError)
    .regex(EMAIL_PATTERN, m.officerEmailError)
    .transform((email) => email.toLowerCase()),
  phone: z.string().transform((phone, context) => {
    const e164 = normalisePhone(phone);
    if (e164 === null) {
      context.addIssue({ code: 'custom', message: m.officerPhoneError });
      return z.NEVER;
    }
    return e164;
  }),
}) satisfies z.ZodType<AssignReportingOfficer, AssignDraft>;

export type AssignCheck =
  { ok: true; officer: AssignReportingOfficer } | { ok: false; errors: AssignFieldErrors };

/** Checks the draft before any request is made; the officer is sent as normalised here. */
export function checkAssignDraft(draft: AssignDraft): AssignCheck {
  const parsed = assignForm.safeParse(draft);
  if (parsed.success) return { ok: true, officer: parsed.data };
  const errors: AssignFieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as AssignField;
    errors[field] ??= issue.message;
  }
  return { ok: false, errors };
}

/** The error of one field for the draft as it is now, or undefined when that field is valid. */
export function checkAssignField(draft: AssignDraft, field: AssignField): string | undefined {
  const check = checkAssignDraft(draft);
  return check.ok ? undefined : check.errors[field];
}

export type AssignAlert =
  'rejected' | 'error' | 'in-progress' | 'changed' | 'assigned' | 'not-found' | 'forbidden';

/** How the dialog shows an assign request the directory did not accept. */
export interface AssignFailure {
  fieldErrors: AssignFieldErrors;
  /** Problem errors that name no field; listed under the alert. */
  unmapped: string[];
  alert: AssignAlert | null;
  /**
   * The directory stored this outcome against the Idempotency-Key, so a changed request needs a
   * new key. False after network errors, 5xx and a key still in use: the retry reuses the key.
   */
  newKey: boolean;
}

export function assignFailure(error: DirectoryError): AssignFailure {
  const failure: AssignFailure = { fieldErrors: {}, unmapped: [], alert: null, newKey: false };
  if (error.kind !== 'problem') return { ...failure, alert: 'error' };
  const { problem } = error;
  if (problem.type === 'idempotency-key-in-use') return { ...failure, alert: 'in-progress' };

  failure.newKey = true;
  if (problem.type === 'email-belongs-to-other-tenant') {
    return { ...failure, fieldErrors: { email: m.officerEmailTaken } };
  }
  if (problem.type === 'reporting-officer-assigned') return { ...failure, alert: 'assigned' };
  if (problem.status === 404) return { ...failure, alert: 'not-found' };
  if (problem.status === 403) return { ...failure, alert: 'forbidden' };
  if (problem.status === 422) return { ...failure, alert: 'changed' };
  if (problem.status !== 400) return { ...failure, alert: 'error' };

  for (const { path, message } of problem.errors ?? []) {
    const field = (ASSIGN_FIELDS as readonly string[]).includes(path)
      ? (path as AssignField)
      : null;
    if (field) {
      failure.fieldErrors[field] ??= FIELD_COPY[field];
    } else {
      failure.unmapped.push(path ? `${path}: ${message}` : message);
    }
  }
  return { ...failure, alert: 'rejected' };
}

const FIELD_COPY: Record<AssignField, string> = {
  name: m.officerNameError,
  email: m.officerEmailError,
  phone: m.officerPhoneError,
};
