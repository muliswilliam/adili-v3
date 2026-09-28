import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { ServiceTokenError } from '@adili/api-kit';
import { afterEach, describe, expect, it } from 'vitest';

import { DirectoryPersonContacts } from './directory-person-contacts.js';
import { ContactLookupError } from './person-contacts.js';

const PERSON = '0199a8f0-1111-7000-8000-000000000001';
const LOOKUP = { personId: PERSON, tenant: 'psc' };

interface Answer {
  status: number;
  body?: unknown;
  delayMs?: number;
}

let server: Server | undefined;
const requests: IncomingMessage[] = [];

/** A directory that answers requests in turn with `answers` (the last one repeats). */
async function directory(...answers: Answer[]): Promise<string> {
  let next = 0;
  server = createServer((request, response) => {
    requests.push(request);
    const answer = answers[Math.min(next++, answers.length - 1)] ?? { status: 500 };
    setTimeout(() => {
      response.writeHead(answer.status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(answer.body ?? {}));
    }, answer.delayMs ?? 0);
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/`;
}

class FakeTokens {
  issued = 0;
  invalidated = 0;
  token(): Promise<string> {
    this.issued += 1;
    return Promise.resolve(`token-${String(this.issued)}`);
  }
  invalidate(): void {
    this.invalidated += 1;
  }
}

describe('DirectoryPersonContacts', () => {
  afterEach(async () => {
    const running = server;
    if (running) await new Promise((resolve) => running.close(resolve));
    server = undefined;
    requests.length = 0;
  });

  const client = (url: string, tokens = new FakeTokens(), timeoutMs = 1_000) =>
    new DirectoryPersonContacts({ directoryUrl: url, tokens, timeoutMs });

  it('reads the verified contacts with the service token', async () => {
    const url = await directory({
      status: 200,
      body: { personId: PERSON, email: 'wanjiku@example.go.ke', phone: '+254712345678' },
    });

    const contacts = await client(url).lookup(LOOKUP);

    expect(contacts).toEqual({ email: 'wanjiku@example.go.ke', phone: '+254712345678' });
    expect(requests[0]?.method).toBe('GET');
    expect(requests[0]?.url).toBe(`/internal/v1/persons/${PERSON}/contacts`);
    expect(requests[0]?.headers.authorization).toBe('Bearer token-1');
    expect(requests[0]?.headers['x-acting-tenant']).toBe('psc');
  });

  it('passes on null contacts', async () => {
    const url = await directory({
      status: 200,
      body: { personId: PERSON, email: null, phone: '+254712345678' },
    });

    await expect(client(url).lookup(LOOKUP)).resolves.toEqual({
      email: null,
      phone: '+254712345678',
    });
  });

  it('treats an unknown person, or one not onboarded at the tenant, as a person without contacts', async () => {
    const url = await directory({ status: 404, body: { status: 404, title: 'Not Found' } });

    await expect(client(url).lookup(LOOKUP)).resolves.toEqual({ email: null, phone: null });
  });

  it('fetches a new token once when the directory refuses the cached one', async () => {
    const tokens = new FakeTokens();
    const url = await directory(
      { status: 401 },
      { status: 200, body: { personId: PERSON, email: null, phone: null } },
    );

    await client(url, tokens).lookup(LOOKUP);

    expect(tokens.invalidated).toBe(1);
    expect(requests.map((r) => r.headers.authorization)).toEqual([
      'Bearer token-1',
      'Bearer token-2',
    ]);
  });

  it.each([
    ['a server error', { status: 503 }],
    ['a refused scope', { status: 403 }],
    ['a second 401', { status: 401 }],
    ['a body that is not contacts', { status: 200, body: { personId: PERSON } }],
  ])('reports %s as a failed lookup', async (_case, answer) => {
    const url = await directory(answer);

    await expect(client(url).lookup(LOOKUP)).rejects.toBeInstanceOf(ContactLookupError);
  });

  it('gives up after its timeout', async () => {
    const url = await directory({ status: 200, body: {}, delayMs: 2_000 });
    const started = Date.now();

    await expect(client(url, new FakeTokens(), 200).lookup(LOOKUP)).rejects.toBeInstanceOf(
      ContactLookupError,
    );
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('reports an unreachable directory as a failed lookup', async () => {
    await expect(client('http://127.0.0.1:9/').lookup(LOOKUP)).rejects.toBeInstanceOf(
      ContactLookupError,
    );
  });

  it('reports a token failure as a failed lookup', async () => {
    const url = await directory({ status: 200, body: {} });
    const tokens = new FakeTokens();
    tokens.token = () => Promise.reject(new ServiceTokenError('keycloak down'));

    await expect(
      new DirectoryPersonContacts({ directoryUrl: url, tokens, timeoutMs: 1_000 }).lookup(LOOKUP),
    ).rejects.toBeInstanceOf(ContactLookupError);
    expect(requests).toHaveLength(0);
  });
});
