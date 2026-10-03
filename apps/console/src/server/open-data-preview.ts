import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';

import { getBff } from './bff.server';
import { env } from './env.server';
import {
  type CommissionOpenDataPreview,
  loadCommissionOpenDataPreview,
} from './open-data-preview.server';
import { reportingClient } from './reporting/client.server';
import { SERVICE_UNAVAILABLE, type ServiceResult } from './service-call';
import { tenantClaim } from './tenant-claim';

/** What the open-data preview page loads. */
export interface OpenDataPreviewLoad {
  preview: ServiceResult<CommissionOpenDataPreview>;
  /** The portal's public open-data page; null when the console does not know the portal. */
  publicPageUrl: string | null;
}

/**
 * The viewer's own Commission's open-data preview (spec 09b S6), as its commission-admin. The
 * Commission is the session's (its token's `tenant` claim), never one the page names; a token
 * without one is a failed load. The token stays on the server.
 */
export const getCommissionOpenDataPreview = createServerFn({ method: 'GET' }).handler(
  async (): Promise<OpenDataPreviewLoad> => {
    const portal = env().PORTAL_URL;
    const publicPageUrl = portal ? new URL('/open-data', portal).toString() : null;
    const session = await getBff().getSession(getRequest());
    if (!session)
      return { preview: { ok: false, error: { kind: 'unauthenticated' } }, publicPageUrl };
    const slug = tenantClaim(session.accessToken);
    return {
      preview: slug
        ? await loadCommissionOpenDataPreview(reportingClient(session.accessToken), slug)
        : SERVICE_UNAVAILABLE,
      publicPageUrl,
    };
  },
);
