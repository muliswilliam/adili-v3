import { PLATFORM_TENANT } from '@adili/api-kit';
import { withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  outbox,
  rosterImportBatches,
  rosterImportRows,
  rosterImports,
  rosterRecords,
  rosterSummaries,
} from '../../src/db/schema.js';
import { confirmExits } from '../../src/roster/exits/exits.js';
import { applyChunk } from '../../src/roster/import/apply-chunk.js';
import { finaliseImport } from '../../src/roster/import/finalise.js';
import { flagAbsent } from '../../src/roster/import/flag-absent.js';
import {
  DocumentsUnavailable,
  type OpenedRosterUpload,
  type RosterUpload,
  RosterUploads,
  type UploadRef,
} from '../../src/roster/import/roster-uploads.js';
import { IMPORT_SUBJECT, StagingSuperseded, stageImport } from '../../src/roster/import/staging.js';
import type { ImportRef } from '../../src/roster/import/workflow-contract.js';
import { recomputeRosterSummary } from '../../src/roster/summary.js';
import { type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';
import { givenCommissions } from '../support/fixtures.js';

/**
 * Restart safety of the import activities against a real Postgres: what Temporal's retries and
 * a worker crash can make them do twice (spec #27: "a crash re-runs only that chunk
 * idempotently").
 */
const FILE = [
  'personnel_file_number,full_name,national_id',
  'PSC/1,Achieng Otieno,12345678',
  'PSC/2,Kiprono Kipchumba,23456789',
  'PSC/3,Wanjiru Kamau,34567890',
  'PSC/4,X,1',
].join('\n');

let api: DirectoryApi;
let events: EventPublisher;

beforeAll(async () => {
  api = await startDirectoryApi();
  events = api.app.get(EventPublisher);
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  await givenCommissions(api.db, [{ slug: 'psc', name: 'Public Service Commission' }]);
});

function asPlatform<T>(work: (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) => Promise<T>) {
  return withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, work);
}

/** A pending file import of FILE, as the start endpoint records it (without its workflow). */
async function givenImport(
  content = FILE,
  declaredComplete = true,
  uploadId = api.uploads.add('psc', { bytes: content }),
): Promise<ImportRef> {
  const [row] = await asPlatform((tx) =>
    tx
      .insert(rosterImports)
      .values({
        tenant: 'psc',
        channel: 'file',
        declaredComplete,
        uploadId,
        fileName: 'roster.csv',
        format: 'csv',
        startedByKind: 'user',
        startedBy: 'officer-psc',
      })
      .returning({ id: rosterImports.id }),
  );
  return { importId: row?.id ?? '', tenant: 'psc' };
}

const importRow = async (ref: ImportRef) => {
  const [row] = await asPlatform((tx) =>
    tx.select().from(rosterImports).where(eq(rosterImports.id, ref.importId)),
  );
  return row;
};

const stagedRows = (ref: ImportRef) =>
  asPlatform((tx) =>
    tx
      .select()
      .from(rosterImportRows)
      .where(eq(rosterImportRows.importId, ref.importId))
      .orderBy(asc(rosterImportRows.rowNumber)),
  );

const records = () => asPlatform((tx) => tx.select().from(rosterRecords));

