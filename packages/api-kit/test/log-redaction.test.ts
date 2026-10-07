import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { pinoHttp } from 'pino-http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { BaseEnv } from '../src/index.js';
import { requestLoggerOptions } from '../src/core.module.js';
import { redactLogValue, redactUrl, scanLogLine } from '../src/log-redaction.js';

const config: BaseEnv = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: 0,
  LOG_LEVEL: 'info',
  OIDC_ISSUER_URL: 'http://keycloak.test/realms/adili',
  OIDC_AUDIENCE: 'adili-api',
};

// nestjs-pino keeps one request logger per process, so a CoreModule test cannot choose
// where it writes. Drive pino-http with the exact options CoreModule uses instead.
describe('request log redaction', () => {
  const written: string[] = [];
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const logger = pinoHttp(requestLoggerOptions('test', config), {
      write: (line: string) => void written.push(line),
    });
    let nextId = 0;
    server = createServer((request, response) => {
      Object.assign(request, { id: `req-${String((nextId += 1))}` });
      logger(request, response);
      response.setHeader('content-type', 'application/json');
      response.end('{"items":[]}');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(() => {
    server.close();
  });

  it('logs a queue search request without the searched name', async () => {
    const response = await fetch(`${baseUrl}/v1/queue?search=Wanjiku%20Kamau&status=pending`);

    expect(response.status).toBe(200);
    await vi.waitFor(() => {
      expect(written.join('')).toContain('"statusCode":200');
    });
    const logged = written.join('');
    expect(logged).toContain('/v1/queue?search=[redacted]&status=pending');
    expect(logged).not.toContain('Wanjiku');
    expect(logged).not.toContain('Kamau');
  });

  describe('scanLogLine', () => {
    it('fails on a log line containing a national ID pattern', () => {
      expect(scanLogLine('{"msg":"looked up 28836510"}')).toEqual([
        { kind: 'national-id', detail: '28836510' },
      ]);
    });

    it('fails on a national ID field and on an amount field', () => {
      expect(scanLogLine('{"nationalId":"28836510"}')).toEqual([
        { kind: 'forbidden-field', detail: 'nationalId' },
      ]);
      expect(scanLogLine('{"amount":250000}')).toEqual([
        { kind: 'forbidden-field', detail: 'amount' },
      ]);
    });

    it('keeps a process log that only carries a pid, a time and a status', () => {
      expect(
        scanLogLine(
          '{"level":30,"time":1759900000000,"pid":42421,"hostname":"adili","statusCode":200,"msg":"request completed"}',
        ),
      ).toEqual([]);
    });
  });

  describe('redactLogValue', () => {
    it('removes a national ID and an amount before the line is written', () => {
      const redacted = JSON.stringify(
        redactLogValue({ msg: 'looked up 28836510', national_id: '28836510', amount: 250000 }),
      );
      expect(redacted).not.toContain('28836510');
      expect(redacted).not.toContain('250000');
      expect(scanLogLine(redacted)).toEqual([]);
    });
  });

  describe('redactUrl', () => {
    it('keeps URLs without a query untouched', () => {
      expect(redactUrl('/v1/queue')).toBe('/v1/queue');
    });

    it('redacts free-text params only, whatever their encoding or position', () => {
      expect(redactUrl('/v1/queue?limit=10&Search=a+b&q=x&%73earch=y&flag')).toBe(
        '/v1/queue?limit=10&Search=[redacted]&q=[redacted]&%73earch=[redacted]&flag',
      );
    });
  });
});
