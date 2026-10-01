import { ApiParam } from '@nestjs/swagger';

/** The HTTP pieces the drafts controllers share. */

export const NOT_VISIBLE = 'Not found, or not visible to the caller';

/** The part of Fastify's reply the routes use. */
export interface Reply {
  status(code: number): unknown;
  header(name: string, value: string): unknown;
}

export const ETAG_HEADER = {
  ETag: {
    schema: { type: 'string' },
    description: 'The draft version; send it as If-Match on the next section save',
  },
};

export const ApiDeclarationIdParam = () =>
  ApiParam({ name: 'declarationId', schema: { type: 'string', format: 'uuid' } });

/** The draft version as an `ETag`. */
export function etag(draftVersion: number): string {
  return `"${String(draftVersion)}"`;
}
