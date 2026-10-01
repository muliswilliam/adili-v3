import { createDatabase, type Database } from '@adili/data-access';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { consumeIdempotent, eventsSchema, inbox } from '../src/index.js';
import { privateSchema, runId } from './support/private-schema.js';

/** The inbox against Postgres (`pnpm infra:up`), in a private schema per run. */
const RUN = runId();
const SCHEMA = privateSchema(`events_inbox_test_${RUN}`, `events-inbox-test-${RUN}`);

let db: Database<typeof eventsSchema>;

beforeAll(async () => {
  await SCHEMA.create();
  db = createDatabase({ url: SCHEMA.url, schema: eventsSchema, applicationName: 'events-test' });
});

afterAll(async () => {
  await db.$client.end();
  await SCHEMA.drop();
});

const event = () => ({ id: crypto.randomUUID() });

describe('consumeIdempotent', () => {
  it('does the work once per consumer and event, and records it after the work', async () => {
    const delivered = event();
    const runs: string[] = [];

    const first = await consumeIdempotent(db, 'test.consumer', delivered, async () => {
      runs.push('first');
      // Not recorded while the work runs: a transaction would hold a connection meanwhile.
      expect(await db.select().from(inbox)).not.toContainEqual(
        expect.objectContaining({ eventId: delivered.id }),
      );
    });
    const again = await consumeIdempotent(db, 'test.consumer', delivered, () => {
      runs.push('again');
      return Promise.resolve();
    });
    const other = await consumeIdempotent(db, 'test.other-consumer', delivered, () => {
      runs.push('other');
      return Promise.resolve();
    });

    expect([first, again, other]).toEqual([true, false, true]);
    expect(runs).toEqual(['first', 'other']);
  });

  it('records nothing when the work throws, so a redelivery does it again', async () => {
    const delivered = event();

    await expect(
      consumeIdempotent(db, 'test.consumer', delivered, () => Promise.reject(new Error('down'))),
    ).rejects.toThrow('down');
    let ran = false;
    await consumeIdempotent(db, 'test.consumer', delivered, () => {
      ran = true;
      return Promise.resolve();
    });

    expect(ran).toBe(true);
  });
});
