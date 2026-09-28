import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { commissionSlug } from './commission-slug';
import { asViewer } from './as-viewer.server';
import {
  callDirectory,
  type DirectoryResult,
  type RosterApiCredential,
  type RosterApiCredentialWithSecret,
} from './directory/client';
import { env } from './env.server';
import { type RosterApiEndpoints, rosterApiEndpoints } from './roster-api-endpoints';

/** Where HR systems connect (API documentation): configuration only, nothing secret. */
export const getRosterApiEndpoints = createServerFn({ method: 'GET' }).handler(
  (): RosterApiEndpoints => rosterApiEndpoints(env()),
);

/** The viewer's own Commission: roster routes carry no slug, the session's tenant names it. */
const commissionInput = z.object({ slug: commissionSlug });

/**
 * `GET /v1/commissions/{slug}/roster/api-credential`: the HR-system credential's metadata (never
 * the secret), or null when none was ever created. A revoked credential stays, with `revokedAt`.
 */
export const getRosterApiCredential = createServerFn({ method: 'GET' })
  .validator(commissionInput)
  .handler(({ data }): Promise<DirectoryResult<RosterApiCredential | null>> =>
    asViewer((client) =>
      callDirectory(() =>
        client.GET('/v1/commissions/{slug}/roster/api-credential', {
          params: { path: { slug: data.slug } },
        }),
      ),
    ),
  );

/**
 * `POST /v1/commissions/{slug}/roster/api-credential`: creates the credential and answers with
 * its secret, the only time anyone sees it. 409 when one already exists (rotate or revoke it).
 * The secret passes through this server function to the browser and is kept nowhere.
 */
export const createRosterApiCredential = createServerFn({ method: 'POST' })
  .validator(commissionInput)
  .handler(({ data }): Promise<DirectoryResult<RosterApiCredentialWithSecret>> =>
    asViewer((client) =>
      callDirectory(() =>
        client.POST('/v1/commissions/{slug}/roster/api-credential', {
          params: { path: { slug: data.slug } },
        }),
      ),
    ),
  );

/**
 * `POST /v1/commissions/{slug}/roster/api-credential/rotate`: a new secret, shown once; the
 * previous one stops working immediately.
 */
export const rotateRosterApiCredential = createServerFn({ method: 'POST' })
  .validator(commissionInput)
  .handler(({ data }): Promise<DirectoryResult<RosterApiCredentialWithSecret>> =>
    asViewer((client) =>
      callDirectory(() =>
        client.POST('/v1/commissions/{slug}/roster/api-credential/rotate', {
          params: { path: { slug: data.slug } },
        }),
      ),
    ),
  );

/**
 * `DELETE /v1/commissions/{slug}/roster/api-credential`: revokes the credential (204, no body);
 * the HR system loses access immediately.
 */
export const revokeRosterApiCredential = createServerFn({ method: 'POST' })
  .validator(commissionInput)
  .handler(({ data }): Promise<DirectoryResult<null>> =>
    asViewer(async (client) => {
      const result = await callDirectory(() =>
        client.DELETE('/v1/commissions/{slug}/roster/api-credential', {
          params: { path: { slug: data.slug } },
          // 204 has no body; read it as text so an empty response is never parsed as JSON.
          parseAs: 'text',
        }),
      );
      return result.ok ? { ok: true, data: null } : result;
    }),
  );
