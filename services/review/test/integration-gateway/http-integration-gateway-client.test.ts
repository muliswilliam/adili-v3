import { describe, expect, it, vi } from 'vitest';

import {
  HttpIntegrationGatewayClient,
  PAYROLL_LEGAL_BASIS,
} from '../../src/integration-gateway/http-integration-gateway-client.js';
import {
  IntegrationGatewayUnavailable,
  type PayrollInstructionRequest,
} from '../../src/integration-gateway/integration-gateway-client.js';
import { InternalApiRejected } from '../../src/internal-api/rejected.js';

/** S15 at the client seam: the payroll instruction as integration-gateway.yaml has it. */
describe('HttpIntegrationGatewayClient', () => {
  const instruction: PayrollInstructionRequest = {
    instructionReference: 'ADM-PSC-2026-0000003-7',
    employerCode: 'PSC',
    personalNumber: 'PSC/2019/0077',
    nationalId: '27451863',
    action: 'stop_salary',
    reason: 'Salary stoppage ADM-PSC-2026-0000003-7 under the Administrative Mechanisms',
    effectiveDate: '2026-02-16',
  };
  const acknowledged = {
    instructionReference: 'ADM-PSC-2026-0000003-7',
    action: 'stop_salary',
    status: 'accepted',
    payrollReference: '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f',
    receivedAt: '2026-02-16T08:00:01Z',
    sentAt: '2026-02-16T08:00:00Z',
  };

  const client = (fetch: typeof globalThis.fetch) =>
    new HttpIntegrationGatewayClient({
      gatewayUrl: 'http://gateway.test',
      tokens: { token: () => Promise.resolve('token'), invalidate: vi.fn() },
      fetch,
    });

  it('posts the instruction with the legal basis and the case, and answers the acknowledgement', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json(acknowledged, { status: 201 })),
    );

    const answer = await client(fetch).submitPayrollInstruction(instruction, {
      tenant: 'psc',
      caseRef: '0199b000-0000-7000-8000-0000000000e1',
    });

    expect(answer).toEqual(acknowledged);
    const request = fetch.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe('http://gateway.test/internal/v1/payroll/instructions');
    expect(request.method).toBe('POST');
    expect(await request.json()).toEqual(instruction);
    const headers = Object.fromEntries(request.headers);
    expect(headers).toMatchObject({
      authorization: 'Bearer token',
      'x-legal-basis': PAYROLL_LEGAL_BASIS,
      'x-case-ref': '0199b000-0000-7000-8000-0000000000e1',
    });
    // The gateway's payroll API acts for no tenant; the instruction names the employer.
    expect(headers).not.toHaveProperty('x-acting-tenant');
    expect(PAYROLL_LEGAL_BASIS).toBe('am-sanctions');
  });

  it('answers the stored acknowledgement for a replayed reference (200) and sends no case when there is none', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json(acknowledged, { status: 200 })),
    );

    expect(await client(fetch).submitPayrollInstruction(instruction, { tenant: 'psc' })).toEqual(
      acknowledged,
    );
    expect((fetch.mock.calls[0]?.[0] as Request).headers.has('x-case-ref')).toBe(false);
  });

  it('payroll unavailable (503), unreachable or answering outside the contract: unavailable, so the activity retries', async () => {
    const answers: (() => Promise<Response>)[] = [
      () => Promise.resolve(Response.json({ title: 'Unavailable' }, { status: 503 })),
      () => Promise.reject(new TypeError('fetch failed')),
      () => Promise.resolve(Response.json({ ...acknowledged, status: 'lost' }, { status: 201 })),
    ];
    for (const answer of answers) {
      const gateway = client(vi.fn<typeof globalThis.fetch>(answer));
      await expect(
        gateway.submitPayrollInstruction(instruction, { tenant: 'psc' }),
      ).rejects.toBeInstanceOf(IntegrationGatewayUnavailable);
    }
  });

  it('a refused instruction (400, e.g. no legal basis) is rejected, not retried', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json({ title: 'Bad Request' }, { status: 400 })),
    );

    await expect(
      client(fetch).submitPayrollInstruction(instruction, { tenant: 'psc' }),
    ).rejects.toBeInstanceOf(InternalApiRejected);
  });
});