describe('stage', () => {
  it('stages accepted and rejected rows and moves the import to processing', async () => {
    const ref = await givenImport();

    const result = await stageImport(api.db, api.uploads, ref);

    expect(result).toEqual({ outcome: 'staged', chunkCount: 1, declaredComplete: true });
    expect(await importRow(ref)).toMatchObject({
      state: 'processing',
      totalRows: 4,
      processedRows: 1,
      chunkCount: 1,
    });
    expect((await stagedRows(ref)).map((row) => [row.status, row.chunkIndex])).toEqual([
      ['accepted', 0],
      ['accepted', 0],
      ['accepted', 0],
      ['rejected', null],
    ]);
  });

  it('returns the staged plan again without reading the file', async () => {
    const ref = await givenImport();
    const first = await stageImport(api.db, api.uploads, ref);
    api.uploads.failNext();

    expect(await stageImport(api.db, api.uploads, ref)).toEqual(first);
    expect(await stagedRows(ref)).toHaveLength(4);
  });

  it('starts over after an attempt cut short, replacing the rows it wrote', async () => {
    const ref = await givenImport();
    await asPlatform(async (tx) => {
      await tx.update(rosterImports).set({ state: 'processing' });
      await tx.insert(rosterImportRows).values(
        [2, 3, 99].map((rowNumber) => ({
          importId: ref.importId,
          rowNumber,
          tenant: 'psc',
          raw: {},
          status: 'rejected' as const,
        })),
      );
    });

    await stageImport(api.db, api.uploads, ref);

    expect((await stagedRows(ref)).map((row) => row.rowNumber)).toEqual([2, 3, 4, 5]);
  });

  it('fails an import whose upload is gone as missing, not as unclean', async () => {
    const ref = await givenImport();
    api.uploads.reset();

    expect(await stageImport(api.db, api.uploads, ref)).toEqual({
      outcome: 'failed',
      failure: {
        code: 'upload-missing',
        detail: 'The uploaded file is no longer available. Upload it again.',
      },
    });
  });

  it('fails an import whose upload is not clean as unclean', async () => {
    const ref = await givenImport(FILE, true, api.uploads.addNotClean('psc'));

    expect(await stageImport(api.db, api.uploads, ref)).toMatchObject({
      outcome: 'failed',
      failure: { code: 'upload-not-clean' },
    });
  });

  it('throws for a retry when documents is unavailable, leaving no rows', async () => {
    const ref = await givenImport();
    api.uploads.failNext();

    await expect(stageImport(api.db, api.uploads, ref)).rejects.toBeInstanceOf(
      DocumentsUnavailable,
    );
    expect(await stagedRows(ref)).toEqual([]);
    expect(await importRow(ref)).toMatchObject({ state: 'processing', chunkCount: null });
  });

  it('stops an attempt still running when its successor starts over, which stages alone', async () => {
    const lines = Array.from(
      { length: 2000 },
      (_, index) => `PSC/${index + 1},Officer Number${index + 1},${10_000_000 + index}\n`,
    );
    const uploads = new GatedUploads([
      `personnel_file_number,full_name,national_id\n${lines.slice(0, 1001).join('')}`,
      lines.slice(1001).join(''),
    ]);
    const ref = await givenImport();
    const staging = (flushed: PromiseWithResolvers<undefined>) =>
      stageImport(api.db, uploads, ref, {
        heartbeat: (rows) => {
          if (rows === 1000) flushed.resolve(undefined);
        },
      });

    // The first attempt has written its first batch and waits for more of the file ...
    const firstFlushed = Promise.withResolvers<undefined>();
    const first = staging(firstFlushed);
    await firstFlushed.promise;
    // ... when Temporal, taking it for lost, starts the next, which gets as far.
    const secondFlushed = Promise.withResolvers<undefined>();
    const second = staging(secondFlushed);
    await secondFlushed.promise;
    uploads.release(0);
    await expect(first).rejects.toBeInstanceOf(StagingSuperseded);
    uploads.release(1);

    expect(await second).toEqual({ outcome: 'staged', chunkCount: 2, declaredComplete: true });
    const rows = await stagedRows(ref);
    expect(rows).toHaveLength(2000);
    expect(rows.at(-1)?.rowNumber).toBe(2001);
    expect(await importRow(ref)).toMatchObject({ totalRows: 2000, chunkCount: 2 });
  });
});

/** Serves one CSV in two parts; each opening waits before its second part until released. */
class GatedUploads extends RosterUploads {
  private readonly gates: PromiseWithResolvers<undefined>[] = [];

  constructor(private readonly parts: [string, string]) {
    super();
  }

  release(opening: number): void {
    this.gates[opening]?.resolve(undefined);
  }

  describe(): Promise<RosterUpload> {
    return Promise.reject(new Error('not used'));
  }

  open({ uploadId }: UploadRef): Promise<OpenedRosterUpload> {
    const gate = Promise.withResolvers<undefined>();
    this.gates.push(gate);
    const [head, tail] = this.parts.map((part) => new TextEncoder().encode(part));
    async function* body(): AsyncGenerator<Uint8Array> {
      if (head) yield head;
      await gate.promise;
      if (tail) yield tail;
    }
    return Promise.resolve({
      id: uploadId,
      fileName: 'roster.csv',
      format: 'csv',
      size: 0,
      body: body(),
    });
  }
}

