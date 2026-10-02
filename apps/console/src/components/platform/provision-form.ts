import type { DirectoryError } from '../../server/directory/client';
import type { AssignFieldErrors } from '../commissions/assign-form';
import { messages as m } from './messages';

/**
 * How the provision dialog shows a provisioning the directory did not accept (directory.yaml
 * `provisionAgencyOfficer`). The fields and their checks are the reporting officer's (name,
 * official email, E.164 phone), so the dialog checks them with `assign-form.ts`.
 */
export type ProvisionAlert =
  | 'rejected'
  | 'error'
  | 'not-sent'
  | 'in-progress'
  | 'busy'
  | 'changed'
  | 'not-found'
  | 'forbidden';

export interface ProvisionFailure {
  fieldErrors: AssignFieldErrors;
  /** Problem errors that name no field; listed under the alert. */
  unmapped: string[];
  alert: ProvisionAlert | null;
  /**
   * The directory stored this outcome against the Idempotency-Key, so a changed request needs a
   * new key. False after network errors, 5xx and a key still in use: the retry reuses the key.
   */
  newKey: boolean;
}

const FIELDS = ['name', 'email', 'phone'] as const;
type Field = (typeof FIELDS)[number];

const FIELD_COPY: Record<Field, string> = {
  name: m.nameError,
  email: m.emailError,
  phone: m.phoneError,
};

export function provisionFailure(error: DirectoryError): ProvisionFailure {
  const failure: ProvisionFailure = { fieldErrors: {}, unmapped: [], alert: null, newKey: false };
  // Provisioned, but the email failed: a retry with the same key sends it.
  if (error.kind === 'unavailable' && error.problemType === 'invitation-not-sent') {
    return { ...failure, alert: 'not-sent' };
  }
  if (error.kind !== 'problem') return { ...failure, alert: 'error' };
  const { problem } = error;
  if (problem.type === 'idempotency-key-in-use') return { ...failure, alert: 'in-progress' };

  failure.newKey = true;
  if (problem.type === 'email-belongs-to-other-tenant') {
    return { ...failure, fieldErrors: { email: m.emailOtherTenant } };
  }
  if (problem.type === 'lea-officer-of-other-agency') {
    return { ...failure, fieldErrors: { email: m.emailOtherAgency } };
  }
  if (problem.type === 'lea-officer-busy') return { ...failure, alert: 'busy' };
  if (problem.status === 404) return { ...failure, alert: 'not-found' };
  if (problem.status === 403) return { ...failure, alert: 'forbidden' };
  if (problem.status === 422) return { ...failure, alert: 'changed' };
  if (problem.status !== 400) return { ...failure, alert: 'error' };

  for (const { path, message } of problem.errors ?? []) {
    const field = (FIELDS as readonly string[]).includes(path) ? (path as Field) : null;
    if (field) failure.fieldErrors[field] ??= FIELD_COPY[field];
    else failure.unmapped.push(path ? `${path}: ${message}` : message);
  }
  return { ...failure, alert: 'rejected' };
}
