import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';

import type { FileFormat } from './files.js';

/**
 * HTTP of the public open-data API (spec 09b): cross-origin reads by any site, conditional
 * requests and long caching of content that only changes by status, and the table format the
 * client asks for.
 */

/** The parts of Fastify's reply the public routes set. */
export interface PublicReply {
  header(name: string, value: string | number): unknown;
  status(code: number): unknown;
}

/** The request headers the public routes read. */
export type PublicRequestHeaders = Record<string, string | string[] | undefined>;

/** Responses may be cached by browsers and shared caches for an hour. */
export const PUBLIC_CACHE_CONTROL = 'public, max-age=3600';

/** The non-safelisted response headers a cross-origin script may read. */
const EXPOSED_HEADERS = [
  'ETag',
  'Content-Disposition',
  'RateLimit-Limit',
  'RateLimit-Remaining',
  'RateLimit-Reset',
  'Retry-After',
].join(', ');

/** The request headers a cross-origin script may send (answered in the preflight). */
export const ALLOWED_REQUEST_HEADERS = 'Accept, If-None-Match, If-Modified-Since';

/**
 * Lets any origin read every response of the routes, errors and 429s included (set before the
 * rate limiter runs), and lets other sites embed the files: helmet's `same-origin` resource
 * policy is for the authenticated APIs. Register it on the controller, ahead of `@RateLimit` on
 * the routes.
 */
@Injectable()
export class PublicCorsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const reply = context.switchToHttp().getResponse<PublicReply>();
    reply.header('access-control-allow-origin', '*');
    reply.header('access-control-expose-headers', EXPOSED_HEADERS);
    reply.header('cross-origin-resource-policy', 'cross-origin');
    return true;
  }
}

/** A strong entity tag of content identified by its SHA-256 (hex). */
export function entityTag(sha256: string): string {
  return `"${sha256}"`;
}

/**
 * Whether the client's copy is current (RFC 9110 §13.1): `If-None-Match` lists the tag (weak
 * comparison; `*` matches anything), or, without `If-None-Match`, nothing changed since
 * `If-Modified-Since` (HTTP dates have whole seconds).
 */
export function isNotModified(
  headers: PublicRequestHeaders,
  etag: string,
  lastModified: Date,
): boolean {
  const ifNoneMatch = single(headers['if-none-match']);
  if (ifNoneMatch !== undefined) {
    const tags = ifNoneMatch.split(',').map((tag) => tag.trim().replace(/^W\//, ''));
    return tags.includes('*') || tags.includes(etag);
  }
  const ifModifiedSince = single(headers['if-modified-since']);
  if (ifModifiedSince === undefined) return false;
  const since = Date.parse(ifModifiedSince);
  return !Number.isNaN(since) && Math.floor(lastModified.getTime() / 1000) * 1000 <= since;
}

/**
 * The cache headers of a 200 or 304: the tag, when it last changed, how long to keep it, and
 * `Vary: Accept` when the same URL also serves another format.
 */
export function setCacheHeaders(
  reply: PublicReply,
  cache: { etag: string; lastModified: Date; variesByAccept?: boolean },
): void {
  reply.header('etag', cache.etag);
  reply.header('last-modified', cache.lastModified.toUTCString());
  reply.header('cache-control', PUBLIC_CACHE_CONTROL);
  if (cache.variesByAccept) reply.header('vary', 'Accept');
}

const MEDIA_TYPES: Record<FileFormat, string> = { json: 'application/json', csv: 'text/csv' };

/**
 * The table format `accept` prefers: JSON when it says nothing or rates both alike, CSV when it
 * rates `text/csv` higher; undefined when it accepts neither (406).
 */
export function preferredFormat(accept: string | string[] | undefined): FileFormat | undefined {
  const header = single(accept)?.trim();
  if (!header) return 'json';
  const ranges = header.split(',').flatMap((part) => {
    const [range = '', ...parameters] = part.split(';').map((each) => each.trim().toLowerCase());
    const q = parameters.find((parameter) => parameter.startsWith('q='));
    const quality = q === undefined ? 1 : Number(q.slice(2));
    return range === '' || Number.isNaN(quality) ? [] : [{ range, quality }];
  });
  const qualityOf = (format: FileFormat): number => {
    const type = MEDIA_TYPES[format];
    const [major] = type.split('/');
    // The most specific range that matches decides (RFC 9110 §12.5.1).
    const match =
      ranges.find((each) => each.range === type) ??
      ranges.find((each) => each.range === `${major ?? ''}/*`) ??
      ranges.find((each) => each.range === '*/*');
    return match?.quality ?? 0;
  };
  const json = qualityOf('json');
  const csv = qualityOf('csv');
  if (json === 0 && csv === 0) return undefined;
  return csv > json ? 'csv' : 'json';
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(', ') : value;
}
