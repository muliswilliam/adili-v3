import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** What the stub answers for the next requests. */
export type StubBehaviour =
  | { kind: 'registry' }
  | { kind: 'status'; status: number }
  | { kind: 'hang' }
  | { kind: 'malformed' };

/** A person as the IPRS mock returns it (snake_case, external/iprs.yaml `Person`). */
export interface StubPerson {
  id_number: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  date_of_birth: string;
  sex: 'F' | 'M';
  place_of_birth: string;
  date_of_issue: string;
}

/**
 * An HTTP stand-in for IPRS that counts calls and can fail on demand, so tests can tell cache
 * hits from registry calls and drive the circuit breaker.
 */
export class StubIprs {
  readonly people = new Map<string, StubPerson>();
  calls = 0;
  behaviour: StubBehaviour = { kind: 'registry' };
  private readonly server: Server;
  private readonly hanging = new Set<() => void>();

  private constructor() {
    this.server = createServer((request, response) => {
      this.calls += 1;
      const behaviour = this.behaviour;
      if (behaviour.kind === 'hang') {
        // Answers only when the test closes, long after the gateway's timeout.
        this.hanging.add(() => response.destroy());
        return;
      }
      if (behaviour.kind === 'status') {
        response.writeHead(behaviour.status, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ title: 'Injected', status: behaviour.status }));
        return;
      }
      if (behaviour.kind === 'malformed') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ id_number: '1' }));
        return;
      }
      const match = /^\/v1\/persons\/([^/]+)$/.exec(request.url ?? '');
      const person = match?.[1] ? this.people.get(decodeURIComponent(match[1])) : undefined;
      if (!person) {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ detail: 'No Person matches the given query.' }));
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(person));
    });
  }

  static async start(): Promise<StubIprs> {
    const stub = new StubIprs();
    stub.server.listen(0, '127.0.0.1');
    await once(stub.server, 'listening');
    return stub;
  }

  get baseUrl(): string {
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  reset(): void {
    this.calls = 0;
    this.behaviour = { kind: 'registry' };
    this.people.clear();
  }

  async close(): Promise<void> {
    for (const release of this.hanging) release();
    this.server.closeAllConnections();
    this.server.close();
    await once(this.server, 'close');
  }
}
