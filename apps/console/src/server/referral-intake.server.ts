import type { DocumentsClient } from './documents/client';
import type { ReportingClient } from './reporting/client.server';
import type {
  IcmsPushError,
  IcmsStatus,
  ReferralIntakeItem,
  ReferralIntakePage,
} from './reporting/types';
import { callService, type ServiceError, type ServiceResult } from './service-call';

/**
 * The reporting service's EACC referrals intake (spec 09 S12): the referrals Commissions sent,
 * pushing one to ICMS, and the download of its Confidential evidence package from the documents
 * service. Pure: the caller injects the clients (see `referral-intake.ts` for the server
 * functions).
 */

export interface ReferralIntakeQuery {
  icmsStatus?: IcmsStatus;
  cursor?: string;
  limit?: number;
}

/** `GET /v1/eacc/referrals`: the latest sent first, of one ICMS status or all. */
export function listReferralIntake(
  client: ReportingClient,
  query: ReferralIntakeQuery,
): Promise<ServiceResult<ReferralIntakePage>> {
  return callService(() =>
    client.GET('/v1/eacc/referrals', {
      params: {
        query: {
          ...(query.icmsStatus ? { icmsStatus: query.icmsStatus } : {}),
          ...(query.cursor ? { cursor: query.cursor } : {}),
          ...(query.limit ? { limit: query.limit } : {}),
        },
      },
    }),
  );
}

/**
 * A push's answer: the referral as it stands (registered, or pushed and waiting for its case
 * number); `pushFailed` with why when reporting left it push-failed (502 `icms-push-failed`),
 * pushed again to retry; or any other failure.
 */
export type PushResult =
  | { ok: true; data: ReferralIntakeItem }
  | { ok: false; pushFailed: IcmsPushError }
  | { ok: false; pushFailed: null; error: ServiceError };

/** Every `IcmsPushError`, checked against the generated union both ways. */
const PUSH_ERRORS = {
  'review-unavailable': true,
  'payload-not-found': true,
  'payload-refused': true,
  'icms-unavailable': true,
  'icms-rejected': true,
  'icms-failed': true,
  'icms-registration-timeout': true,
} as const satisfies Record<IcmsPushError, true>;

function isPushError(value: unknown): value is IcmsPushError {
  return typeof value === 'string' && Object.hasOwn(PUSH_ERRORS, value);
}

/** Why reporting left the referral push-failed, from a 502 `icms-push-failed`; else null. */
function pushFailedError(response: Response, body: unknown): IcmsPushError | null {
  if (response.status !== 502 || typeof body !== 'object' || body === null) return null;
  const { code, error } = body as { code?: unknown; error?: unknown };
  return code === 'icms-push-failed' && isPushError(error) ? error : null;
}

/**
 * `POST /v1/eacc/referrals/{referralId}/push`: reporting pulls the referral's ICMS payload from
 * review and registers it through the integration-gateway, idempotent by the RFL reference.
 * `idempotencyKey` is one per confirmation, reused on retry of the same request.
 */
export async function pushToIcms(
  client: ReportingClient,
  referralId: string,
  idempotencyKey: string,
): Promise<PushResult> {
  // `callService` folds a 5xx into `unavailable` without its body, so the coded 502 is read on the way.
  const seen: { pushFailed: IcmsPushError | null } = { pushFailed: null };
  const result = await callService(async () => {
    const outcome = await client.POST('/v1/eacc/referrals/{referralId}/push', {
      params: { path: { referralId }, header: { 'Idempotency-Key': idempotencyKey } },
    });
    seen.pushFailed = pushFailedError(outcome.response, outcome.error);
    return outcome;
  });
  if (seen.pushFailed) return { ok: false, pushFailed: seen.pushFailed };
  return result.ok ? result : { ok: false, pushFailed: null, error: result.error };
}

/**
 * A short-lived link to a referral's Confidential evidence package: the documents service hands
 * it out as the signed-in EACC analyst or supervisor and records the download against them.
 */
export async function intakePackageLink(
  documents: DocumentsClient,
  packageDocumentId: string,
): Promise<ServiceResult<{ downloadUrl: string }>> {
  const link = await callService(() =>
    documents.GET('/v1/documents/{documentId}/download', {
      params: { path: { documentId: packageDocumentId } },
    }),
  );
  return link.ok ? { ok: true, data: { downloadUrl: link.data.downloadUrl } } : link;
}
