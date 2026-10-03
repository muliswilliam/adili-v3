import type { components, paths } from './review/api.gen';
import type { ReviewClient } from './review/client.server';
import { callService, type ServiceResult } from './service-call';

/**
 * The review service's enforcement ladder endpoints for the Commission's review staff (spec 08
 * FE-5, S5 to S11), folded into results the Actions screens switch on. Pure: the caller injects
 * the client (`actions.ts` makes it for the signed-in reviewer or supervisor).
 */

type Schemas = components['schemas'];
export type Ladder = Schemas['Ladder'];
export type AdministrativeAction = Schemas['AdministrativeAction'];
export type ActionStep = Schemas['ActionStep'];
export type ActionStatus = Schemas['ActionStatus'];

/** Which ladders: the current step's status and step, and the page. */
export type LadderQuery = NonNullable<
  paths['/v1/commissions/{slug}/actions']['get']['parameters']['query']
>;

export interface LadderPage {
  items: Ladder[];
  nextCursor: string | null;
}

/** `GET /v1/commissions/{slug}/actions`: the Commission's ladders, newest first. */
export function loadLadders(
  client: ReviewClient,
  slug: string,
  query: LadderQuery,
): Promise<ServiceResult<LadderPage>> {
  return callService(() =>
    client.GET('/v1/commissions/{slug}/actions', { params: { path: { slug }, query } }),
  );
}

/** `GET /v1/review/ladders/{ladderId}`: a ladder with every step, response and acknowledgement. */
export function loadLadder(client: ReviewClient, ladderId: string): Promise<ServiceResult<Ladder>> {
  return callService(() =>
    client.GET('/v1/review/ladders/{ladderId}', { params: { path: { ladderId } } }),
  );
}

/**
 * `POST .../actions/{id}/approve`: the ADM number in the approver's name; the letter and the
 * declarant's notification follow. The key belongs to the dialog, so a retry does not act twice.
 */
export function approveStep(
  client: ReviewClient,
  actionId: string,
  idempotencyKey: string,
): Promise<ServiceResult<AdministrativeAction>> {
  return callService(() =>
    client.POST('/v1/review/actions/{actionId}/approve', {
      params: { path: { actionId }, header: { 'Idempotency-Key': idempotencyKey } },
    }),
  );
}

/** `POST .../actions/{id}/decline` with the note: the ladder ends (a supervisor may restart it). */
export function declineStep(
  client: ReviewClient,
  actionId: string,
  reason: string,
  idempotencyKey: string,
): Promise<ServiceResult<AdministrativeAction>> {
  return callService(() =>
    client.POST('/v1/review/actions/{actionId}/decline', {
      params: { path: { actionId }, header: { 'Idempotency-Key': idempotencyKey } },
      body: { reason },
    }),
  );
}

/** `POST .../ladders/{id}/restart` (supervisor): the declined step is drafted again. */
export function restartLadder(
  client: ReviewClient,
  ladderId: string,
  idempotencyKey: string,
): Promise<ServiceResult<Ladder>> {
  return callService(() =>
    client.POST('/v1/review/ladders/{ladderId}/restart', {
      params: { path: { ladderId }, header: { 'Idempotency-Key': idempotencyKey } },
    }),
  );
}
