import { getRequest } from '@tanstack/react-start/server';

import { getBff } from '../bff.server';
import type { ServiceResult } from '../service-call';
import { reviewClient, type ReviewClient } from './client.server';

/**
 * Runs `work` with a review client acting as the signed-in reviewer or supervisor (their token
 * stays on the server), or answers unauthenticated without a session.
 */
export async function asOfficer<T>(
  work: (
    client: ReviewClient,
    user: { subject: string; name: string },
  ) => Promise<ServiceResult<T>>,
): Promise<ServiceResult<T>> {
  const session = await getBff().getSession(getRequest());
  if (!session) return { ok: false, error: { kind: 'unauthenticated' } };
  return work(reviewClient(session.accessToken), session.user);
}
