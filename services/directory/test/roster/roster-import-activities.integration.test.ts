import { withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PLATFORM_TENANT } from '../../src/commissions/access.js';
import { outbox, rosterImportRows, rosterImports, rosterRecords } from '../../src/db/schema.js';
import { applyChunk } from '../../src/roster/import/apply-chunk.js';
import { finaliseImport } from '../../src/roster/import/finalise.js';
import { flagAbsent } from '../../src/roster/import/flag-absent.js';
import { DocumentsUnavailable } from '../../src/roster/import/roster-uploads.js';
import { stageImport } from '../../src/roster/import/staging.js';
import type { ImportRef } from '../../src/roster/import/workflow-contract.js';
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
});

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
