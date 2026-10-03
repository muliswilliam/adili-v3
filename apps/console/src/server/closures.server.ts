import type { components, paths } from './review/api.gen';
import type { ReviewClient } from './review/client.server';
import { callService, type ServiceResult } from './service-call';

/**
 * The review service's bulk closure endpoints (spec 08 FE-4, S3 and S4), folded into results the
 * bulk closure screen switches on. Supervisors only: the service answers 403
 * `supervisor-required` to the Commission's reviewers. Pure: the caller injects the client
 * (`closures.ts` makes it for the signed-in supervisor).
 */

type Schemas = components['schemas'];
export type ClosureSummary = Schemas['ClosureSummary'];
export type BulkApprovalResult = Schemas['BulkApprovalResult'];
export type DeclarationType = Schemas['DeclarationType'];

/** Which system proposals: a cycle, and optionally a declaration type and reporting entity. */
export type ClosureFilter = paths['/v1/commissions/{slug}/closures']['get']['parameters']['query'];

/** `GET .../closures`: proposals waiting, sampled and approved for the filters, and the sweep. */
export function loadClosureSummary(
  client: ReviewClient,
  slug: string,
  filter: ClosureFilter,
): Promise<ServiceResult<ClosureSummary>> {
  return callService(() =>
    client.GET('/v1/commissions/{slug}/closures', {
      params: { path: { slug }, query: filter },
    }),
  );
}

/**
 * `POST .../closures`: approves every waiting proposal the filters match, in chunks of 100, each
 * allocating its CMP numbers in the supervisor's name. Sent again with the same key after a
 * failure it resumes, and the result counts every closure approved under the key.
 */
export function approveClosures(
  client: ReviewClient,
  slug: string,
  filter: ClosureFilter,
  idempotencyKey: string,
): Promise<ServiceResult<BulkApprovalResult>> {
  return callService(() =>
    client.POST('/v1/commissions/{slug}/closures', {
      params: { path: { slug }, query: filter, header: { 'Idempotency-Key': idempotencyKey } },
    }),
  );
}
