import { getRequest } from '@tanstack/react-start/server';

import { getBff } from '../bff.server';
import type { ServiceResult } from '../service-call';
import { reviewClient, type ReviewClient } from './client.server';

/**
 * Runs `work` with a review client acting as the signed-in reviewer or supervisor (their token
 * stays on the server), or answers `signedOut()` without a session.
 */
export async function withReviewClient<R>(
  work: (client: ReviewClient, user: { subject: string; name: string }) => Promise<R>,
  signedOut: () => R,
): Promise<R> {
  const session = await getBff().getSession(getRequest());
  if (!session) return signedOut();
  return work(reviewClient(session.accessToken), session.user);
}

/** `withReviewClient` for a service call: unauthenticated without a session. */
export function asStaffMember<T>(
  work: (
    client: ReviewClient,
    user: { subject: string; name: string },
  ) => Promise<ServiceResult<T>>,
): Promise<ServiceResult<T>> {
  return withReviewClient(work, () => ({ ok: false, error: { kind: 'unauthenticated' } }));
}
