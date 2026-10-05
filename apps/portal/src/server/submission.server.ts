import { z } from 'zod';

import type { DeclarationsClient } from './declarations/client.server';
import type {
  Acknowledgement,
  CompletenessIssue,
  Declaration,
  DeclarationVersion,
  SubmissionResult,
  SubmitProblem,
} from './declarations/types';
import type { DocumentsClient } from './documents/client.server';
import { attempt, type NotFound, notFound, type Unavailable, unavailable } from './results';

/**
 * The declarations service's spec 06 submission endpoints, reduced to discriminated results the
 * summary's submit flow and the success page branch on. Pure: the caller injects the client
 * (see `submission.ts` for the server functions that call these as the signed-in declarant).
 */

/**
 * The 409 refusals of `SubmitProblem`: the declaration or its obligation does not take the
 * submission now. Its other codes have their own outcomes (or, `not-submitted`, are not a submit's).
 */
export type SubmitConflict = Exclude<
  NonNullable<SubmitProblem['code']>,
  'step-up-required' | 'incomplete' | 'not-submitted'
>;

/** The refusals, checked against the generated contract: a code it adds fails typecheck here. */
const SUBMIT_CONFLICTS = {
  'before-statement-date': true,
  'amendment-window-closed': true,
  'not-a-draft': true,
  'obligation-cancelled': true,
} as const satisfies Record<SubmitConflict, true>;

function isSubmitConflict(code: string | undefined): code is SubmitConflict {
  return code !== undefined && Object.hasOwn(SUBMIT_CONFLICTS, code);
}

export type SubmitOutcome =
  | { status: 'submitted'; result: SubmissionResult }
  /** 403: the token lacks a fresh step-up; confirm identity again. */
  | { status: 'step-up-required' }
  /** 400 with blocking issues: the document does not validate. */
  | { status: 'incomplete'; blocking: CompletenessIssue[] }
  | { status: 'conflict'; code: SubmitConflict }
  | NotFound
  /** Network, 5xx, or an answer the flow cannot act on: retry with the same key. */
  | Unavailable;

export interface SubmitInput {
  declarationId: string;
  /** One per affirmation dialog; reuse it when retrying, so a replay files once. */
  idempotencyKey: string;
}

/** `POST /v1/declarations/{id}/submit` with `Idempotency-Key`: the legal act. */
export function submitDeclaration(
  client: DeclarationsClient,
  input: SubmitInput,
): Promise<SubmitOutcome> {
  return attempt(async () => {
    const { data, error, response } = await client.POST('/v1/declarations/{declarationId}/submit', {
      params: {
        path: { declarationId: input.declarationId },
        header: { 'Idempotency-Key': input.idempotencyKey },
      },
    });
    if (data) return { status: 'submitted', result: data };
    if (response.status === 403 && error.code === 'step-up-required') {
      return { status: 'step-up-required' };
    }
    if (response.status === 400 && error.code === 'incomplete' && 'blocking' in error) {
      return { status: 'incomplete', blocking: error.blocking ?? [] };
    }
    if (response.status === 409 && isSubmitConflict(error.code)) {
      return { status: 'conflict', code: error.code };
    }
    return response.status === 404 ? notFound : unavailable;
  });
}

export type SubmissionLoad =
  | {
      status: 'ok';
      declaration: Declaration;
      version: DeclarationVersion;
      /** Every submitted version's reference, newest first: its clarifications name one. */
      references: string[];
    }
  /** The declaration has no submitted version (still a draft, or discarded). */
  | { status: 'not-submitted' }
  | NotFound
  | Unavailable;

/**
 * The declaration and its newest submitted version, for the success page: `GET
 * /v1/declarations/{id}` and `GET /v1/declarations/{id}/versions` (newest first).
 */
