import 'reflect-metadata';

import { Controller, Get } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { type BaseEnv, CoreModule, Public, TokenVerifier } from '../src/index.js';
import { redactUrl } from '../src/log-redaction.js';

const config: BaseEnv = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: 0,
  LOG_LEVEL: 'info',
  OIDC_ISSUER_URL: 'http://keycloak.test/realms/adili',
  OIDC_AUDIENCE: 'adili-api',
};

@Controller()
class QueueController {
  @Public()
  @Get('v1/queue')
  queue() {
    return { items: [] };
  }
}

describe('request log redaction', () => {
  let app: NestFastifyApplication;
  const written: string[] = [];
  // Read back exactly what pino writes, whatever stdout looks like in the runner.
  const logDestination = { write: (line: string) => void written.push(line) };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CoreModule.forRoot({ serviceName: 'test', config, logDestination })],
      controllers: [QueueController],
    })
      .overrideProvider(TokenVerifier)
      .useValue({})
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    // A real socket, not inject(): pino-http logs on the response's finish event, which
    // light-my-request does not emit the same way on every Node version.
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await app.close();
  });

  it('logs a queue search request without the searched name', async () => {
    const response = await fetch(
      `${await app.getUrl()}/v1/queue?search=Wanjiku%20Kamau&status=pending`,
    );

    expect(response.status).toBe(200);
    // pino-http writes when the response finishes, which can land after inject() resolves.
    await vi.waitFor(
      () => {
        expect(written.join('')).toContain('"statusCode":200');
      },
      {
        timeout: 5_000,
      },
    );
    const logged = written.join('');
    expect(logged).toContain('/v1/queue?search=[redacted]&status=pending');
    expect(logged).not.toContain('Wanjiku');
    expect(logged).not.toContain('Kamau');
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
