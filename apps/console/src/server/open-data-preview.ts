import { createServerFn } from '@tanstack/react-start';

import { withViewerClient } from './as-viewer.server';
import { fetchPrincipal } from './directory.server';
import { env } from './env.server';
import {
  type CommissionOpenDataPreview,
  loadCommissionOpenDataPreview,
} from './open-data-preview.server';
import { reportingClient } from './reporting/client.server';
import { SERVICE_UNAVAILABLE, type ServiceResult } from './service-call';

/** What the open-data preview page loads. */
export interface OpenDataPreviewLoad {
  preview: ServiceResult<CommissionOpenDataPreview>;
  /** The portal's public open-data page; null when the console does not know the portal. */
  publicPageUrl: string | null;
}

/**
 * The viewer's own Commission's open-data preview (spec 09b S6), as its commission-admin. The
 * Commission is the session's, the directory principal's tenant, never one the page names; no
 * principal or no tenant is a failed load. The token stays on the server.
 */
export const getCommissionOpenDataPreview = createServerFn({ method: 'GET' }).handler(
  async (): Promise<OpenDataPreviewLoad> => {
    const portal = env().PORTAL_URL;
    return {
      preview: await withViewerClient(
        (accessToken) => ({ client: reportingClient(accessToken), accessToken }),
        async ({ client, accessToken }) => {
          const principal = await fetchPrincipal(env().DIRECTORY_API_URL, accessToken);
          const slug = principal.ok ? principal.principal.tenant : null;
          return slug ? loadCommissionOpenDataPreview(client, slug) : SERVICE_UNAVAILABLE;
        },
      ),
      publicPageUrl: portal ? new URL('/open-data', portal).toString() : null,
    };
  },
);
