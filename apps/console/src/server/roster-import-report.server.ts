import { z } from 'zod';

import {
  defaultDirectoryAttachmentDeps,
  directoryAttachment,
  type DirectoryAttachmentDeps,
  problemResponse,
} from './directory-attachment.server';
import { fetchPrincipal } from './directory.server';
import { env } from './env.server';

export interface RosterImportReportDeps extends DirectoryAttachmentDeps {
  /** The Commission the token's user belongs to (roster routes carry no slug), or null. */
  tenant: (accessToken: string) => Promise<string | null>;
}

const defaultDeps: RosterImportReportDeps = {
  ...defaultDirectoryAttachmentDeps,
  tenant: async (accessToken) => {
    const result = await fetchPrincipal(env().DIRECTORY_API_URL, accessToken);
    return result.ok ? result.principal.tenant : null;
  },
};

const importId = z.uuid();

/**
 * `GET /roster/imports/{importId}/report.csv`: the import's rejected rows as CSV
 * (`getRosterImportReportCsv`) for the viewer's own Commission, passed through as the attachment
 * the directory sends (`<file>-rejected-rows.csv`). The directory decides who may read it: 403
 * for EACC, 404 for another Commission's import, 410 once the rows are purged.
 */
export async function rosterImportReportResponse(
  request: Request,
  id: string,
  deps: RosterImportReportDeps = defaultDeps,
): Promise<Response> {
  if (!importId.safeParse(id).success) return problemResponse(404, 'No such import');
  return directoryAttachment(request, deps, async (client, accessToken) => {
    const tenant = await deps.tenant(accessToken);
    if (!tenant) {
      return { response: new Response(null, { status: 404, statusText: 'No such import' }) };
    }
    return client.GET('/v1/commissions/{slug}/roster/imports/{importId}/report.csv', {
      params: { path: { slug: tenant, importId: id } },
      parseAs: 'stream',
    });
  });
}
