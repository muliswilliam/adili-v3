import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { asReportingViewer } from './as-viewer.server';
import { commissionSlug } from './commission-slug';
import { env } from './env.server';
import {
  type CommissionOpenDataPreview,
  loadCommissionOpenDataPreview,
} from './open-data-preview.server';
import type { ServiceResult } from './service-call';

/** What the open-data preview page loads. */
export interface OpenDataPreviewLoad {
  preview: ServiceResult<CommissionOpenDataPreview>;
  /** The portal's public open-data page; null when the console does not know the portal. */
  publicPageUrl: string | null;
}

/**
 * The viewer's own Commission's open-data preview (spec 09b S6), as its commission-admin. The
 * token stays on the server.
 */
export const getCommissionOpenDataPreview = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: commissionSlug }))
  .handler(async ({ data }): Promise<OpenDataPreviewLoad> => {
    const portal = env().PORTAL_URL;
    return {
      preview: await asReportingViewer((client) =>
        loadCommissionOpenDataPreview(client, data.slug),
      ),
      publicPageUrl: portal ? new URL('/open-data', portal).toString() : null,
    };
  });
