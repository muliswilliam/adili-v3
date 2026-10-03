import {
  type AccountParticulars,
  type CheckedDraft,
  draftFrom,
  type FormKDraft,
  type FormKStep,
  placeServerErrors,
  type StepErrors,
  toFormK,
} from '../access/form-k';
import type { AccessClient, SubjectDocumentsClient } from './access/client.server';
import {
  type AccessCommission,
  type AccessRequest,
  type AccessRequestStatus,
  type Decision,
  type Package,
  readAccessRequest,
} from './access/types';
import type { DirectoryClient } from './directory/client.server';
import { attempt, type NotFound, notFound, type Unavailable, unavailable } from './results';

/**
 * The access service's applicant endpoints (spec 10: Form K, My requests, withdraw) and the
 * directory's `GET /v1/me/applicant`, reduced to discriminated results the pages branch on.
 * Pure: the caller injects the clients (`access-requests.ts` calls these as the signed-in
 * applicant).
 */

/** The account has no applicant record (403 or 404): it cannot file or follow Form K. */
export interface NotApplicant {
  status: 'not-applicant';
}

export const notApplicant: NotApplicant = { status: 'not-applicant' };

/** The signed-in applicant's particulars, as their account holds them (`ApplicantProfile`). */
export interface Applicant {
  name: string;
  identityDocument: AccountParticulars['identityDocument'];
  /** `pending-verification` for a passport no Commission has checked yet. */
  identityStatus: 'verified' | 'pending-verification';
  /** E.164, or null when the account has none (onboarding requires both). */
  telephone: string | null;
  email: string | null;
}

export type ApplicantResult = { status: 'ok'; applicant: Applicant } | NotApplicant | Unavailable;

/** `GET /v1/me/applicant` (directory): who is filing, to pre-fill Part I. */
export function loadApplicant(directory: DirectoryClient): Promise<ApplicantResult> {
  return attempt(async () => {
    const { data, response } = await directory.GET('/v1/me/applicant');
    if (data) {
      return {
        status: 'ok',
        applicant: {
          name: data.fullName,
          identityDocument: data.identityDocument,
          identityStatus: data.identityStatus,
          telephone: data.contacts.phone,
          email: data.contacts.email,
        },
      };
    }
    return response.status === 403 || response.status === 404 ? notApplicant : unavailable;
  });
}

export type NewRequestResult =
  | {
      status: 'ok';
      applicant: Applicant;
      commissions: AccessCommission[];
      /** The draft to start from, when making a new request from an earlier one's details. */
      draft: FormKDraft | null;
    }
  | NotApplicant
  | Unavailable;

/**
 * What the wizard opens with: the applicant's particulars, the Commissions to address and,
 * with `fromId`, the details of that earlier request to start from (none if it is not theirs).
 */
export async function loadNewRequest(
  directory: DirectoryClient,
  access: AccessClient,
  fromId?: string,
): Promise<NewRequestResult> {
  const [applicant, commissions, from] = await Promise.all([
    loadApplicant(directory),
    attempt(async () => {
      const { data } = await access.GET('/v1/access/commissions');
      return data ? { status: 'ok' as const, commissions: data } : unavailable;
    }),
    fromId ? loadRequest(access, fromId) : null,
  ]);
  if (applicant.status !== 'ok') return applicant;
  if (commissions.status !== 'ok') return commissions;
  return {
    status: 'ok',
    applicant: applicant.applicant,
    commissions: [...commissions.commissions].sort((a, b) => a.name.localeCompare(b.name)),
    draft: from?.status === 'ok' ? draftFrom(from.request.formK) : null,
  };
}

export type SubmitResult =
  | {
      status: 'submitted';
      id: string;
      reference: string;
    }
  /** 400: the service refused fields, placed on their steps with the wizard's own copy. */
  | { status: 'invalid'; steps: FormKStep[]; errors: StepErrors }
  | NotApplicant
  | Unavailable;

function problemPaths(error: unknown): string[] {
  const errors = (error as { errors?: unknown } | undefined)?.errors;
  if (!Array.isArray(errors)) return [];
  return errors.flatMap((entry) =>
    typeof (entry as { path?: unknown }).path === 'string'
      ? [(entry as { path: string }).path]
      : [],
  );
}

/**
 * Files Form K: Part I's name, identity document, telephone and email come from the account
 * (`GET /v1/me/applicant`), the rest from the checked draft; then `POST /v1/access/requests`
 * once, with the wizard's idempotency key so a retry after a lost answer replays the first
 * receipt instead of filing twice.
 */
export async function submitRequest(
  directory: DirectoryClient,
  access: AccessClient,
  draft: CheckedDraft,
  idempotencyKey: string,
  now: Date,
): Promise<SubmitResult> {
  const applicant = await loadApplicant(directory);
  if (applicant.status !== 'ok') return applicant;
  const { name, identityDocument, telephone, email } = applicant.applicant;
  if (telephone === null || email === null) {
    // Onboarding requires both; an account without them cannot file Part I.
    return { status: 'invalid', steps: ['particulars'], errors: {} };
  }
  const document = toFormK(draft, { name, identityDocument, telephone, email }, now);
  return attempt(async () => {
    const { data, error, response } = await access.POST('/v1/access/requests', {
      params: { header: { 'Idempotency-Key': idempotencyKey } },
      // The contract types the body loosely (`FormK`); it is a form-k.v1 document.
      body: document as unknown as Record<string, unknown>,
    });
    if (data) return { status: 'submitted', id: data.id, reference: data.reference };
    switch (response.status) {
      case 400: {
        const placed = placeServerErrors(problemPaths(error));
        return {
          status: 'invalid',
          steps: placed.steps.length > 0 ? placed.steps : ['declare'],
          errors: placed.errors,
        };
      }
      case 403:
        return notApplicant;
      default:
        return unavailable;
    }
  });
}

