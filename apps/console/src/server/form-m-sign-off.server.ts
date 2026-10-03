import type { DocumentsClient } from './documents/client';
import type { components } from './reporting/api.gen';
import type { ReportingClient } from './reporting/client.server';
import type { ReportingProblem } from './reporting/types';
import { callService } from './service-call';
import type { FormMResult } from './form-m.server';

/**
 * The reporting service's Form M sign-off endpoints (spec 09 FE-2 second half, #226): the
 * supervisor's remarks and review, the commission-admin's Part I and Part B, and the confirmation
 * with a fresh step-up. Pure: the caller injects the client (`form-m.ts` makes it for the
 * signed-in officer). Each answers the result as the service gives it; the screens decide what a
 * refusal means for them.
 */

/** Remarks by obligation id, as the supervisor left them. */
export type Remarks = Readonly<Record<string, string>>;

/** `PATCH .../remarks`: the remarks given, by obligation id (a blank one returns the default). */
export function saveRemarks(
  client: ReportingClient,
  slug: string,
  fy: number,
  remarks: Remarks,
): Promise<FormMResult<null>> {
  return callService<null, ReportingProblem>(async () => {
    const outcome = await client.PATCH('/v1/commissions/{slug}/compliance-reports/{fy}/remarks', {
      params: { path: { slug, fy } },
      body: {
        remarks: Object.entries(remarks).map(([obligationId, remark]) => ({
          obligationId,
          remark,
        })),
      },
    });
    return { ...outcome, data: null };
  });
}

/** reporting.yaml `ManualFields`: Part I contact details and Part B; null clears a field. */
export type ManualFields = components['schemas']['ManualFields'];

/** `PATCH .../manual`: the fields given replace the draft's, the others are kept. */
export function saveManualFields(
  client: ReportingClient,
  slug: string,
  fy: number,
  fields: ManualFields,
): Promise<FormMResult<null>> {
  return callService<null, ReportingProblem>(async () => {
    const outcome = await client.PATCH('/v1/commissions/{slug}/compliance-reports/{fy}/manual', {
      params: { path: { slug, fy } },
      body: fields,
    });
    return { ...outcome, data: null };
  });
}

/** `POST .../reviewed`: Part III "Compiled by" names the supervisor with `designation`. */
export function markReviewed(
  client: ReportingClient,
  slug: string,
  fy: number,
  designation: string,
): Promise<FormMResult<null>> {
  return callService<null, ReportingProblem>(async () => {
    const outcome = await client.POST('/v1/commissions/{slug}/compliance-reports/{fy}/reviewed', {
      params: { path: { slug, fy } },
      body: { designation },
    });
    return { ...outcome, data: null };
  });
}

/** What became of a confirmation, as the confirm flow acts on it. */
export type ConfirmOutcome =
  /** 200: submitted with its reference, late or not; the PDF and the receipt follow. */
  | { status: 'submitted'; reference: string | null; late: boolean | null }
  /** 403 `step-up-required`: no step-up on the session, or one too old. Confirm identity again. */
  | { status: 'step-up-required' }
  /** 403 otherwise: not the commission-admin. */
  | { status: 'forbidden' }
  /** 400 `not-reviewed`: recompiled meanwhile, so it must be reviewed again. */
  | { status: 'not-reviewed' }
  /** 400 `incomplete`: the form-m.v1 paths still to fill (dotted, e.g. `partI.emailAddress`). */
  | { status: 'incomplete'; paths: readonly string[] }
  /** 409 `report-submitted`: confirmed already, maybe by someone else. */
  | { status: 'already-submitted' }
  /** 409 `report-compiling`: a recompile started meanwhile. */
  | { status: 'compiling' }
  /** The session ended. */
  | { status: 'unauthenticated' }
  /** Network, 5xx or an answer the flow cannot act on: nothing submitted; retry with the key. */
  | { status: 'unavailable' };

/**
 * `POST .../confirm` with `Idempotency-Key` (one per confirm dialog, reused on retry): the
 * commission-admin's sign-off, on the token of a fresh step-up.
 */
export async function confirmReport(
  client: ReportingClient,
  slug: string,
  fy: number,
  idempotencyKey: string,
): Promise<ConfirmOutcome> {
  const result = await callService<components['schemas']['ComplianceReport'], ReportingProblem>(
    () =>
      client.POST('/v1/commissions/{slug}/compliance-reports/{fy}/confirm', {
        params: { path: { slug, fy }, header: { 'Idempotency-Key': idempotencyKey } },
        body: {},
      }),
  );
  if (result.ok) {
    return { status: 'submitted', reference: result.data.reference, late: result.data.late };
  }
  const { error } = result;
  if (error.kind === 'unauthenticated') return { status: 'unauthenticated' };
  if (error.kind === 'unavailable') return { status: 'unavailable' };
  const { status, code, errors } = error.problem;
  if (status === 403) {
    return code === 'step-up-required' ? { status: 'step-up-required' } : { status: 'forbidden' };
  }
  if (status === 400 && code === 'not-reviewed') return { status: 'not-reviewed' };
  if (status === 400 && code === 'incomplete') {
    return { status: 'incomplete', paths: (errors ?? []).map((each) => each.path) };
  }
  if (status === 409 && code === 'report-submitted') return { status: 'already-submitted' };
  if (status === 409 && code === 'report-compiling') return { status: 'compiling' };
  return { status: 'unavailable' };
}

/** A presigned link to an issued document, valid for minutes: fetch one per download. */
export interface DocumentLink {
  downloadUrl: string;
  expiresAt: string;
}

/** `GET /v1/documents/{id}/download` on the documents service: the Form M PDF or the receipt. */
export function documentLink(
  client: DocumentsClient,
  documentId: string,
): Promise<FormMResult<DocumentLink>> {
  return callService(async () => {
    const outcome = await client.GET('/v1/documents/{documentId}/download', {
      params: { path: { documentId } },
    });
    return outcome.data
      ? {
          ...outcome,
          data: { downloadUrl: outcome.data.downloadUrl, expiresAt: outcome.data.expiresAt },
        }
      : { ...outcome, data: undefined };
  });
}