describe('applyChunk', () => {
  it('applies nothing twice when a chunk runs again', async () => {
    const ref = await givenImport();
    await stageImport(api.db, api.uploads, ref);

    const first = await applyChunk(api.db, ref, 0);
    const again = await applyChunk(api.db, ref, 0);

    expect(first).toEqual({ created: 3, updated: 0, unchanged: 0, rejected: 0 });
    expect(again).toEqual({ created: 0, updated: 0, unchanged: 0, rejected: 0 });
    expect(await records()).toHaveLength(3);
    expect(await importRow(ref)).toMatchObject({ processedRows: 4 });
  });

  it('applies a chunk once when two attempts race', async () => {
    const ref = await givenImport();
    await stageImport(api.db, api.uploads, ref);

    const results = await Promise.all([applyChunk(api.db, ref, 0), applyChunk(api.db, ref, 0)]);

    expect(results.map((counts) => counts.created).sort()).toEqual([0, 3]);
    expect(await records()).toHaveLength(3);
    expect(await importRow(ref)).toMatchObject({ processedRows: 4 });
  });

  it('applies nothing to an import that has ended', async () => {
    const ref = await givenImport();
    await stageImport(api.db, api.uploads, ref);
    await finaliseImport(api.db, events, ref, {
      state: 'failed',
      failure: { code: 'internal', detail: 'stopped' },
    });

    expect(await applyChunk(api.db, ref, 0)).toEqual({
      created: 0,
      updated: 0,
      unchanged: 0,
      rejected: 0,
    });
    expect(await records()).toEqual([]);
  });
});

describe('finalise', () => {
  it('ends the import once, with counts from its rows and one event', async () => {
    const ref = await givenImport();
    await stageImport(api.db, api.uploads, ref);
    await applyChunk(api.db, ref, 0);

    await finaliseImport(api.db, events, ref, { state: 'completed' });
    await finaliseImport(api.db, events, ref, {
      state: 'failed',
      failure: { code: 'internal', detail: 'late retry' },
    });

    expect(await importRow(ref)).toMatchObject({
      state: 'completed',
      failureCode: null,
      counts: {
        accepted: 3,
        created: 3,
        updated: 0,
        unchanged: 0,
        rejected: 1,
        flaggedAbsent: 0,
        exitsRecorded: 0,
      },
    });
    const recorded = await api.db.select({ type: outbox.eventType }).from(outbox);
    expect(recorded).toEqual([{ type: 'roster.import.completed.v1' }]);
  });

  it('keeps the processed count of a failed import', async () => {
    const ref = await givenImport();
    await stageImport(api.db, api.uploads, ref);
    await applyChunk(api.db, ref, 0);

    await finaliseImport(api.db, events, ref, {
      state: 'failed',
      failure: { code: 'internal', detail: 'Rows could not be applied.' },
    });

    expect(await importRow(ref)).toMatchObject({
      state: 'failed',
      processedRows: 4,
      failureCode: 'internal',
      counts: { created: 3, rejected: 1 },
    });
  });
});

describe('finalise an API batch', () => {
  it('deletes the batch rows of an import that failed before staging them', async () => {
    const [row] = await asPlatform((tx) =>
      tx
        .insert(rosterImports)
        .values({
          tenant: 'psc',
          channel: 'api',
          declaredComplete: false,
          format: 'json',
          startedByKind: 'client',
          startedBy: 'roster-psc-0a1b2c3d',
        })
        .returning({ id: rosterImports.id }),
    );
    const ref = { importId: row?.id ?? '', tenant: 'psc' };
    await asPlatform((tx) =>
      tx.insert(rosterImportBatches).values({
        importId: ref.importId,
        tenant: 'psc',
        rows: [{ personnelFileNumber: 'PSC/1', fullName: 'Achieng Otieno' }],
      }),
    );

    await finaliseImport(api.db, events, ref, {
      state: 'failed',
      failure: { code: 'internal', detail: 'The file could not be staged.' },
    });

    expect(await asPlatform((tx) => tx.select().from(rosterImportBatches))).toEqual([]);
    expect(await importRow(ref)).toMatchObject({ state: 'failed' });
  });
});

describe('finalise a failed import', () => {
  it('counts only the rows it processed, not accepted rows of chunks never applied', async () => {
    const ref = await givenImport();
    await stageImport(api.db, api.uploads, ref);

    await finaliseImport(api.db, events, ref, {
      state: 'failed',
      failure: { code: 'internal', detail: 'Rows could not be applied.' },
    });

    expect(await importRow(ref)).toMatchObject({
      state: 'failed',
      totalRows: 4,
      processedRows: 1,
      counts: { accepted: 0, created: 0, updated: 0, unchanged: 0, rejected: 1 },
    });
  });
});

