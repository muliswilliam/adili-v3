import type { ServiceError } from '../../../server/service-call';
import type { AccessProblem } from '../../../server/access/types';
import type { SelfAccessApplication } from '../../../server/self-access.server';
import { messages as m } from './messages';

/**
 * Where a written self-access application stands, as the Certified copies screens show it: its
 * certified copy being prepared (or failed), ready to hand over, or collected or dispatched.
 * The application is recorded and its copy ordered in one step, so there is no "to issue".
 */
export type ApplicationState = 'preparing' | 'failed' | 'ready' | 'collected' | 'dispatched';

type Tone = 'default' | 'info' | 'brand' | 'success' | 'warning' | 'destructive';

export function applicationState(
  application: Pick<SelfAccessApplication, 'status' | 'deliveryMethod' | 'certifiedCopy'>,
): ApplicationState {
  if (application.status === 'delivered') {
    return application.deliveryMethod === 'collection' ? 'collected' : 'dispatched';
  }
  if (application.status === 'issued' || application.certifiedCopy.status === 'issued') {
    return 'ready';
  }
  return application.certifiedCopy.status === 'failed' ? 'failed' : 'preparing';
}

export const STATE_TONE: Record<ApplicationState, Tone> = {
  preparing: 'info',
  failed: 'destructive',
  ready: 'brand',
  collected: 'success',
  dispatched: 'success',
};

/** Still waiting on the copy (not issued): the 14-day deadline runs. */
export function deadlineRuns(state: ApplicationState): boolean {
  return state === 'preparing' || state === 'failed';
}

/** The document the officer checked: what they confirm against the roster record. */
export const IDENTITY_DOCUMENTS = ['national-id', 'passport', 'service-card'] as const;
export type IdentityDocument = (typeof IDENTITY_DOCUMENTS)[number];

export type Applicant = 'declarant' | 'representative';

/** The longest note the officer may add to the identity check. */
export const NOTE_MAX = 500;

/**
 * The identity check as the application records it (`identityNote`): which document was seen and
 * that it matched the roster record, then the officer's note. No document numbers: the service
 * keeps only the representative's, encrypted.
 */
export function identityNoteOf(check: {
  applicant: Applicant;
  document: IdentityDocument;
  note: string;
}): string {
  const document = m.documents[check.document];
  const checked =
    check.applicant === 'declarant'
      ? `${document} seen. It matches the roster record.`
      : `The declarant's ${document} on the written authority matches the roster record. The representative's ID was checked against them.`;
  const note = check.note.trim();
  return note ? `${checked} ${note}` : checked;
}

/** A field the server named at fault, mapped to the form's field and a message. */
export interface RecordFailure {
  message: string;
  /** The form field to mark, when the server named one. */
  field?: 'declarant' | 'version' | 'authority' | 'identification';
  signIn: boolean;
}

/** How recording an application failed, in the officer's words. */
export function recordFailure(error: ServiceError<AccessProblem>): RecordFailure {
  if (error.kind === 'unauthenticated') return { message: m.sessionEnded, signIn: true };
  if (error.kind === 'unavailable') {
    return {
      message: (error.problemType && m.unavailable[error.problemType]) ?? m.saveFailed,
      signIn: false,
    };
  }
  const { problem } = error;
  if (problem.status === 403) return { message: m.supervisorCannotAct, signIn: false };
  const paths = problem.errors?.map((each) => each.path) ?? [];
  if (paths.includes('rosterRecordId')) {
    return { message: m.notOnboardedProblem, field: 'declarant', signIn: false };
  }
  if (paths.includes('version') || paths.includes('declarationId')) {
    return { message: m.versionProblem, field: 'version', signIn: false };
  }
  if (paths.includes('representative.authorityUploadId')) {
    return { message: m.proofProblem, field: 'authority', signIn: false };
  }
  if (paths.includes('representative.idUploadId')) {
    return { message: m.proofProblem, field: 'identification', signIn: false };
  }
  return { message: m.saveFailed, signIn: false };
}

/** `2026` for a biennial declaration (its statement date's year); none for the others. */
export function declarationYear(type: string, statementDate: string): string {
  return type === 'biennial' ? statementDate.slice(0, 4) : '';
}
