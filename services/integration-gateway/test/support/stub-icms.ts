import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** What the stub ICMS does with the next submissions. */
export type StubIcmsBehaviour =
  /** As the mock: registers the referral (201) or answers the original (200). */
  | { kind: 'icms' }
  /** Answers `status` without registering anything: ICMS down. */
  | { kind: 'status'; status: number }
  /** Registers the referral, then answers 503: ICMS has it, the gateway never heard. */
  | { kind: 'store-then-fail' }
  /** Holds the request until the gateway gives up. */
  | { kind: 'hang' }
  /** Waits `ms` before answering as the mock. */
  | { kind: 'slow'; ms: number };

/** external/icms.yaml `Referral`, as the Django mock (mocks/icms) answers it. */
export interface StubReferral {
  case_number: string;
  referral_reference: string;
  id_number: string;
  full_name: string;
  referring_commission: string;
  grounds: string;
  details: string;
  status: 'registered';
  registered_at: string;
}

/** One request the stub received: the path and the body as sent. */
export interface StubIcmsRequest {
  method: string;
  path: string;
  body: Record<string, unknown>;
}

const REQUIRED = [
  'referral_reference',
  'id_number',
  'full_name',
  'referring_commission',
  'grounds',
] as const;

/**
 * EACC's ICMS on a local port, behaving as the Django mock (mocks/icms): `submitReferral`
 * registers a referral once per referral reference with the next case number (201) and answers a
 * resubmission with the original (200). It records every request, so tests can tell how often
 * ICMS was called and that personal data travelled in the body, never the URL.
 */
export class StubIcms {
  readonly requests: StubIcmsRequest[] = [];
  readonly referrals = new Map<string, StubReferral>();
  behaviour: StubIcmsBehaviour = { kind: 'icms' };
  private readonly server: Server = createServer((request, response) => {
    void this.handle(request, response);
  });

  static async start(): Promise<StubIcms> {
    const stub = new StubIcms();
    stub.server.listen(0, '127.0.0.1');
    await once(stub.server, 'listening');
    return stub;
  }

  /** Ends before `/v1`, as `ICMS_BASE_URL`. */
  get baseUrl(): string {
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${String(port)}/icms`;
  }

  get calls(): number {
    return this.requests.length;
  }

  reset(): void {
    this.requests.length = 0;
    this.referrals.clear();
    this.behaviour = { kind: 'icms' };
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

    if (request.method !== 'POST' || path !== '/icms/v1/referrals') {
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
        this.register(body);
        send(response, 503, { detail: 'Injected after registering' });
        return;
      case 'icms':
        break;
    }
    const missing = REQUIRED.filter((field) => typeof body[field] !== 'string' || !body[field]);
    if (missing.length > 0) {
      send(response, 400, Object.fromEntries(missing.map((f) => [f, ['This field is required.']])));
      return;
    }
    const { referral, created } = this.register(body);
    send(response, created ? 201 : 200, referral);
  }

  private register(body: Record<string, unknown>): { referral: StubReferral; created: boolean } {
    const reference = String(body.referral_reference);
    const existing = this.referrals.get(reference);
    if (existing) return { referral: existing, created: false };
    const year = new Date().getUTCFullYear();
    const referral: StubReferral = {
      case_number: `EACC/ICMS/${String(year)}/${String(this.referrals.size + 1).padStart(6, '0')}`,
      referral_reference: reference,
      id_number: String(body.id_number),
      full_name: String(body.full_name),
      referring_commission: String(body.referring_commission),
      grounds: String(body.grounds),
      details: typeof body.details === 'string' ? body.details : '',
      status: 'registered',
      registered_at: new Date().toISOString().replace('Z', '+00:00'),
    };
    this.referrals.set(reference, referral);
    return { referral, created: true };
  }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}
