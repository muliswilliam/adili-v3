import { randomUUID } from 'node:crypto';

import { allocateReference, ARQ } from '@adili/numbering';
import { type WorkflowHandle, WorkflowNotFoundError } from '@temporalio/client';
import { sql } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { TRANSACTION_OPEN } from '../../src/activity-retry.js';
import { leaRequestWorkflowId } from '../../src/lea/contract.js';
import { LeaRequestWorkflows } from '../../src/lea/lea-workflows.js';
import { accessRequestWorkflowId } from '../../src/requests/contract.js';
import { AccessRequestWorkflows } from '../../src/requests/request-workflows.js';
import { type AccessApi, startAccessApi } from '../support/access-api.js';
import { givenLeaOfficers, LEA_INPUT, leaCallers, submitLeaResponse } from '../support/lea.js';
import { callers, COMPLETE, givenCommissions, submitRequest } from '../support/requests.js';

const NOW = '2027-03-04T09:00:00.000Z';

/**
 * The access workflows start inside the transaction that receives their request, before it
 * commits and before the reference counter is locked (workflow-control.ts): the run's first read
 * waits for that transaction to end, follows a committed request, and ends at once when the
 * receipt rolled back.
 */
describe('Workflows started in the receiving transaction', () => {
  let api: AccessApi;

  beforeAll(async () => {
    api = await startAccessApi();
    return () => api.close();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await api.reset();
  });

  /** Runs `work` with every insert into the outbox (the last write of a receipt) failing. */
  async function withOutboxRefused(work: () => Promise<void>): Promise<void> {
    const trigger = `${api.pgSchema}.access_test_refuse_outbox`;
    await api.db.execute(
      sql.raw(`create function ${trigger}() returns trigger language plpgsql as $$
        begin raise exception 'outbox refused'; end; $$`),
    );
    await api.db.execute(
      sql.raw(`create trigger refuse_outbox before insert on ${api.pgSchema}.outbox
        for each row execute function ${trigger}()`),
    );
    try {
      await work();
    } finally {
      await api.db.execute(sql.raw(`drop trigger refuse_outbox on ${api.pgSchema}.outbox`));
      await api.db.execute(sql.raw(`drop function ${trigger}()`));
    }
  }

  /**
   * The workflow's first activity, once it has been retried. The spy on `start` sees the call
   * before Temporal has the run, so a run not found yet is waited for like one not retried yet.
   */
  async function retriedFirstRead(handle: WorkflowHandle) {
    return api.eventually(async () => {
      const run = await handle.describe().catch((error: unknown) => {
        if (error instanceof WorkflowNotFoundError) return undefined;
        throw error;
      });
      const pending = run?.raw.pendingActivities?.[0];
      return pending && (pending.attempt ?? 0) >= 2 ? pending : undefined;
    });
  }

  it('AccessRequestWorkflow starts before the reference counter is locked, and its first read waits for the commit', async () => {
    givenCommissions(api, NOW);
    // The PSC's 2027 counter exists; another transaction now holds it.
    await submitRequest(api);
    const start = vi.spyOn(api.app.get(AccessRequestWorkflows), 'start');
    let release = (): void => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked = (): void => undefined;
    const counterLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const holding = api
      .asTenant({ tenant: 'psc', subject: 'test' }, async (tx) => {
        await allocateReference(tx, ARQ, { issuer: 'PSC', period: 2027 });
        locked();
        await released;
        throw new Error('Released without using the number');
      })
      .catch(() => undefined);
    await counterLocked;

    const submitting = submitRequest(api);
    const readRequestId = () => start.mock.calls[0]?.[0].requestId ?? '';
    const getRunHandle = () =>
      api.temporal.workflow.getHandle(accessRequestWorkflowId(readRequestId()));
    try {
      await api.eventually(() => start.mock.calls.length === 1);

      // The receipt waits on the counter, uncommitted: the run's first read is retried meanwhile.
      const pending = await retriedFirstRead(getRunHandle());
      expect(pending.activityType?.name).toBe('requestState');
      expect(pending.lastFailure?.applicationFailureInfo?.type).toBe(TRANSACTION_OPEN);
    } finally {
      // Never leave the counter locked: the receipt and every later test would wait on it.
      release();
      await holding;
    }
    expect((await submitting).id).toBe(readRequestId());
    // Committed: the run read it and waits for the officer named, as for any request.
    await api.eventually(async () => {
      const run = await getRunHandle().describe();
      return run.status.name === 'RUNNING' && (run.raw.pendingActivities ?? []).length === 0;
    });
  });

  it('AccessRequestWorkflow ends as missing at once when the receipt rolls back after the start', async () => {
    givenCommissions(api, NOW);
    const start = vi.spyOn(api.app.get(AccessRequestWorkflows), 'start');

    await withOutboxRefused(async () => {
      const response = await api.send('POST', '/v1/access/requests', callers.mercy, COMPLETE, {
        'idempotency-key': randomUUID(),
      });
      expect(response.statusCode).toBe(500);
    });

    expect(start).toHaveBeenCalledTimes(1);
    const requestId = start.mock.calls[0]?.[0].requestId ?? '';
    const handle = api.temporal.workflow.getHandle(accessRequestWorkflowId(requestId));
    expect(await handle.result()).toEqual({ outcome: 'missing' });
  });

  it('LeaRequestWorkflow ends as missing at once when the receipt rolls back after the start', async () => {
    givenCommissions(api, NOW);
    givenLeaOfficers(api);
    const start = vi.spyOn(api.app.get(LeaRequestWorkflows), 'start');

    await withOutboxRefused(async () => {
      const response = await submitLeaResponse(api, LEA_INPUT, leaCallers.peter);
      expect(response.statusCode).toBe(500);
    });

    expect(start).toHaveBeenCalledTimes(1);
    const requestId = start.mock.calls[0]?.[0].requestId ?? '';
    const handle = api.temporal.workflow.getHandle(leaRequestWorkflowId(requestId));
    expect(await handle.result()).toEqual({ outcome: 'missing' });
  });
});
