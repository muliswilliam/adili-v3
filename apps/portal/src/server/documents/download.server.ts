import type { Unauthenticated } from '../results';
import type { SlipDownload } from '../submission.server';

/**
 * What `/api/documents/{documentId}/download` answers for the documents service's presigned link
 * (`readSlipDownload`, the owner-only download of any issued document): a redirect to the link,
 * valid for minutes, so the browser fetches the PDF from storage; sign-in when the session has
 * ended (back here after); 404 when the document is not the declarant's; 503 when the service
 * did not answer.
 */
export function issuedDocumentResponse(
  result: SlipDownload | Unauthenticated,
  documentPath: string,
): Response {
  switch (result.status) {
    case 'ok':
      return redirect(result.downloadUrl);
    case 'unauthenticated':
      return redirect(`/auth/login?returnTo=${encodeURIComponent(documentPath)}`);
    case 'not-found':
      return new Response(null, { status: 404 });
    default:
      return new Response(null, { status: 503, headers: { 'retry-after': '30' } });
  }
}

function redirect(location: string): Response {
  // The link expires in minutes: never cache the redirect.
  return new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store' } });
}
