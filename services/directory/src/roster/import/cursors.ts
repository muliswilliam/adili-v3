import { HttpStatus } from '@nestjs/common';
import { ProblemException } from '@adili/api-kit';
import { z } from 'zod';

/**
 * Opaque keyset cursors of the import history and import rows pages: base64url JSON of the
 * position after the last item of a page.
 */

const importCursor = z.tuple([z.iso.datetime(), z.uuid()]);
const rowCursor = z.tuple([z.number().int()]);

export interface ImportPosition {
  /** ISO 8601 with Postgres' microseconds, which a `Date` would round away. */
  startedAt: string;
  id: string;
}

export function encodeImportCursor({ startedAt, id }: ImportPosition): string {
  return encode([startedAt, id]);
}

/** The position, or a 400 when the cursor was not issued by `encodeImportCursor`. */
export function decodeImportCursor(value: string): ImportPosition {
  const [startedAt, id] = decode(value, importCursor);
  return { startedAt, id };
}

export function encodeRowCursor(rowNumber: number): string {
  return encode([rowNumber]);
}

/** The row number, or a 400 when the cursor was not issued by `encodeRowCursor`. */
export function decodeRowCursor(value: string): number {
  return decode(value, rowCursor)[0];
}

function encode(position: unknown[]): string {
  return Buffer.from(JSON.stringify(position)).toString('base64url');
}

function decode<T>(value: string, schema: z.ZodType<T>): T {
  try {
    const parsed = schema.safeParse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    if (parsed.success) return parsed.data;
  } catch {
    // Not JSON: an unknown cursor like any other.
  }
  throw new ProblemException({
    type: 'about:blank',
    title: 'Validation failed',
    status: HttpStatus.BAD_REQUEST,
    errors: [{ path: 'cursor', message: 'Unknown cursor; start again from the first page' }],
  });
}
