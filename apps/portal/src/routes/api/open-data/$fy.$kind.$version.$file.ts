import { createFileRoute } from '@tanstack/react-router';

import { loadOpenDataFile } from '../../../server/open-data.server';
import { openDataClient } from '../../../server/reporting/client.server';

/**
 * A download of the Open data page (spec 09b S8): a table's CSV (`<table>.csv`) or the release
 * JSON (`release.json`), served as the public API serves it, through the portal's cache so that
 * a visitor's downloads do not each spend the portal's request budget.
 */
async function download(params: Record<string, string>): Promise<Response> {
  const fy = Number(params.fy);
  const version = Number(params.version);
  const kind = params.kind;
  if (
    !Number.isInteger(fy) ||
    !Number.isInteger(version) ||
    (kind !== 'annual' && kind !== 'snapshot')
  ) {
    return new Response('Not found', { status: 404 });
  }
  const file = await loadOpenDataFile(openDataClient(), {
    fy,
    kind,
    version,
    file: params.file ?? '',
  });
  if (file.status === 'ok') {
    return new Response(file.body, {
      headers: {
        'content-type': file.contentType,
        'content-disposition': `attachment; filename="${file.fileName}"`,
        'cache-control': 'public, max-age=3600',
      },
    });
  }
  if (file.status === 'rate-limited') {
    return new Response('Too many requests', {
      status: 429,
      headers: file.retryAfterSeconds ? { 'retry-after': String(file.retryAfterSeconds) } : {},
    });
  }
  return file.status === 'not-found'
    ? new Response('Not found', { status: 404 })
    : new Response('Open data is unavailable', { status: 503 });
}

export const Route = createFileRoute('/api/open-data/$fy/$kind/$version/$file')({
  server: { handlers: { GET: ({ params }) => download(params) } },
});