export function loadSubmission(
  client: DeclarationsClient,
  declarationId: string,
): Promise<SubmissionLoad> {
  return attempt(async () => {
    const path = { params: { path: { declarationId } } };
    const [declaration, versions] = await Promise.all([
      client.GET('/v1/declarations/{declarationId}', path),
      client.GET('/v1/declarations/{declarationId}/versions', path),
    ]);
    if (declaration.response.status === 404) return notFound;
    if (!declaration.data) return unavailable;
    if (versions.response.status === 404) return { status: 'not-submitted' };
    if (!versions.data) return unavailable;
    const [latest] = versions.data;
    if (!latest) return { status: 'not-submitted' };
    return {
      status: 'ok',
      declaration: declaration.data,
      version: latest,
      references: versions.data.map((each) => each.reference),
    };
  });
}

export interface VersionRef {
  declarationId: string;
  version: number;
}

export type AcknowledgementRead =
  { status: 'ok'; acknowledgement: Acknowledgement } | NotFound | Unavailable;

/**
 * `GET /v1/declarations/{id}/versions/{n}/acknowledgement`: the slip's status, and once issued
 * its document, verification code and verify link. The slip downloads from the documents
 * service (`readSlipDownload`).
 */
export function readAcknowledgement(
  client: DeclarationsClient,
  { declarationId, version }: VersionRef,
): Promise<AcknowledgementRead> {
  return attempt(async () => {
    const { data, response } = await client.GET(
      '/v1/declarations/{declarationId}/versions/{version}/acknowledgement',
      { params: { path: { declarationId, version } } },
    );
    if (data) return { status: 'ok', acknowledgement: data };
    return response.status === 404 ? notFound : unavailable;
  });
}

export type ReissueOutcome =
  /** 202: issuance starts over; the slip is pending again. */
  | { status: 'requested' }
  /** 409 `acknowledgement-issued` or `acknowledgement-in-progress`: the next read says which. */
  | { status: 'in-progress' }
  /** 429 `resend-cooldown`: asked again a moment ago; ask after `retryAfterSeconds`, if it said. */
  | { status: 'cooldown'; retryAfterSeconds: number | null }
  | NotFound
  | Unavailable;

/** The `resend-cooldown` problem's extension (not in the generated `ProblemDetails`). */
const cooldownProblem = z.object({ retryAfterSeconds: z.number().int().positive() });

function retryAfterSeconds(problem: unknown): number | null {
  const parsed = cooldownProblem.safeParse(problem);
  return parsed.success ? parsed.data.retryAfterSeconds : null;
}

/** `POST /v1/declarations/{id}/versions/{n}/acknowledgement/reissue`, when issuance failed. */
export function reissueAcknowledgement(
  client: DeclarationsClient,
  { declarationId, version }: VersionRef,
): Promise<ReissueOutcome> {
  return attempt(async () => {
    const { error, response } = await client.POST(
      '/v1/declarations/{declarationId}/versions/{version}/acknowledgement/reissue',
      { params: { path: { declarationId, version } } },
    );
    switch (response.status) {
      case 202:
        return { status: 'requested' };
      case 409:
        return { status: 'in-progress' };
      case 429:
        return { status: 'cooldown', retryAfterSeconds: retryAfterSeconds(error) };
      case 404:
        return notFound;
      default:
        return unavailable;
    }
  });
}

export type SlipDownload = { status: 'ok'; downloadUrl: string } | NotFound | Unavailable;

/**
 * `GET /v1/documents/{id}/download` on the documents service: a presigned link to the issued
 * slip, valid for minutes, so fetch one for each download.
 */
export function readSlipDownload(
  client: DocumentsClient,
  documentId: string,
): Promise<SlipDownload> {
  return attempt(async () => {
    const { data, response } = await client.GET('/v1/documents/{documentId}/download', {
      params: { path: { documentId } },
    });
    if (data) return { status: 'ok', downloadUrl: data.downloadUrl };
    return response.status === 404 ? notFound : unavailable;
  });
}
