import { HttpStatus } from '@nestjs/common';
import { ProblemException } from '@adili/api-kit';
import { z } from 'zod';

/**
 * A place in a list ordered by an instant, then by id: the approvals inbox (oldest proposal
 * first), the ladders and the referrals (newest first).
 */
export interface Position {
  at: Date;
  id: string;
}

const cursorPayload = z.tuple([z.iso.datetime({ offset: true }), z.uuid()]);

/** Opaque to clients: base64url of `[at, id]`. */
export function encodeCursor(position: Position): string {
  return Buffer.from(JSON.stringify([position.at.toISOString(), position.id])).toString(
    'base64url',
  );
}

/** The position a cursor names; 400 for one this service did not issue. */
export function decodeCursor(value: string): Position {
  try {
    const parsed = cursorPayload.safeParse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    );
    if (parsed.success) return { at: new Date(parsed.data[0]), id: parsed.data[1] };
  } catch {
    // Not JSON: not a cursor this service issued.
  }
  throw new ProblemException({
    type: 'about:blank',
    title: 'Bad Request',
    status: HttpStatus.BAD_REQUEST,
    detail: 'The cursor is not one this list issued.',
  });
}
