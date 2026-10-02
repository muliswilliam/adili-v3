import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { DirectoryUnavailable } from '../../src/directory/directory-client.js';
import { HttpDirectoryClient } from '../../src/directory/http-directory-client.js';

/**
 * The directory client against answers that conform to the directory's committed contract
 * (checked here), so the boundary validation accepts everything the directory may send.
 */
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
const contract = createRequire(import.meta.url).resolve('@adili/schemas/internal/directory.yaml');
ajv.addSchema(parse(readFileSync(contract, 'utf8')) as object, 'directory.yaml');

function conforming(schema: string, body: unknown): unknown {
  const validate = ajv.getSchema(`directory.yaml#/components/schemas/${schema}`);
  if (!validate) throw new Error(`no ${schema}`);
  expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
  return body;
}

const record = (state: string, overrides: Record<string, unknown> = {}) => ({
  id: '01a0e950-c833-75dd-bee2-465ead0dc3f4',
  tenant: 'psc',
  personnelFileNumber: 'PSC/2018/0702',
  fullName: 'Amina Halima Hassan',
  designation: 'Legal Officer',
  jobGroup: 'K',
  reportingEntity: null,
  workStation: 'Ardhi House, Nairobi',
  maritalStatus: 'married',
  employerCode: null,
  state,
  appointmentDate: '2018-01-08',
  exitDate: null,
  personId: null,
  ofr: null,
  onboardedAt: null,
  updatedAt: '2026-09-28T18:42:50.371Z',
  ...overrides,
});

function clientAnswering(respond: (url: URL, token: string | null) => Response) {
  const requests: { url: URL; actingTenant: string | null }[] = [];
  let tokens = 0;
  const client = new HttpDirectoryClient({
    directoryUrl: 'http://directory.test',
    tokens: {
      token: () => Promise.resolve(`token-${String(++tokens)}`),
      invalidate: () => undefined,
    },
    fetch: (input: string | URL | Request) => {
      const request = input as Request;
      const url = new URL(request.url);
      requests.push({ url, actingTenant: request.headers.get('x-acting-tenant') });
      return Promise.resolve(respond(url, request.headers.get('authorization')));
    },
  });
  return { client, requests };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('HttpDirectoryClient', () => {
  it('reads a page of records in every state the directory has, acting for the Commission', async () => {
    const page = conforming('InternalRosterRecordPage', {
      items: [
        record('not_onboarded'),
        record('onboarded', {
          personId: '7d3f9b2a-4c1e-4a8b-9f60-2e5d8c1b0a47',
          ofr: 'OFR-0482913-L',
          onboardedAt: '2026-09-28T18:50:00.000Z',
        }),
        record('exited', { exitDate: '2026-09-01' }),
      ],
      nextCursor: 'abc',
    });
    const { client, requests } = clientAnswering(() => json(page));

    const result = await client.listRosterRecords('psc', { importId: 'imp' }, null);

    expect(result.items.map((item) => item.state)).toEqual([
      'not_onboarded',
      'onboarded',
      'exited',
    ]);
    expect(result.nextCursor).toBe('abc');
    // The HR fields bio pre-fill reads (spec 05b).
    expect(result.items[0]).toMatchObject({
      jobGroup: 'K',
      workStation: 'Ardhi House, Nairobi',
      maritalStatus: 'married',
    });
    expect(requests[0]?.url.pathname).toBe('/internal/v1/commissions/psc/roster/records');
    expect(requests[0]?.url.searchParams.get('importId')).toBe('imp');
    expect(requests[0]?.actingTenant).toBe('psc');
  });

  it('reads the policy and the Commission', async () => {
    const policy = conforming('TenantPolicyVersion', {
      id: '01a0e950-c833-75dd-bee2-465ead0dc3f5',
      version: 2,
      effectiveFrom: '2026-09-28T18:00:00.000Z',
      obligationsStartDate: '2018-01-01',
      initialDueAfterAppointmentDays: 30,
      biennial: { statementDate: '11-01', dueDate: '12-31' },
      finalDueAfterExitDays: 30,
      reminderOffsetsDays: [30, 14, 7],
      clarification: { issueWindowMonths: 6, replyWindowDays: 30 },
      formMDue: '07-31',
      access: {
        decisionDays: 30,
        leaDecisionDays: 14,
        representationWindowDays: 7,
        packageDownloadDays: 7,
      },
      createdBy: 'sub',
      createdByName: null,
      createdAt: '2026-09-28T18:00:00.000Z',
    });
    const commission = conforming('InternalCommission', {
      slug: 'psc',
      issuerCode: 'PSC',
      name: 'Public Service Commission',
    });
    const { client } = clientAnswering((url) =>
      json(url.pathname.endsWith('/policy') ? policy : commission),
    );

    await expect(client.getPolicy('psc')).resolves.toMatchObject({ version: 2 });
    await expect(client.getCommission('psc')).resolves.toEqual(commission);
  });

  it('lists every Commission, acting for no tenant', async () => {
    const listed = { status: 'active', obligationsStartDate: '2025-07-01' };
    const list = conforming('InternalCommissionList', {
      items: [
        { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission', ...listed },
        { slug: 'tsc', issuerCode: 'TSC', name: 'Teachers Service Commission', ...listed },
      ],
    });
    const { client, requests } = clientAnswering(() => json(list));

    await expect(client.listCommissions()).resolves.toEqual([
      { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
      { slug: 'tsc', issuerCode: 'TSC', name: 'Teachers Service Commission' },
    ]);
    expect(requests[0]?.url.pathname).toBe('/internal/v1/commissions');
    expect(requests[0]?.actingTenant).toBeNull();
  });

  it('gives null for a record the Commission does not have', async () => {
    const { client } = clientAnswering(() => json({ title: 'Not Found', status: 404 }, 404));

    await expect(client.getRosterRecord('psc', 'x')).resolves.toBeNull();
  });

  it('retries once with a fresh token after a 401', async () => {
    const { client, requests } = clientAnswering((_url, token) =>
      token === 'Bearer token-1'
        ? json({}, 401)
        : json({ slug: 'psc', issuerCode: 'PSC', name: 'P' }),
    );

    await expect(client.getCommission('psc')).resolves.toMatchObject({ slug: 'psc' });
    expect(requests).toHaveLength(2);
  });

  it('is unavailable on other statuses and on answers outside the contract', async () => {
    const down = clientAnswering(() => json({}, 503)).client;
    const garbled = clientAnswering(() => json({ items: [{ id: 1 }], nextCursor: null })).client;

    await expect(down.getPolicy('psc')).rejects.toBeInstanceOf(DirectoryUnavailable);
    await expect(garbled.listRosterRecords('psc', { importId: 'i' }, null)).rejects.toBeInstanceOf(
      DirectoryUnavailable,
    );
  });
});
