import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** What the stub payroll does with the next submissions. */
export type StubPayrollBehaviour =
  /** As the mock: stores the instruction (201) or answers the original (200). */
  | { kind: 'payroll' }
  /** Answers `status` without storing anything: payroll down. */
  | { kind: 'status'; status: number }
  /** Stores the instruction, then answers 503: payroll received it, the gateway never heard. */
  | { kind: 'store-then-fail' }
  /** Holds the request until the gateway gives up. */
  | { kind: 'hang' }
  /** Waits `ms` before answering as the mock. */
  | { kind: 'slow'; ms: number }
  /** Stores the instruction as the mock, but acknowledges it `pending`, without a reference yet. */
  | { kind: 'pending' };

/** external/payroll.yaml `Instruction`, as the Django mock (mocks/payroll) answers it. */
export interface StubInstruction {
  payroll_reference: string;
  instruction_reference: string;
  employer_code: string;
  personal_number: string;
  id_number: string;
  action: string;
  reason: string;
  effective_date: string;
  status: 'accepted';
  received_at: string;
}

/** One request the stub received: the path and the body as sent. */
export interface StubPayrollRequest {
  method: string;
  path: string;
  body: Record<string, unknown>;
}

const REQUIRED = [
  'instruction_reference',
  'employer_code',
  'personal_number',
  'id_number',
  'action',
  'reason',
  'effective_date',
] as const;

/**
 * Payroll (IPPD) on a local port, behaving as the Django mock (mocks/payroll): `submitInstruction`
 * stores an instruction once per instruction reference (201) and answers a resubmission with the
 * original (200). It records every request, so tests can tell how often payroll was called and
 * that personal data travelled in the body, never the URL.
 */
export class StubPayroll {
  readonly requests: StubPayrollRequest[] = [];
  readonly instructions = new Map<string, StubInstruction>();
  behaviour: StubPayrollBehaviour = { kind: 'payroll' };
  private readonly server: Server = createServer((request, response) => {
    void this.handle(request, response);
  });

  static async start(): Promise<StubPayroll> {
    const stub = new StubPayroll();
    stub.server.listen(0, '127.0.0.1');
    await once(stub.server, 'listening');
    return stub;
  }

  /** Ends before `/v1`, as `PAYROLL_BASE_URL`. */
  get baseUrl(): string {
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${String(port)}/payroll`;
  }

  get calls(): number {
    return this.requests.length;
  }

  reset(): void {
    this.requests.length = 0;
    this.instructions.clear();
    this.behaviour = { kind: 'payroll' };
  }

  async close(): Promise<void> {
    this.server.closeAllConnections();
    this.server.close();
    await once(this.server, 'close');
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    const body = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
    const path = request.url ?? '/';
    this.requests.push({ method: request.method ?? 'GET', path, body });

    if (request.method !== 'POST' || path !== '/payroll/v1/instructions') {
      send(response, 404, { detail: 'Not found.' });
      return;
    }
    const behaviour = this.behaviour;
    switch (behaviour.kind) {
      case 'status':
        send(response, behaviour.status, { detail: 'Injected' });
        return;
      case 'hang':
        return;
      case 'slow':
        await new Promise((resolve) => setTimeout(resolve, behaviour.ms));
        break;
      case 'store-then-fail':
        this.submit(body);
        send(response, 503, { detail: 'Injected after storing' });
        return;
      case 'payroll':
      case 'pending':
        break;
    }
    const missing = REQUIRED.filter((field) => typeof body[field] !== 'string' || !body[field]);
    if (missing.length > 0) {
      send(response, 400, Object.fromEntries(missing.map((f) => [f, ['This field is required.']])));
      return;
    }
    const { instruction, created } = this.submit(body);
    const answer =
      behaviour.kind === 'pending'
        ? { ...instruction, status: 'pending', payroll_reference: null, received_at: null }
        : instruction;
    send(response, created ? 201 : 200, answer);
  }

  private submit(body: Record<string, unknown>): {
    instruction: StubInstruction;
    created: boolean;
  } {
    const reference = String(body.instruction_reference);
    const existing = this.instructions.get(reference);
    if (existing) return { instruction: existing, created: false };
    const instruction: StubInstruction = {
      payroll_reference: randomUUID(),
      instruction_reference: reference,
      employer_code: String(body.employer_code),
      personal_number: String(body.personal_number),
      id_number: String(body.id_number),
      action: String(body.action),
      reason: String(body.reason),
      effective_date: String(body.effective_date),
      status: 'accepted',
      received_at: new Date().toISOString().replace('Z', '+00:00'),
    };
    this.instructions.set(reference, instruction);
    return { instruction, created: true };
  }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}
