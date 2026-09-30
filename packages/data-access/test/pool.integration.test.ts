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

async function backendPid(db: Database): Promise<number> {
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
