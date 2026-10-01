import { z } from 'zod';

import { badRequest } from './problems.js';

/**
 * A place in the queue: open requests first by earliest deadline, then closed ones (decided,
 * withdrawn, cannot identify) by latest deadline, each then by id.
 */
export interface Position {
  closed: boolean;
  at: Date;
  id: string;
}

const cursorPayload = z.tuple([z.boolean(), z.iso.datetime({ offset: true }), z.uuid()]);

/** Opaque to clients: base64url of `[closed, at, id]`. */
export function encodeCursor(position: Position): string {
  return Buffer.from(
    JSON.stringify([position.closed, position.at.toISOString(), position.id]),
  ).toString('base64url');
}

/** The position a cursor names; 400 at `cursor` for one this service did not issue. */
export function decodeCursor(value: string): Position {
  try {
    const parsed = cursorPayload.safeParse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    );
    if (parsed.success) {
      return { closed: parsed.data[0], at: new Date(parsed.data[1]), id: parsed.data[2] };
    }
  } catch {
    // Not JSON: not a cursor this service issued.
  }
  throw badRequest('The cursor is not one this list issued.', [
    { path: 'cursor', message: 'Unknown cursor; start again from the first page' },
  ]);
}
