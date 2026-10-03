import 'reflect-metadata';

import { startTelemetry } from '@adili/telemetry';
import { createRequire } from 'node:module';

import { Controller, Get, Module, Param } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { SpanKind } from '@opentelemetry/api';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { type BaseEnv, CoreModule, createService, Public } from '../src/index.js';

const config: BaseEnv = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: 0,
  LOG_LEVEL: 'fatal',
  OIDC_ISSUER_URL: 'http://keycloak.test/realms/adili',
  OIDC_AUDIENCE: 'adili-api',
};

@Controller('v1/agencies')
@Public()
class AgenciesController {
  @Get(':code/officers')
  officers(@Param('code') code: string) {
    return { code };
  }
}

@Module({
  imports: [CoreModule.forRoot({ serviceName: 'test', config })],
  controllers: [AgenciesController],
})
class TestModule {}

/**
 * #476 review: the exporter blanks identifiers in a server span's URL (`/v1/agencies/DCI/...`),
 * so a service's server spans carry the route template, as OTel's HTTP conventions describe.
 */
describe('server spans', () => {
  const spans = new InMemorySpanExporter();
  let sdk: ReturnType<typeof startTelemetry>;
  let app: NestFastifyApplication;
  let baseUrl: string;

  beforeAll(async () => {
    // The SDK batches spans for 5s; export each batch at once, so a test waits milliseconds.
    vi.stubEnv('OTEL_BSP_SCHEDULE_DELAY', '10');
    sdk = startTelemetry({ serviceName: 'api-kit-test', testSpanExporter: spans });
    // Fastify loaded `http` before the SDK started; requiring it again lets the HTTP
    // instrumentation patch it, as `--import @adili/telemetry/register` does before a service loads.
    createRequire(import.meta.url)('node:http');
    app = await createService({
      name: 'test',
      description: 'Route templates on server spans',
      module: TestModule,
      config,
    });
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
    await sdk.shutdown();
    vi.unstubAllEnvs();
  });

  const serverSpan = async (path: string) => {
    spans.reset();
    const response = await fetch(`${baseUrl}${path}`);
    await response.arrayBuffer();
    return vi.waitFor(() => {
      const span = spans.getFinishedSpans().find((finished) => finished.kind === SpanKind.SERVER);
      if (span === undefined) throw new Error('The server span is not exported yet');
      return { status: response.status, span };
    });
  };

  it('names a request after the route it matched, with the identifier redacted', async () => {
    const { status, span } = await serverSpan('/v1/agencies/DCI/officers');

    expect(status).toBe(200);
    expect(span.name).toBe('GET /v1/agencies/:code/officers');
    expect(span.attributes['http.route']).toBe('/v1/agencies/:code/officers');
    expect(JSON.stringify(span.attributes)).not.toContain('DCI');
  });

  it('keeps the bare method for a request that matches no route', async () => {
    const { status, span } = await serverSpan('/v1/nowhere');

    expect(status).toBe(404);
    expect(span.name).toBe('GET');
    expect(span.attributes['http.route']).toBeUndefined();
  });
});
