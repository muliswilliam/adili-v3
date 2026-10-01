import { AsyncLocalStorage } from 'node:async_hooks';

import type { Database } from '@adili/data-access';

type Query = (this: unknown, ...args: unknown[]) => unknown;

/**
 * Records the SQL statements the service sends while `work` runs, as their text (`$1`
 * placeholders, not values), in order. Only statements sent on `work`'s behalf count, not the
 * outbox relay's or another request's on the same pool, so a test can compare the database work
 * behind two requests exactly.
 *
 * @example
 * const statements = await statementsOf(api.db, () => identify(api, input, ip));
 */
export async function statementsOf(
  db: Database<Record<string, unknown>>,
  work: () => Promise<unknown>,
): Promise<string[]> {
  const pool = db.$client;
  const recorded: string[] = [];
  const recording = new AsyncLocalStorage<string[]>();
  const wrapped = new WeakSet<object>();
  const restore: (() => void)[] = [];
  // Every query, in a transaction or not, runs on a client checked out of the pool.
  const onAcquire = (client: { query: Query }) => {
    if (wrapped.has(client)) return;
    wrapped.add(client);
    const own = Object.hasOwn(client, 'query');
    const query = client.query;
    client.query = function (this: unknown, ...args: unknown[]) {
      const [config] = args;
      recording
        .getStore()
        ?.push(typeof config === 'string' ? config : (config as { text: string }).text);
      return query.apply(this, args);
    };
    restore.push(() => {
      if (own) client.query = query;
      else delete (client as Partial<typeof client>).query;
    });
  };
  pool.on('acquire', onAcquire);
  try {
    await recording.run(recorded, work);
  } finally {
    pool.off('acquire', onAcquire);
    for (const undo of restore) undo();
  }
  return recorded;
}
