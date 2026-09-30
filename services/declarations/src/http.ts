import { applyDecorators } from '@nestjs/common';
import { ApiParam } from '@nestjs/swagger';

/** What the routes of the service share: the 404 wording, the path parameters and the `ETag`. */

/** Every 404: a declarant's record another caller may not see is answered as if it did not exist. */
export const NOT_VISIBLE = 'Not found, or not visible to the caller';

/** The part of Fastify's reply the routes use. */
export interface Reply {
  status(code: number): unknown;
  header(name: string, value: string): unknown;
}

/** The `declarationId` path parameter. */
export const ApiDeclarationIdParam = () =>
  ApiParam({ name: 'declarationId', schema: { type: 'string', format: 'uuid' } });

/** The `version` path parameter of a submitted version (see `versionNumber`). */
export const ApiVersionParam = () =>
  ApiParam({ name: 'version', schema: { type: 'integer', minimum: 1 } });

/** `declarationId` and `version`: one submitted version of a declaration. */
export const ApiVersionParams = () => applyDecorators(ApiDeclarationIdParam(), ApiVersionParam());

/** The `ETag` response header of a route answering with the draft version. */
export function etagHeader(
  description = 'The draft version; send it as If-Match on section saves',
): Record<string, { schema: { type: 'string' }; description: string }> {
  return { ETag: { schema: { type: 'string' }, description } };
}

/** The draft version as an `ETag`. */
export function etag(draftVersion: number): string {
  return `"${String(draftVersion)}"`;
}
