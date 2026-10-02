import type { AccessProblem, LeaRequestInput, Scope } from '../../server/access/types';
import type { ServiceError } from '../../server/service-call';
import { messages as m } from './messages';

/**
 * The new written request's rules (spec 10 S11), mirroring access.yaml `LeaRequestInput`: a
 * Commission, the officer sought (a name of 2 to 200 characters; entity, work station and file
 * number optional), the reason (up to 4,000), the case reference (up to 100) and a scope of at
 * least one year and one section, never clarifications. The service has the final say.
 */

export const REASON_MAX = 4000;
export const CASE_REFERENCE_MAX = 100;

export interface LeaDraft {
  commission: string | null;
  name: string;
  entity: string;
  workStation: string;
  personnelFileNumber: string;
  reason: string;
  caseReference: string;
  scope: Scope;
}

/** Fields in the order they appear (focus goes to the first one at fault). */
export const LEA_FIELDS = [
  'commission',
  'name',
  'entity',
  'workStation',
  'personnelFileNumber',
  'reason',
  'caseReference',
  'years',
  'sections',
] as const;
export type LeaField = (typeof LEA_FIELDS)[number];
export type LeaErrors = Partial<Record<LeaField, string>>;

export const EMPTY_SCOPE: Scope = {
  years: [],
  includeSpouses: false,
  includeChildren: false,
  sections: [],
  includeClarifications: false,
};

export function emptyLeaDraft(): LeaDraft {
  return {
    commission: null,
    name: '',
    entity: '',
    workStation: '',
    personnelFileNumber: '',
    reason: '',
    caseReference: '',
    scope: EMPTY_SCOPE,
  };
}

const LIMITS = { entity: 200, workStation: 200, personnelFileNumber: 30 } as const;

export function leaDraftErrors(draft: LeaDraft): LeaErrors {
  const errors: LeaErrors = {};
  if (!draft.commission) errors.commission = m.commissionRequired;
  const name = draft.name.trim();
  if (name.length < 2) errors.name = m.nameRequired;
  else if (name.length > 200) errors.name = m.tooLong(200);
  for (const field of ['entity', 'workStation', 'personnelFileNumber'] as const) {
    if (draft[field].trim().length > LIMITS[field]) errors[field] = m.tooLong(LIMITS[field]);
  }
  const reason = draft.reason.trim();
  if (!reason) errors.reason = m.reasonRequired;
  else if (reason.length > REASON_MAX) errors.reason = m.reasonTooLong;
  const caseReference = draft.caseReference.trim();
  if (!caseReference) errors.caseReference = m.caseReferenceRequired;
  else if (caseReference.length > CASE_REFERENCE_MAX) errors.caseReference = m.caseReferenceTooLong;
  if (draft.scope.years.length === 0) errors.years = m.yearsRequired;
  if (draft.scope.sections.length === 0) errors.sections = m.sectionsRequired;
  return errors;
}

export const hasLeaErrors = (errors: LeaErrors): boolean => Object.values(errors).some(Boolean);

/** The body the service takes: trimmed, optional fields left out when empty. */
export function leaInput(draft: LeaDraft & { commission: string }): LeaRequestInput {
  const optional = (value: string) => (value.trim() ? value.trim() : undefined);
  return {
    commission: draft.commission,
    officerSought: {
      name: draft.name.trim(),
      ...(optional(draft.entity) && { entity: optional(draft.entity) }),
      ...(optional(draft.workStation) && { workStation: optional(draft.workStation) }),
      ...(optional(draft.personnelFileNumber) && {
        personnelFileNumber: optional(draft.personnelFileNumber),
      }),
    },
    reason: draft.reason.trim(),
    caseReference: draft.caseReference.trim(),
    scope: { ...draft.scope, includeClarifications: false },
  };
}

/** How the form shows a request the service did not accept. */
export interface LeaSubmitFailure {
  title: string;
  text?: string;
  fieldErrors: LeaErrors;
  /** Problem errors that name no field, listed under the alert. */
  unmapped: string[];
  signIn: boolean;
  /** The service stored this outcome against the Idempotency-Key: a changed request needs a new one. */
  newKey: boolean;
}

/** What a field the service refused says: the form's own words, not the service's. */
const FIELD_COPY: Record<LeaField, string> = {
  commission: m.commissionInvalid,
  name: m.nameRequired,
  entity: m.checkField,
  workStation: m.checkField,
  personnelFileNumber: m.checkField,
  reason: m.reasonInvalid,
  caseReference: m.caseReferenceInvalid,
  years: m.yearsRequired,
  sections: m.sectionsRequired,
};

/** Where a field the service names (`errors[].path`) shows on the form. */
function fieldOf(path: string): LeaField | null {
  switch (path) {
    case 'commission':
    case 'reason':
    case 'caseReference':
      return path;
    case 'officerSought.name':
    case 'officerSought':
      return 'name';
    case 'officerSought.entity':
      return 'entity';
    case 'officerSought.workStation':
      return 'workStation';
    case 'officerSought.personnelFileNumber':
      return 'personnelFileNumber';
    case 'scope.years':
      return 'years';
    case 'scope.sections':
      return 'sections';
    default:
      return null;
  }
}

export function leaSubmitFailure(error: ServiceError<AccessProblem>): LeaSubmitFailure {
  const failure: LeaSubmitFailure = {
    title: m.sendFailed,
    fieldErrors: {},
    unmapped: [],
    signIn: false,
    newKey: false,
  };
  if (error.kind === 'unauthenticated') return { ...failure, title: m.sessionEnded, signIn: true };
  if (error.kind === 'unavailable') return failure;
  const { problem } = error;
  failure.newKey = true;
  if (problem.status === 403) return { ...failure, title: m.notAnOfficer };
  if (problem.status !== 400) return failure;
  for (const { path, message } of problem.errors ?? []) {
    const field = fieldOf(path);
    if (field) failure.fieldErrors[field] ??= FIELD_COPY[field];
    else failure.unmapped.push(path ? `${path}: ${message}` : message);
  }
  return {
    ...failure,
    title: m.rejectedTitle,
    text: problem.detail ?? m.rejectedText,
  };
}