describe('flagAbsent', () => {
  /** A completed import of FILE, then a staged and applied one of `content`. */
  async function givenSecondImport(content: string, declaredComplete = true): Promise<ImportRef> {
    const first = await givenImport();
    await stageImport(api.db, api.uploads, first);
    await applyChunk(api.db, first, 0);
    await finaliseImport(api.db, events, first, { state: 'completed' });
    const second = await givenImport(content, declaredComplete);
    await stageImport(api.db, api.uploads, second);
    await applyChunk(api.db, second, 0);
    return second;
  }

  const flaggedBy = async () =>
    (await records())
      .filter((record) => record.absentFromLatestImport)
      .map((record) => [record.personnelFileNumber, record.flaggedByImportId])
      .sort();

  it('flags the same records and returns the same count when it runs again', async () => {
    const ref = await givenSecondImport(
      ['personnel_file_number,full_name,national_id', 'PSC/1,Achieng Otieno,12345678'].join('\n'),
    );

    const first = await flagAbsent(api.db, ref);
    const flaggedAt = (await records()).map((record) => record.flaggedAt?.getTime()).sort();
    const again = await flagAbsent(api.db, ref);

    expect([first, again]).toEqual([2, 2]);
    expect(await flaggedBy()).toEqual([
      ['PSC/2', ref.importId],
      ['PSC/3', ref.importId],
    ]);
    expect((await records()).map((record) => record.flaggedAt?.getTime()).sort()).toEqual(
      flaggedAt,
    );
  });

  it('counts an officer whose row was rejected when staged as seen', async () => {
    const ref = await givenSecondImport(
      [
        'personnel_file_number,full_name,national_id',
        'PSC/1,Achieng Otieno,12345678',
        '\u00a0psc/2 ,Kiprono Kipchumba,bad',
        'PSC/3 x,Wanjiru Kamau,34567890',
      ].join('\n'),
    );

    expect(await flagAbsent(api.db, ref)).toBe(1);
    // A file number that is itself invalid names nobody.
    expect(await flagged()).toEqual(['PSC/3']);
  });

  it('flags nobody for a partial import or an import that has ended', async () => {
    const partial = await givenSecondImport(
      ['personnel_file_number,full_name,national_id', 'PSC/1,Achieng Otieno,12345678'].join('\n'),
      false,
    );

    expect(await flagAbsent(api.db, partial)).toBe(0);
    await finaliseImport(api.db, events, partial, { state: 'completed' });
    const ended = await givenImport(
      ['personnel_file_number,full_name,national_id', 'PSC/1,Achieng Otieno,12345678'].join('\n'),
    );
    await stageImport(api.db, api.uploads, ended);
    await applyChunk(api.db, ended, 0);
    await finaliseImport(api.db, events, ended, {
      state: 'failed',
      failure: { code: 'internal', detail: 'stopped' },
    });

    expect(await flagAbsent(api.db, ended)).toBe(0);
    expect(await flagged()).toEqual([]);
  });

  async function flagged(): Promise<string[]> {
    return (await flaggedBy()).map(([fileNumber]) => fileNumber ?? '');
  }
});

