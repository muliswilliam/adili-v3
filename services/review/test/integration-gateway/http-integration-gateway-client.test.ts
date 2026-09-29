import { describe, expect, it, vi } from 'vitest';

import {
  HttpIntegrationGatewayClient,
  PAYROLL_LEGAL_BASIS,
} from '../../src/integration-gateway/http-integration-gateway-client.js';
import {
  IntegrationGatewayUnavailable,
  type PayrollInstructionRequest,
} from '../../src/integration-gateway/integration-gateway-client.js';
import { InternalApiRejected } from '../../src/internal-api/internal-api.js';

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

  it('posts the instruction with the legal basis, the acting Commission and the case, and answers the acknowledgement', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json(acknowledged, { status: 201 })),
    );

    const answer = await client(fetch).submitPayrollInstruction(instruction, {
      tenant: 'psc',
      caseRef: '0199b000-0000-7000-8000-0000000000e1',
    });

    expect(answer).toEqual(acknowledged);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect((url as URL).href).toBe('http://gateway.test/internal/v1/payroll/instructions');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual(instruction);
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer token',
      'x-acting-tenant': 'psc',
      'x-legal-basis': PAYROLL_LEGAL_BASIS,
      'x-case-ref': '0199b000-0000-7000-8000-0000000000e1',
    });
    expect(PAYROLL_LEGAL_BASIS).toBe('am-sanctions');
  });

  it('answers the stored acknowledgement for a replayed reference (200) and sends no case when there is none', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json(acknowledged, { status: 200 })),
    );

    expect(await client(fetch).submitPayrollInstruction(instruction, { tenant: 'psc' })).toEqual(
      acknowledged,
    );
    expect(fetch.mock.calls[0]?.[1]?.headers).not.toHaveProperty('x-case-ref');
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
