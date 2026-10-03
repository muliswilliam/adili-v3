import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { getBff } from '../../server/bff.server';
import { documentsClient } from '../../server/documents/client.server';
import { issuedDocumentResponse } from '../../server/documents/download.server';
import { readSlipDownload } from '../../server/submission.server';

/**
 * An issued document of the signed-in declarant (a clarification or determination letter, a
 * notice): the review service links its letters here (`letterDownloadUrl`). Proxies the documents
 * service's owner-only download, so the access token stays on the server and every download is
 * audited there.
 */
export const Route = createFileRoute('/api/documents/$documentId/download')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const path = new URL(request.url).pathname;
        if (!z.uuid().safeParse(params.documentId).success) {
          return new Response(null, { status: 404 });
        }
        const session = await getBff().getSession(request);
        if (!session) return issuedDocumentResponse({ status: 'unauthenticated' }, path);
        const result = await readSlipDownload(
          documentsClient(session.accessToken),
          params.documentId,
        );
        return issuedDocumentResponse(result, path);
      },
    },
  },
});
