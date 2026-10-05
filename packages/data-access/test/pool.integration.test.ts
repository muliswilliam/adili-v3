import { createServer, type Server, type Socket } from 'node:net';
import { once } from 'node:events';

import { toProblemDetails } from '@adili/api-kit';
import { HttpStatus } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDatabase, type Database, DatabaseUnavailableError } from '../src/index.js';

/**
 * The service's pool when Postgres misbehaves: a database that does not answer is a 503, not a
 * 500, and a connection the server drops while idle does not take the process down.
 */
const DATABASE_URL = requireEnv('TEST_DATABASE_URL');

describe('a database that does not answer', () => {
  // Accepts TCP and never speaks the protocol, as Postgres on a starved host or behind a
  // black-holed route: the connect timeout is what fires.
  let silent: Server;
  const sockets = new Set<Socket>();
  let db: Database;

  beforeAll(async () => {
    silent = createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    silent.listen(0, '127.0.0.1');
    await once(silent, 'listening');
    const address = silent.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    db = createDatabase({
      url: `postgres://nobody:nothing@127.0.0.1:${String(address.port)}/nothing`,
      schema: {},
      applicationName: 'data-access-pool-test',
      connectTimeoutMillis: 500,
    });
  });

  afterAll(async () => {
    await db.$client.end();
    for (const socket of sockets) socket.destroy();
    silent.close();
  });

  it('fails a query as unavailable (503) once the connect timeout passes', async () => {
    const error = await db.execute(sql`select 1`).catch((thrown: unknown) => thrown);

    expect(toProblemDetails(error, '/x')).toMatchObject({
      type: 'database-unavailable',
      code: 'database-unavailable',
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
  });

  it('fails a transaction the same way', async () => {
    const error = await db
      .transaction(async (tx) => tx.execute(sql`select 1`))
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(DatabaseUnavailableError);
    expect((error as DatabaseUnavailableError).cause).toBeInstanceOf(Error);
    expect(toProblemDetails(error, '/x')).toMatchObject({ status: HttpStatus.SERVICE_UNAVAILABLE });
  });
});

describe('an idle connection the server drops', () => {
  let db: Database;
  let admin: Database;

  beforeAll(() => {
    db = createDatabase({
      url: DATABASE_URL,
      schema: {},
      applicationName: 'data-access-pool-test',
    });
    admin = createDatabase({
      url: DATABASE_URL,
      schema: {},
      applicationName: 'data-access-pool-test-admin',
      maxConnections: 1,
    });
  });

  afterAll(async () => {
    await db.$client.end();
    await admin.$client.end();
  });

  it('is replaced on the next query instead of crashing the process', async () => {
    const before = await backendPid(db);

    await admin.execute(sql`select pg_terminate_backend(${before})`);
    // Not `once(pool, 'error')`: listening here would stand in for the handler under test.
    await vi.waitUntil(() => db.$client.totalCount === 0);

    const after = await backendPid(db);
    expect(after).not.toBe(before);
  });
});

/**
 * #636: a connection checked out for a transaction has no pool listener, so the server ending
 * it (a restart, the demo checkpoint's `pg_terminate_backend`) raised an unhandled 'error' event
 * and the process exited. Vitest fails the run on such an error, which is what these guard.
 */
describe('a connection the server drops while a transaction holds it', () => {
  let db: Database;
  let admin: Database;

  beforeAll(() => {
    db = createDatabase({ url: DATABASE_URL, schema: {}, applicationName: 'data-access-tx-test' });
    admin = createDatabase({
      url: DATABASE_URL,
      schema: {},
      applicationName: 'data-access-tx-test-admin',
      maxConnections: 1,
    });
  });

  afterAll(async () => {
    await db.$client.end();
    await admin.$client.end();
  });

  it('fails the transaction, between statements, and the next query gets a new connection', async () => {
    let held = 0;
    const error = await db
      .transaction(async (tx) => {
        held = await backendPid(tx);
        await admin.execute(sql`select pg_terminate_backend(${held})`);
        // Work outside the database inside the transaction (an HTTP call, a broker publish).
        await waitForBackendGone(admin, held);
        await tx.execute(sql`select 1`);
      })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(Error);
    expect(await backendPid(db)).not.toBe(held);
  });

  it('fails the transaction, mid-statement, and the next query gets a new connection', async () => {
    let held = 0;
    const error = await db
      .transaction(async (tx) => {
        held = await backendPid(tx);
        // Drizzle queries run when awaited: `then` sends it now, settled into a value.
        const sleeping = tx.execute(sql`select pg_sleep(5)`).then(
          () => undefined,
          (thrown: unknown) => thrown,
        );
        await vi.waitUntil(() => isActive(admin, held), { interval: 20, timeout: 2_000 });
        await admin.execute(sql`select pg_terminate_backend(${held})`);
        throw await sleeping;
      })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(Error);
    expect(await backendPid(db)).not.toBe(held);
  });
});

async function waitForBackendGone(admin: Database, pid: number): Promise<void> {
  await vi.waitUntil(
    async () => {
      const result = await admin.execute<{ n: number }>(
        sql`select count(*)::int as n from pg_stat_activity where pid = ${pid}`,
      );
      return result.rows[0]?.n === 0;
    },
    { interval: 20, timeout: 5_000 },
  );
  // The socket's end reaches the client a moment after the backend is gone.
  await new Promise((resolve) => setTimeout(resolve, 100));
}

async function isActive(admin: Database, pid: number): Promise<boolean> {
  const result = await admin.execute<{ state: string }>(
    sql`select state from pg_stat_activity where pid = ${pid}`,
  );
  return result.rows[0]?.state === 'active';
}

async function backendPid(db: Pick<Database, 'execute'>): Promise<number> {
  const result = await db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
  const pid = result.rows[0]?.pid;
  if (pid === undefined) throw new Error('no backend pid');
  return pid;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
