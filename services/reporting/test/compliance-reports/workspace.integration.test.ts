import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { complianceReportWorkflowId } from '../../src/compliance-reports/contract.js';
import { complianceReports } from '../../src/db/schema.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { clarificationEvent, obligationCreated } from '../support/events.js';
import {
  COMMISSION_ADMIN,
  compiledReport,
  givenPscDirectory,
  REPORTING_OFFICER,
  SUPERVISOR,
} from '../support/form-m-facts.js';
import { type Caller, type ReportingApi, startReportingApi } from '../support/reporting-api.js';

/**
 * The Form M workspace's periods, and the authorisation matrix rows for reading and compiling
 * (spec 09): the Commission's supervisor compiles; its commission-admin and reporting officer
 * read; anyone else, another Commission's staff and EACC included, gets 404.
 */
describe('Form M workspace: periods and access', () => {
  let api: ReportingApi;

  beforeAll(async () => {
    api = await startReportingApi();
  });

  afterAll(async () => {
    await endWorkflow();
    await api.close();
  });

  beforeEach(async () => {
    await endWorkflow();
    await api.reset();
    givenPscDirectory(api);
  });

  async function endWorkflow() {
    try {
      await api.temporal.workflow.getHandle(complianceReportWorkflowId('psc', 2027)).terminate();
    } catch {
      // Not running.
    }
  }

  const PERIODS = '/v1/commissions/psc/compliance-reports';

  it('lists the financial years with facts or a report, and the current and previous years, newest first', async () => {
    await api.deliver(obligationCreated('psc', { type: 'initial', statementDate: '2026-03-01' }));
    await api.deliver(
      clarificationEvent(
        'psc',
        'issued',
        { clarificationId: randomUUID(), caseId: randomUUID() },
        '2027-12-01T09:00:00.000Z',
      ),
    );
    await api.asPlatform((tx) =>
      tx.insert(complianceReports).values({
        id: randomUUID(),
        tenant: 'psc',
        fy: 2027,
        status: 'draft',
        compiledAt: new Date('2028-04-02T06:00:00.000Z'),
      }),
    );
    api.clock.set('2028-05-10T06:00:00.000Z');

    const response = await api.get(PERIODS, REPORTING_OFFICER);

    expect(response.statusCode).toBe(200);
    expect(
      contractErrors(
        okResponse('/v1/commissions/{slug}/compliance-reports', 'get'),
        response.json(),
      ),
    ).toEqual([]);
    expect(response.json()).toEqual([
      {
        fy: 2027,
        status: 'draft',
        dueDate: '2028-07-31',
        reference: null,
        submittedAt: null,
        late: null,
        previewAvailable: true,
      },
      {
        fy: 2026,
        status: 'not-started',
        dueDate: '2027-07-31',
        reference: null,
        submittedAt: null,
        late: null,
        previewAvailable: true,
      },
      {
        fy: 2025,
        status: 'not-started',
        dueDate: '2026-07-31',
        reference: null,
        submittedAt: null,
        late: null,
        previewAvailable: true,
      },
    ]);
  });

  it('marks a submitted year and a year whose preview has not opened', async () => {
    await api.asPlatform((tx) =>
      tx.insert(complianceReports).values({
        id: randomUUID(),
        tenant: 'psc',
        fy: 2026,
        status: 'submitted',
        reference: 'RPT-PSC-2026-0000001-9',
        submittedAt: new Date('2027-08-05T09:00:00.000Z'),
        late: true,
      }),
    );
    api.clock.set('2028-03-31T06:00:00.000Z');

    const response = await api.get(PERIODS, SUPERVISOR);

    expect(response.json()).toEqual([
      expect.objectContaining({ fy: 2027, status: 'not-started', previewAvailable: false }),
      {
        fy: 2026,
        status: 'submitted',
        dueDate: '2027-07-31',
        reference: 'RPT-PSC-2026-0000001-9',
        submittedAt: '2027-08-05T09:00:00.000Z',
        late: true,
        previewAvailable: false,
      },
    ]);
  });

  it('opens the preview on 1 April after the year: before it a compile is 409 preview-not-available', async () => {
    // 31 March 23:30 in Nairobi is still before 1 April.
    api.clock.set('2028-03-31T20:30:00.000Z');
    const early = await api.send('POST', `${PERIODS}/2027/compile`, SUPERVISOR);
    expect(early.statusCode).toBe(409);
    expect(early.json()).toMatchObject({ code: 'preview-not-available' });

    api.clock.set('2028-03-31T21:00:00.000Z');
    const preview = await api.send('POST', `${PERIODS}/2027/compile`, SUPERVISOR);
    expect(preview.statusCode).toBe(202);
    await compiledReport(api, 2027);
  });

  it('answers 404 for a year without a report and 400 for a year before reports exist', async () => {
    api.clock.set('2028-07-01T06:00:00.000Z');

    expect((await api.get(`${PERIODS}/2027`, SUPERVISOR)).statusCode).toBe(404);
    expect((await api.get(`${PERIODS}/2024`, SUPERVISOR)).statusCode).toBe(400);
    expect((await api.send('POST', `${PERIODS}/2024/compile`, SUPERVISOR)).statusCode).toBe(400);
  });

  describe('authorisation: preview/compile and read draft', () => {
    beforeEach(async () => {
      api.clock.set('2028-07-01T06:00:00.000Z');
      await api.send('POST', `${PERIODS}/2027/compile`, SUPERVISOR);
      await compiledReport(api, 2027);
    });

    it.each([
      ['supervisor', SUPERVISOR],
      ['commission-admin', COMMISSION_ADMIN],
      ['reporting-officer', REPORTING_OFFICER],
    ])('the Commission %s reads the periods and the draft', async (_role, caller) => {
      expect((await api.get(PERIODS, caller)).statusCode).toBe(200);
      const draft = await api.get(`${PERIODS}/2027`, caller);
      expect(draft.statusCode).toBe(200);
      expect(draft.json()).toMatchObject({
        status: 'draft',
        document: { schemaVersion: 'form-m.v1' },
      });
    });

    it.each([
      ['commission-admin', COMMISSION_ADMIN],
      ['reporting-officer', REPORTING_OFFICER],
    ])('the Commission %s cannot compile: 403', async (_role, caller) => {
      expect((await api.send('POST', `${PERIODS}/2027/compile`, caller)).statusCode).toBe(403);
    });

    const outsiders: [string, Caller][] = [
      ['a reviewer of the Commission', { tenant: 'psc', roles: ['reviewer'] }],
      ['a helpdesk agent of the Commission', { tenant: 'psc', roles: ['helpdesk'] }],
      ["another Commission's supervisor", { tenant: 'tsc', roles: ['supervisor'] }],
      ['an EACC analyst', { tenant: 'eacc', roles: ['eacc-analyst'] }],
      ['a platform admin', { tenant: 'platform', roles: ['platform-admin'] }],
      ['a declarant', { tenant: null, roles: ['declarant'] }],
    ];

    it.each(outsiders)('%s gets 404 on periods, draft and compile', async (_who, caller) => {
      expect((await api.get(PERIODS, caller)).statusCode).toBe(404);
      expect((await api.get(`${PERIODS}/2027`, caller)).statusCode).toBe(404);
      expect((await api.send('POST', `${PERIODS}/2027/compile`, caller)).statusCode).toBe(404);
    });
  });
});