describe('the roster summary', () => {
  const summary = async () => {
    const [row] = await asPlatform((tx) =>
      tx.select().from(rosterSummaries).where(eq(rosterSummaries.tenant, 'psc')),
    );
    return row;
  };

  /** Resolves once the backend `pid` waits for a lock another one holds. */
  async function waitsForALock(pid: Promise<number>): Promise<void> {
    const backend = await pid;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const { rows } = await api.db.execute<{ blocked: boolean }>(
        sql`select cardinality(pg_blocking_pids(${backend}::int)) > 0 as blocked`,
      );
      if (rows[0]?.blocked === true) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`backend ${backend} never waited for a lock`);
  }

  it('keeps an exit that commits while a full count is being taken', async () => {
    const ref = await givenImport();
    await stageImport(api.db, api.uploads, ref);
    await applyChunk(api.db, ref, 0);
    await finaliseImport(api.db, events, ref, { state: 'completed' });
    expect(await summary()).toMatchObject({ expected: 3 });
    const [first] = await records();

    const commit = Promise.withResolvers<undefined>();
    const adjusted = Promise.withResolvers<undefined>();
    // The exit has recounted the summary and holds its row until released.
    const exit = withTenant(api.db, { tenant: 'psc', subject: 'officer-psc' }, async (tx) => {
      await confirmExits(tx, events, {
        tenant: 'psc',
        exits: [{ recordId: first?.id ?? '', exitDate: '2026-09-01' }],
        source: 'console',
        actor: { kind: 'user', id: 'officer-psc', name: null },
      });
      adjusted.resolve(undefined);
      await commit.promise;
    });
    await adjusted.promise;
    const backend = Promise.withResolvers<number>();
    const count = withTenant(api.db, { tenant: 'psc', subject: IMPORT_SUBJECT }, async (tx) => {
      const { rows } = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      backend.resolve(rows[0]?.pid ?? 0);
      await recomputeRosterSummary(tx, 'psc');
    });
    await waitsForALock(backend.promise);
    commit.resolve(undefined);
    await Promise.all([exit, count]);

    expect(await summary()).toMatchObject({ expected: 2 });
  });

  it('applies an exit waiting on a full count to that count', async () => {
    await givenCompletedImport();
    const [first] = await records();

    const commit = Promise.withResolvers<undefined>();
    const counted = Promise.withResolvers<undefined>();
    // The count holds the summary row until released.
    const count = withTenant(api.db, { tenant: 'psc', subject: IMPORT_SUBJECT }, async (tx) => {
      await recomputeRosterSummary(tx, 'psc');
      counted.resolve(undefined);
      await commit.promise;
    });
    await counted.promise;
    const backend = Promise.withResolvers<number>();
    const exit = withTenant(api.db, { tenant: 'psc', subject: 'officer-psc' }, async (tx) => {
      const { rows } = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      backend.resolve(rows[0]?.pid ?? 0);
      await confirmExits(tx, events, {
        tenant: 'psc',
        exits: [{ recordId: first?.id ?? '', exitDate: '2026-09-01' }],
        source: 'console',
        actor: { kind: 'user', id: 'officer-psc', name: null },
      });
    });
    await waitsForALock(backend.promise);
    commit.resolve(undefined);
    await Promise.all([count, exit]);

    expect(await summary()).toMatchObject({ expected: 2 });
    await expectSummaryExact();
  });

  it('is exact while an import runs: chunks, flags and exits meanwhile recount it', async () => {
    await givenCompletedImport();
    const ref = await givenImport(
      [
        'personnel_file_number,full_name,national_id',
        'PSC/1,Achieng Otieno,12345678',
        'PSC/5,Mary Wambui,45678901',
      ].join('\n'),
    );
    await stageImport(api.db, api.uploads, ref);

    await applyChunk(api.db, ref, 0);
    expect(await summary()).toMatchObject({ expected: 4, flagged: 0 });
    await expectSummaryExact();

    // An exit of a record the running import created.
    const mary = (await records()).find((record) => record.personnelFileNumber === 'PSC/5');
    await withTenant(api.db, { tenant: 'psc', subject: 'officer-psc' }, (tx) =>
      confirmExits(tx, events, {
        tenant: 'psc',
        exits: [{ recordId: mary?.id ?? '', exitDate: '2026-09-01' }],
        source: 'console',
        actor: { kind: 'user', id: 'officer-psc', name: null },
      }),
    );
    expect(await summary()).toMatchObject({ expected: 3, flagged: 0 });
    await expectSummaryExact();

    // PSC/2 and PSC/3 are not in the file.
    expect(await flagAbsent(api.db, ref)).toBe(2);
    expect(await summary()).toMatchObject({ expected: 3, flagged: 2 });
    await expectSummaryExact();
  });

  async function givenCompletedImport(): Promise<void> {
    const ref = await givenImport();
    await stageImport(api.db, api.uploads, ref);
    await applyChunk(api.db, ref, 0);
    await finaliseImport(api.db, events, ref, { state: 'completed' });
    expect(await summary()).toMatchObject({ expected: 3 });
  }

  /** The stored counts are what a full count of the records gives. */
  async function expectSummaryExact(): Promise<void> {
    const counts = ({
      expected,
      onboarded,
      flagged,
    }: Partial<typeof rosterSummaries.$inferSelect>) => ({ expected, onboarded, flagged });
    const stored = counts((await summary()) ?? {});
    await withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, (tx) =>
      recomputeRosterSummary(tx, 'psc'),
    );
    expect(stored).toEqual(counts((await summary()) ?? {}));
  }
});