/** The registry lookups, supplier check and stored results as integration-gateway.yaml has them. */
describe('HttpIntegrationGatewayClient: registries', () => {
  const caseRef = '0199b000-0000-7000-8000-0000000000e1';
  const context = { tenant: 'kemsa', legalBasis: 'regs-r20-1-b', caseRef } as const;
  const envelope = {
    resultId: '0199b000-0000-7000-8000-0000000000f1',
    system: 'ntsa',
    outcome: 'found',
    reason: null,
    cached: false,
    checkedAt: '2027-12-10T09:00:00.000Z',
  };
  const vehicles = [
    {
      registrationNumber: 'KDK 482M',
      make: 'Toyota',
      model: 'Land Cruiser Prado',
      yearOfManufacture: 2023,
      registeredOn: '2024-11-04',
    },
  ];

  const client = (fetch: typeof globalThis.fetch) =>
    new HttpIntegrationGatewayClient({
      gatewayUrl: 'http://gateway.test',
      tokens: { token: () => Promise.resolve('token'), invalidate: vi.fn() },
      fetch,
    });
  const answering = (body: unknown, status = 200) =>
    vi.fn<typeof globalThis.fetch>(() => Promise.resolve(Response.json(body, { status })));

  it('posts the national ID in the body, acting for the Commission with the legal basis and the case', async () => {
    const fetch = answering({ ...envelope, vehicles });

    const result = await client(fetch).lookupRegistry('ntsa', '27451863', context);

    expect(result).toEqual({ ...envelope, vehicles });
    const request = fetch.mock.calls[0]?.[0] as Request;
    expect(request.method).toBe('POST');
    expect(request.url).toBe('http://gateway.test/internal/v1/ntsa/vehicle-lookups');
    expect(await request.json()).toEqual({ nationalId: '27451863' });
    expect(Object.fromEntries(request.headers)).toMatchObject({
      authorization: 'Bearer token',
      'x-acting-tenant': 'kemsa',
      'x-legal-basis': 'regs-r20-1-b',
      'x-case-ref': caseRef,
    });
  });

  it.each([
    ['kra', 'taxpayer-lookups', { taxpayers: [] }],
    ['brs', 'directorship-lookups', { directorships: [] }],
    ['ardhisasa', 'parcel-lookups', { parcels: [] }],
  ] as const)('%s: posts to its own lookup', async (system, path, records) => {
    const fetch = answering({ ...envelope, system, outcome: 'not-found', ...records });

    await client(fetch).lookupRegistry(system, '27451863', context);

    expect((fetch.mock.calls[0]?.[0] as Request).url).toBe(
      `http://gateway.test/internal/v1/${system}/${path}`,
    );
  });

  it('answers a registry that gave no answer as unavailable, not as an error', async () => {
    const answer = { ...envelope, outcome: 'unavailable', reason: 'breaker-open', vehicles: [] };

    expect(await client(answering(answer)).lookupRegistry('ntsa', '27451863', context)).toEqual(
      answer,
    );
  });

  it('an unrecorded lookup (503 lookup-not-recorded), no answer or an answer outside the contract: unavailable, so the check looks up again', async () => {
    const answers = [
      answering({ type: 'lookup-not-recorded', title: 'Lookup not recorded', status: 503 }, 503),
      vi.fn<typeof globalThis.fetch>(() => Promise.reject(new TypeError('fetch failed'))),
      answering({ ...envelope, vehicles: [{ registrationNumber: 'KDK 482M' }] }),
    ];
    for (const fetch of answers) {
      await expect(
        client(fetch).lookupRegistry('ntsa', '27451863', context),
      ).rejects.toBeInstanceOf(IntegrationGatewayUnavailable);
    }
  });

  it('a refused lookup (400 legal basis, 403 scope) is rejected', async () => {
    for (const status of [400, 403]) {
      await expect(
        client(answering({ title: 'Refused' }, status)).lookupRegistry('kra', '1', context),
      ).rejects.toBeInstanceOf(InternalApiRejected);
    }
  });

  it('checks a company against the employer supplier list, with the number in the path', async () => {
    const fetch = answering({ ...envelope, system: 'brs', supplies: true });

    const result = await client(fetch).checkSupplier('PVT-9XYZ2L4Q', 'KEMSA', context);

    expect(result.supplies).toBe(true);
    const request = fetch.mock.calls[0]?.[0] as Request;
    expect(request.method).toBe('GET');
    expect(request.url).toBe(
      'http://gateway.test/internal/v1/brs/companies/PVT-9XYZ2L4Q/supplies?employerCode=KEMSA',
    );
    expect(request.headers.get('x-legal-basis')).toBe('regs-r20-1-b');
  });

  it('reads a stored result for the Commission; null when the gateway has none for it', async () => {
    const stored = {
      resultId: envelope.resultId,
      system: 'ntsa',
      outcome: 'found',
      checkedAt: envelope.checkedAt,
      legalBasis: 'regs-r20-1-b',
      caseRef,
      payload: { vehicles },
    };
    const fetch = answering(stored);

    expect(await client(fetch).getStoredResult(envelope.resultId, 'kemsa')).toEqual(stored);
    const request = fetch.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe(
      `http://gateway.test/internal/v1/verification-results/${envelope.resultId}`,
    );
    expect(request.headers.get('x-acting-tenant')).toBe('kemsa');

    expect(
      await client(answering({ title: 'Not Found' }, 404)).getStoredResult(envelope.resultId, 'x'),
    ).toBeNull();
    await expect(
      client(answering({ type: 'upstream-unavailable' }, 503)).getStoredResult(
        envelope.resultId,
        'kemsa',
      ),
    ).rejects.toBeInstanceOf(IntegrationGatewayUnavailable);
  });
});
