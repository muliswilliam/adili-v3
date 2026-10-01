import type { Principal } from '@adili/api-kit';
import { ProblemException, PLATFORM_TENANT } from '@adili/api-kit';
import { withTenant } from '@adili/data-access';
import type { Client, WorkflowStartOptions } from '@temporalio/client';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { rosterImportBatches, rosterImports } from '../../src/db/schema.js';
import { RosterImportsService } from '../../src/roster/import/imports.service.js';
import { type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';
import { givenCommissions } from '../support/fixtures.js';

/**
 * How starting an import hands it to its workflow (spec #27), with Temporal's client stubbed so
 * the start can be observed and made to fail: the workflow only ever sees a committed import,
 * and no import is left pending without one.
 */
const OFFICER: Principal = {
  subject: 'officer-psc',
  tenant: 'psc',
  roles: ['reporting-officer'],
  scopes: [],
  clientId: 'console',
  name: 'Fatuma Wanjiru',
  issuedAt: null,
  personId: null,
  acr: null,
  authTime: null,
  tokenId: null,
};
const ROWS = [{ personnelFileNumber: 'PSC/1', fullName: 'Achieng Otieno', nationalId: '12345678' }];

let api: DirectoryApi;

beforeAll(async () => {
  api = await startDirectoryApi();
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

const imports = () => asPlatform((tx) => tx.select().from(rosterImports));
const batches = () => asPlatform((tx) => tx.select().from(rosterImportBatches));

/** The service over a stubbed Temporal client whose `start` runs `onStart`. */
function serviceStartingWith(onStart: (options: WorkflowStartOptions) => Promise<void>) {
  const starts: WorkflowStartOptions[] = [];
  const temporal = {
    workflow: {
      start: async (_type: string, options: WorkflowStartOptions) => {
        starts.push(options);
        await onStart(options);
      },
    },
  } as unknown as Client;
  return { service: new RosterImportsService(api.db, api.uploads, temporal), starts };
}

describe('starting an import', () => {
  it('starts its workflow only once the import (and its batch) has committed', async () => {
    const seen: { imports: number; batches: number }[] = [];
    const { service } = serviceStartingWith(async () => {
      // Another connection, as the worker's activities would read it.
      seen.push({ imports: (await imports()).length, batches: (await batches()).length });
    });

    const started = await service.startBatch(OFFICER, 'psc', { channel: 'api', rows: ROWS });

    expect(started.state).toBe('pending');
    expect(seen).toEqual([{ imports: 1, batches: 1 }]);
  });

  it('withdraws the import when its workflow cannot start, so the next import can start', async () => {
    let fail = true;
    const { service } = serviceStartingWith(() => {
      if (fail) {
        fail = false;
        return Promise.reject(new Error('Temporal unavailable'));
      }
      return Promise.resolve();
    });

    const refused = await service
      .startBatch(OFFICER, 'psc', { channel: 'api', rows: ROWS })
      .catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(ProblemException);
    expect((refused as ProblemException).getStatus()).toBe(503);
    expect(await imports()).toEqual([]);
    expect(await batches()).toEqual([]);
    const next = await service.startBatch(OFFICER, 'psc', { channel: 'api', rows: ROWS });
    expect(next.state).toBe('pending');
  });

  it('keeps an import whose workflow picked it up although the start reported a failure', async () => {
    const { service } = serviceStartingWith(async (options) => {
      await asPlatform((tx) =>
        tx
          .update(rosterImports)
          .set({ state: 'processing' })
          .where(eq(rosterImports.id, options.workflowId)),
      );
      throw new Error('deadline exceeded');
    });

    const started = await service.startBatch(OFFICER, 'psc', { channel: 'api', rows: ROWS });

    expect(started.state).toBe('processing');
    expect(await imports()).toHaveLength(1);
  });

  it('starts the workflow of an import left pending when the next import runs into it', async () => {
    const [stranded] = await asPlatform((tx) =>
      tx
        .insert(rosterImports)
        .values({
          tenant: 'psc',
          channel: 'api',
          declaredComplete: false,
          format: 'json',
          startedByKind: 'user',
          startedBy: 'officer-psc',
        })
        .returning(),
    );
    const { service, starts } = serviceStartingWith(() => Promise.resolve());

    const refused = await service
      .startBatch(OFFICER, 'psc', { channel: 'api', rows: ROWS })
      .catch((error: unknown) => error);

    expect((refused as ProblemException).getStatus()).toBe(409);
    expect(starts).toEqual([
      expect.objectContaining({
        workflowId: stranded?.id,
        workflowIdConflictPolicy: 'USE_EXISTING',
        args: [{ importId: stranded?.id, tenant: 'psc' }],
      }),
    ]);
  });
});
