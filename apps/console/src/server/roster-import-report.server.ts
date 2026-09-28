import { z } from 'zod';

import {
  defaultDirectoryAttachmentDeps,
  directoryAttachment,
  type DirectoryAttachmentDeps,
  problemResponse,
} from './directory-attachment.server';
import { commissionSlug } from './commission-slug';
import { fetchPrincipal } from './directory.server';
import { env } from './env.server';

export interface RosterImportReportDeps extends DirectoryAttachmentDeps {
  /** The Commission the token's user belongs to (for roster routes, which carry no slug), or null. */
  tenant: (accessToken: string) => Promise<string | null>;
}

const defaultDeps: RosterImportReportDeps = {
  ...defaultDirectoryAttachmentDeps,
  tenant: async (accessToken) => {
    const result = await fetchPrincipal(env().DIRECTORY_API_URL, accessToken);
    return result.ok ? result.principal.tenant : null;
  },
};

const reportParams = z.object({ importId: z.uuid(), slug: commissionSlug.optional() });

/**
 * `GET /roster/imports/{importId}/report.csv` (the viewer's own Commission) and
 * `GET /commissions/{slug}/imports/{importId}/report.csv` (Commission `slug`, for platform
 * admins): the import's rejected rows as CSV (`getRosterImportReportCsv`), passed through as the
 * attachment the directory sends (`<file>-rejected-rows.csv`). The directory decides who may
 * read it: 403 for EACC, 404 for another Commission's import, 410 once the rows are purged.
 */
export async function rosterImportReportResponse(
  request: Request,
  params: { importId: string; slug?: string },
  deps: RosterImportReportDeps = defaultDeps,
): Promise<Response> {
  const parsed = reportParams.safeParse(params);
  if (!parsed.success) return problemResponse(404, 'No such import');
  const { importId: id, slug } = parsed.data;
  return directoryAttachment(request, deps, async (client, accessToken) => {
    const tenant = slug ?? (await deps.tenant(accessToken));
    if (!tenant) {
      return { response: new Response(null, { status: 404, statusText: 'No such import' }) };
    }
    return client.GET('/v1/commissions/{slug}/roster/imports/{importId}/report.csv', {
      params: { path: { slug: tenant, importId: id } },
      parseAs: 'stream',
    });
  });
}