/** One row of My requests. */
export interface RequestSummary {
  id: string;
  reference: string;
  commission: { slug: string; name: string };
  status: AccessRequestStatus;
  officerName: string;
  submittedAt: string;
  decisionDeadlineAt: string;
  /** When it was decided, withdrawn or closed; null while open. */
  closedAt: string | null;
  /** When the granted package's (or nil letter's) download window ends; null without one. */
  downloadExpiresAt: string | null;
  /** The issued package (or nil letter) the applicant downloads from documents; null without. */
  packageDocumentId: string | null;
  /** What was issued: the package or the nil letter; null without one. */
  packageKind: Package['kind'] | null;
  /** When issuing the package failed; null while it is prepared and once issued. */
  packageFailedAt: string | null;
  /** The decision's grounds and reasons, once decided. */
  decision: Pick<Decision, 'grounds' | 'reasons'> | null;
}

const CLOSING_KINDS = new Set(['decided', 'withdrawn', 'cannot-identify']);

/** When the request was decided, withdrawn or closed, from its timeline; null while open. */
export function closedAt(request: AccessRequest): string | null {
  if (request.decision) return request.decision.decidedAt;
  const closing = request.timeline.filter((entry) => CLOSING_KINDS.has(entry.kind)).at(-1);
  return closing?.at ?? null;
}

/** A request as a row of My requests. */
export function toSummary(request: AccessRequest): RequestSummary {
  return {
    id: request.id,
    reference: request.reference,
    commission: request.commission,
    status: request.status,
    officerName: request.formK.partII.name,
    submittedAt: request.submittedAt,
    decisionDeadlineAt: request.decisionDeadlineAt,
    closedAt: closedAt(request),
    downloadExpiresAt: request.package?.downloadExpiresAt ?? null,
    packageDocumentId: request.package?.documentId ?? null,
    packageKind: request.package?.kind ?? null,
    packageFailedAt: request.package ? null : request.packageFailedAt,
    decision: request.decision
      ? { grounds: request.decision.grounds, reasons: request.decision.reasons }
      : null,
  };
}

export type RequestListResult =
  { status: 'ok'; requests: RequestSummary[] } | NotApplicant | Unavailable;

/** `GET /v1/access/requests`: the applicant's requests, latest first. */
export function listRequests(access: AccessClient): Promise<RequestListResult> {
  return attempt(async () => {
    const { data, response } = await access.GET('/v1/access/requests');
    if (data) {
      return { status: 'ok', requests: data.map((each) => toSummary(readAccessRequest(each))) };
    }
    return response.status === 403 ? notApplicant : unavailable;
  });
}

export type RequestResult =
  { status: 'ok'; request: AccessRequest } | NotFound | NotApplicant | Unavailable;

/** `GET /v1/access/requests/{id}`: one of the applicant's requests. */
export function loadRequest(access: AccessClient, id: string): Promise<RequestResult> {
  return attempt(async () => {
    const { data, response } = await access.GET('/v1/access/requests/{requestId}', {
      params: { path: { requestId: id } },
    });
    if (data) return { status: 'ok', request: readAccessRequest(data) };
    if (response.status === 404) return notFound;
    return response.status === 403 ? notApplicant : unavailable;
  });
}

export type WithdrawResult =
  | { status: 'withdrawn'; request: AccessRequest }
  /** 409: decided (a decision is final) or closed (withdrawn already, officer not identified). */
  | { status: 'conflict'; reason: 'decided' | 'closed' }
  | NotFound
  | NotApplicant
  | Unavailable;

/** `POST /v1/access/requests/{id}/withdraw`, once per confirmation. */
export function withdrawRequest(
  access: AccessClient,
  id: string,
  idempotencyKey: string,
): Promise<WithdrawResult> {
  return attempt(async () => {
    const { data, error, response } = await access.POST(
      '/v1/access/requests/{requestId}/withdraw',
      { params: { path: { requestId: id }, header: { 'Idempotency-Key': idempotencyKey } } },
    );
    if (data) return { status: 'withdrawn', request: readAccessRequest(data) };
    switch (response.status) {
      case 404:
        return notFound;
      case 403:
        return notApplicant;
      case 409:
        return {
          status: 'conflict',
          reason:
            (error as { code?: unknown } | undefined)?.code === 'request-closed'
              ? 'closed'
              : 'decided',
        };
      default:
        return unavailable;
    }
  });
}

export type PackageDownloadResult =
  | { status: 'ok'; downloadUrl: string }
  /** 410: the package's download window has closed. */
  | { status: 'window-closed' }
  | NotFound
  | Unavailable;

/**
 * `GET /v1/documents/{id}/download` on the documents service, as the applicant: a presigned
 * link to their access package, valid for minutes, so fetch one for each download. Documents
 * registers each link it hands out, and refuses one once the window has closed.
 */
export function readPackageDownload(
  documents: SubjectDocumentsClient,
  documentId: string,
): Promise<PackageDownloadResult> {
  return attempt(async () => {
    const { data, response } = await documents.GET('/v1/documents/{documentId}/download', {
      params: { path: { documentId } },
    });
    if (data) return { status: 'ok', downloadUrl: data.downloadUrl };
    if (response.status === 410) return { status: 'window-closed' };
    return response.status === 404 ? notFound : unavailable;
  });
}
