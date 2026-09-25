import { z } from 'zod';

import type { ProblemDetails } from './types';

/** Why a directory call failed, in the terms the screens branch on. */
export type DirectoryFailure =
  | { kind: 'unauthenticated' }
  | { kind: 'forbidden'; problem: ProblemDetails | null }
  | { kind: 'not-found'; problem: ProblemDetails | null }
  | { kind: 'conflict'; problem: ProblemDetails | null }
  | { kind: 'invalid'; problem: ProblemDetails | null }
  | { kind: 'unavailable'; problem: ProblemDetails | null };

export type DirectoryResult<T> = { ok: true; data: T } | { ok: false; failure: DirectoryFailure };

const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});

/** Maps a non-2xx directory response to a failure, keeping the problem body when it is one. */
export function toFailure(status: number, body: unknown): DirectoryFailure {
  const parsed = problemSchema.safeParse(body);
  const problem = parsed.success ? parsed.data : null;
  switch (status) {
    case 401:
      return { kind: 'unauthenticated' };
    case 403:
      return { kind: 'forbidden', problem };
    case 404:
      return { kind: 'not-found', problem };
    case 409:
      return { kind: 'conflict', problem };
    case 400:
    case 422:
      return { kind: 'invalid', problem };
    default:
      return { kind: 'unavailable', problem };
  }
}

/** Runs one generated-client call, turning transport errors and problem responses into a result. */
export async function callDirectory<T>(
  request: () => Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<DirectoryResult<T>> {
  try {
    const { data, error, response } = await request();
    if (response.ok && data !== undefined) return { ok: true, data };
    return { ok: false, failure: toFailure(response.status, error) };
  } catch {
    return { ok: false, failure: { kind: 'unavailable', problem: null } };
  }
}
