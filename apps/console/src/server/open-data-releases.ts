import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { withViewerClient } from './as-viewer.server';
import { env } from './env.server';
import { financialYear } from './form-m';
import { WITHDRAW_REASON_MAX } from './open-data-limits';
import {
  buildOpenDataRelease,
  buildOpenDataSnapshot,
  listOpenDataReleases,
  loadOpenDataRelease,
  publishOpenDataRelease,
  withdrawOpenDataRelease,
  type OpenDataReleaseView,
  type ReleasesResult,
} from './open-data-releases.server';
import { reportingClient } from './reporting/client.server';
import type { OpenDataRelease } from './reporting/types';

/**
 * Server functions for EACC's open-data releases (spec 09b FE-3, #350, #353), called as the
 * signed-in EACC analyst or supervisor. The reporting service checks the roles; tokens stay on the server.
 */

/** Where the console links to the public side: the portal's page and the manifest's verify page. */
export interface PublicLinks {
  /** The portal's open-data page; null when the console does not know the portal. */
  publicPage: string | null;
  /** The verify app's address (its `/v/<code>` pages); null when the console does not know it. */
  verifyBase: string | null;
}

function publicLinks(): PublicLinks {
  const { PORTAL_URL, VERIFY_URL } = env();
  return {
    publicPage: PORTAL_URL ? new URL('/open-data', PORTAL_URL).toString() : null,
    verifyBase: VERIFY_URL ? VERIFY_URL.replace(/\/$/, '') : null,
  };
}

export interface ReleasesPage {
  releases: ReleasesResult<OpenDataRelease[]>;
  links: PublicLinks;
}

export interface ReleasePage {
  release: ReleasesResult<OpenDataReleaseView>;
  links: PublicLinks;
}

export const getOpenDataReleasesPage = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ReleasesPage> => ({
    releases: await withViewerClient(reportingClient, listOpenDataReleases),
    links: publicLinks(),
  }),
);

export const buildOpenDataSnapshotFn = createServerFn({ method: 'POST' })
  .validator(z.object({ fy: financialYear, idempotencyKey: z.uuid() }))
  .handler(({ data }): Promise<ReleasesResult<OpenDataRelease>> =>
    withViewerClient(reportingClient, (client) =>
      buildOpenDataSnapshot(client, data.fy, data.idempotencyKey),
    ),
  );

export const getOpenDataReleasePage = createServerFn({ method: 'GET' })
  .validator(z.object({ releaseId: z.string().min(1).max(64) }))
  .handler(async ({ data }): Promise<ReleasePage> => ({
    release: await withViewerClient(reportingClient, (client) =>
      loadOpenDataRelease(client, data.releaseId),
    ),
    links: publicLinks(),
  }));

const releaseId = z.uuid();

/** Build v{n+1}: the next version of a withdrawn release's year and kind, as a preview (#353). */
export const buildOpenDataReleaseFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      fy: financialYear,
      kind: z.enum(['annual', 'snapshot']),
      idempotencyKey: z.uuid(),
    }),
  )
  .handler(({ data }): Promise<ReleasesResult<OpenDataRelease>> =>
    withViewerClient(reportingClient, (client) =>
      buildOpenDataRelease(client, data.fy, data.kind, data.idempotencyKey),
    ),
  );

/** Publish a preview (EACC supervisor; #353). */
export const publishOpenDataReleaseFn = createServerFn({ method: 'POST' })
  .validator(z.object({ releaseId, idempotencyKey: z.uuid() }))
  .handler(({ data }): Promise<ReleasesResult<OpenDataRelease>> =>
    withViewerClient(reportingClient, (client) =>
      publishOpenDataRelease(client, data.releaseId, data.idempotencyKey),
    ),
  );

/** Withdraw a published release with its public reason (EACC supervisor; #353). */
export const withdrawOpenDataReleaseFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      releaseId,
      reason: z.string().trim().min(1).max(WITHDRAW_REASON_MAX),
      idempotencyKey: z.uuid(),
    }),
  )
  .handler(({ data }): Promise<ReleasesResult<OpenDataRelease>> =>
    withViewerClient(reportingClient, (client) =>
      withdrawOpenDataRelease(client, data.releaseId, data.reason, data.idempotencyKey),
    ),
  );
