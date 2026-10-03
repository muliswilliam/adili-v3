import { describe, expect, it } from 'vitest';

import { isNotModified, preferredFormat } from '../../src/open-data/public-http.js';

/** The public open-data API's content negotiation and conditional requests (S8). */
describe('public open-data HTTP', () => {
  it.each([
    [undefined, 'json'],
    ['', 'json'],
    ['application/json', 'json'],
    ['text/csv', 'csv'],
    ['text/csv, application/json', 'json'],
    ['text/csv;q=1, application/json;q=0.8', 'csv'],
    ['application/json;q=0.5, text/*', 'csv'],
    ['*/*', 'json'],
    ['text/html, */*;q=0.1', 'json'],
    ['text/*;q=0.2, text/csv;q=0', undefined],
    ['image/png', undefined],
    ['application/json;q=0, text/csv;q=0', undefined],
  ] as const)('Accept %j prefers %s', (accept, format) => {
    expect(preferredFormat(accept)).toBe(format);
  });

  const ETAG = '"abc"';
  const MODIFIED = new Date('2028-03-25T08:00:00.500Z');

  it.each([
    [{}, false],
    [{ 'if-none-match': ETAG }, true],
    [{ 'if-none-match': `W/${ETAG}` }, true],
    [{ 'if-none-match': `"x", ${ETAG}` }, true],
    [{ 'if-none-match': '*' }, true],
    [{ 'if-none-match': '"x"' }, false],
    // If-None-Match decides when both are sent.
    [{ 'if-none-match': '"x"', 'if-modified-since': MODIFIED.toUTCString() }, false],
    [{ 'if-modified-since': MODIFIED.toUTCString() }, true],
    [{ 'if-modified-since': 'Sat, 25 Mar 2028 07:59:59 GMT' }, false],
    [{ 'if-modified-since': 'not a date' }, false],
  ])('%j is not modified: %s', (headers, notModified) => {
    expect(isNotModified(headers, ETAG, MODIFIED)).toBe(notModified);
  });
});
