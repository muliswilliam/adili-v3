import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { ServiceTokenError } from '@adili/api-kit';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { HttpIprsLookup } from '../../src/onboarding/iprs/http-iprs-lookup.js';
import { IprsUnavailable } from '../../src/onboarding/iprs/iprs-lookup.js';

/**
 * The IPRS adapter against a stub integration-gateway on a local port: the request it makes (the
 * national ID in the body, the directory's token) and how it reads each answer.
 */
const PERSON = {
  nationalId: '12345678',
  firstName: 'Wanjiru',
  middleName: null,
  lastName: 'Otieno',
  dateOfBirth: '1984-03-12',
  sex: 'F',
};

interface Recorded {
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
  body: unknown;
}

let server: Server;
let baseUrl: string;
let answers: { status: number; body?: unknown; hang?: boolean }[];
let requests: Recorded[];
let tokens: { issued: number; invalidated: number; fail?: boolean };

beforeAll(async () => {
  server = createServer((request: IncomingMessage, response) => {
    let raw = '';
    request.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    request.on('end', () => {
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body: raw ? JSON.parse(raw) : undefined,
      });
      const answer = answers.shift() ?? { status: 500 };
      if (answer.hang) return;
      response.statusCode = answer.status;
      response.setHeader(
        'content-type',
        answer.status < 300 ? 'application/json' : 'application/problem+json',
      );
      response.end(answer.body === undefined ? '' : JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  answers = [];
  requests = [];
  tokens = { issued: 0, invalidated: 0 };
});

function lookup(timeoutMs?: number) {
  return new HttpIprsLookup({
    integrationGatewayUrl: `${baseUrl}/`,
    timeoutMs,
    tokens: {
      token: () => {
        if (tokens.fail) return Promise.reject(new ServiceTokenError('Keycloak is down'));
        tokens.issued += 1;
        return Promise.resolve(`token-${tokens.issued}`);
      },
      invalidate: () => {
        tokens.invalidated += 1;
      },
    },
  });
}

function problem(status: number, type: string) {
  return { status, body: { type, title: type, status } };
}

describe('HttpIprsLookup', () => {
  it('posts the national ID in the body with the service token and returns the names', async () => {
    answers.push({ status: 200, body: PERSON });

    await expect(lookup().find('12345678')).resolves.toEqual({
      firstName: 'Wanjiru',
      middleName: null,
      lastName: 'Otieno',
    });
    expect(requests).toEqual([
      {
        method: 'POST',
        url: '/internal/v1/iprs/person-lookups',
        authorization: 'Bearer token-1',
        body: { nationalId: '12345678' },
      },
    ]);
  });

  it('returns null for 404', async () => {
    answers.push(problem(404, 'not-found'));

    await expect(lookup().find('12345678')).resolves.toBeNull();
  });

  it.each([
    ['503 upstream-unavailable', problem(503, 'upstream-unavailable')],
    ['500', problem(500, 'about:blank')],
    ['403 (no iprs scope)', problem(403, 'forbidden')],
    ['a person that breaks the contract', { status: 200, body: { firstName: 'Wanjiru' } }],
  ])('reports %s as IprsUnavailable', async (_case, answer) => {
    answers.push(answer);

    await expect(lookup().find('12345678')).rejects.toBeInstanceOf(IprsUnavailable);
  });

  it('retries once with a fresh token after 401', async () => {
    answers.push(problem(401, 'unauthorized'), { status: 200, body: PERSON });

    await expect(lookup().find('12345678')).resolves.toMatchObject({ lastName: 'Otieno' });
    expect(tokens.invalidated).toBe(1);
    expect(requests.map((request) => request.authorization)).toEqual([
      'Bearer token-1',
      'Bearer token-2',
    ]);
  });

  it('reports no token, no answer in time and no gateway as IprsUnavailable', async () => {
    tokens.fail = true;
    await expect(lookup().find('12345678')).rejects.toBeInstanceOf(IprsUnavailable);

    tokens.fail = false;
    answers.push({ status: 200, hang: true });
    await expect(lookup(100).find('12345678')).rejects.toBeInstanceOf(IprsUnavailable);

    const nowhere = new HttpIprsLookup({
      integrationGatewayUrl: 'http://127.0.0.1:9',
      tokens: { token: () => Promise.resolve('t'), invalidate: () => undefined },
    });
    await expect(nowhere.find('12345678')).rejects.toBeInstanceOf(IprsUnavailable);
  });
});
