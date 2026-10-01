import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { Body, ConflictException, Controller, HttpCode, Param, Post, Put } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  type BaseEnv,
  CoreModule,
  CurrentPrincipal,
  IdempotencyModule,
  type IdempotencyStore,
  type Principal,
  RequireIdempotencyKey,
  TokenVerifier,
  ZodValidationPipe,
} from '../src/index.js';

const ISSUER = 'http://keycloak.test/realms/adili';
const AUDIENCE = 'adili-api';

const config: BaseEnv = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: 0,
  LOG_LEVEL: 'fatal',
  OIDC_ISSUER_URL: ISSUER,
  OIDC_AUDIENCE: AUDIENCE,
};

const createThing = z.object({ name: z.string().min(1), tags: z.array(z.string()).optional() });

/** How often each handler actually ran. */
const calls = { create: 0, update: 0, conflict: 0, flaky: 0, transient: 0, slow: 0, plain: 0 };
let releaseSlow: () => void = () => undefined;

@Controller('v1/things')
class ThingsController {
  @Post()
  @RequireIdempotencyKey()
  create(
    @Body(new ZodValidationPipe(createThing)) body: z.infer<typeof createThing>,
    @CurrentPrincipal() principal: Principal,
  ) {
    calls.create++;
    // Not in jsonb's key order (length, then bytes), so replays prove the order is kept.
    return { owner: principal.subject, name: body.name, id: `thing-${calls.create}` };
  }

  @Put(':id')
  @HttpCode(200)
  @RequireIdempotencyKey()
  update(@Param('id') id: string) {
    calls.update++;
    return { id, version: calls.update };
  }

  @Post('conflict')
  @RequireIdempotencyKey()
  conflict() {
    calls.conflict++;
    throw new ConflictException('Thing already exists');
  }

  @Post('flaky')
  @RequireIdempotencyKey()
  flaky() {
    calls.flaky++;
    if (calls.flaky === 1) throw new Error('database unavailable');
    return { attempt: calls.flaky };
  }

  @Post('transient')
  @RequireIdempotencyKey({ settled: (body: { status: string }) => body.status !== 'try-again' })
  transient() {
    calls.transient++;
    return { status: calls.transient === 1 ? 'try-again' : 'done', attempt: calls.transient };
  }

  @Post('slow')
  @RequireIdempotencyKey()
  async slow() {
    calls.slow++;
    await new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    return { done: true };
  }

  @Post('plain')
  plain() {
    calls.plain++;
    return { ok: true };
  }
}

export interface IdempotencyHarness {
  app: NestFastifyApplication;
  /** POSTs or PUTs as `subject` with an optional Idempotency-Key. */
  send: (options: {
    url: string;
    method?: 'POST' | 'PUT';
    key?: string;
    subject?: string;
    body?: unknown;
  }) => ReturnType<NestFastifyApplication['inject']>;
}

/**
 * The HTTP contract of `@RequireIdempotencyKey()`, run against any store so the in-memory
 * and Postgres stores are held to the same behaviour.
 */
export function describeIdempotency(
  storeName: string,
  createStore: () => IdempotencyStore,
  extra?: (harness: () => IdempotencyHarness) => void,
): void {
  describe(`@RequireIdempotencyKey() with ${storeName}`, () => {
    let harness: IdempotencyHarness;

    beforeAll(async () => {
      const { publicKey, privateKey } = await generateKeyPair('RS256');
      const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256' };
      const tokens = new Map<string, string>();
      const tokenFor = async (subject: string) => {
        const cached = tokens.get(subject);
        if (cached) return cached;
        const token = await new SignJWT({ tenant: 'platform' })
          .setProtectedHeader({ alg: 'RS256', kid: 'test' })
          .setIssuer(ISSUER)
          .setAudience(AUDIENCE)
          .setSubject(subject)
          .setExpirationTime('5m')
          .sign(privateKey);
        tokens.set(subject, token);
        return token;
      };

      const moduleRef = await Test.createTestingModule({
        imports: [
          CoreModule.forRoot({ serviceName: 'test', config }),
          IdempotencyModule.forRoot({ store: createStore() }),
        ],
        controllers: [ThingsController],
      })
        .overrideProvider(TokenVerifier)
        .useValue(new TokenVerifier(ISSUER, AUDIENCE, createLocalJWKSet({ keys: [jwk] })))
        .compile();

      const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      // The 5xx scenario is expected; keep its stack trace out of the test output.
      app.useLogger(false);
      await app.init();
      await app.getHttpAdapter().getInstance().ready();

      harness = {
        app,
        send: async ({ url, method = 'POST', key, subject = 'admin-1', body }) =>
          app.inject({
            method,
            url,
            headers: {
              authorization: `Bearer ${await tokenFor(subject)}`,
              ...(key === undefined ? {} : { 'idempotency-key': key }),
            },
            ...(body === undefined ? {} : { payload: body as object }),
          }),
      };
    });

    afterAll(async () => {
      await harness.app.close();
    });

    beforeEach(() => {
      for (const name of Object.keys(calls) as (keyof typeof calls)[]) calls[name] = 0;
    });

    it('S6: rejects a marked route without the header as a 400 problem', async () => {
      const response = await harness.send({ url: '/v1/things', body: { name: 'Pen' } });

      expect(response.statusCode).toBe(400);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.json()).toMatchObject({
        type: 'idempotency-key-missing',
        status: 400,
        instance: '/v1/things',
      });
      expect(calls.create).toBe(0);
    });

    it('rejects an empty or oversized key', async () => {
      for (const key of ['', 'k'.repeat(256)]) {
        const response = await harness.send({ url: '/v1/things', key, body: { name: 'Pen' } });

        expect(response.statusCode).toBe(400);
      }
      expect(calls.create).toBe(0);
    });

    it('S2: replays the stored status and body for the same key and body', async () => {
      const key = randomUUID();
      const first = await harness.send({ url: '/v1/things', key, body: { name: 'Pen' } });
      const retry = await harness.send({ url: '/v1/things', key, body: { name: 'Pen' } });

      expect(first.statusCode).toBe(201);
      expect(first.headers['idempotent-replayed']).toBeUndefined();
      expect(retry.statusCode).toBe(201);
      expect(retry.body).toBe(first.body);
      expect(retry.headers['content-type']).toContain('application/json');
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(calls.create).toBe(1);
    });

    it('treats the same JSON with a different key order as the same request', async () => {
      const key = randomUUID();
      await harness.send({ url: '/v1/things', key, body: { name: 'Pen', tags: ['a'] } });
      const retry = await harness.send({
        url: '/v1/things',
        key,
        body: { tags: ['a'], name: 'Pen' },
      });

      expect(retry.statusCode).toBe(201);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(calls.create).toBe(1);
    });

    it('replays the status set with @HttpCode', async () => {
      const key = randomUUID();
      await harness.send({ url: '/v1/things/t-1', method: 'PUT', key, body: {} });
      const retry = await harness.send({ url: '/v1/things/t-1', method: 'PUT', key, body: {} });

      expect(retry.statusCode).toBe(200);
      expect(retry.json()).toEqual({ id: 't-1', version: 1 });
      expect(calls.update).toBe(1);
    });

    it('S3: refuses the same key with a different body as a 422 problem', async () => {
      const key = randomUUID();
      await harness.send({ url: '/v1/things', key, body: { name: 'Pen' } });
      const reused = await harness.send({ url: '/v1/things', key, body: { name: 'Pencil' } });

      expect(reused.statusCode).toBe(422);
      expect(reused.headers['content-type']).toContain('application/problem+json');
      expect(reused.json()).toMatchObject({ type: 'idempotency-key-reused', status: 422 });
      expect(calls.create).toBe(1);
    });

    it('refuses the same key on a different route as a 422 problem', async () => {
      const key = randomUUID();
      await harness.send({ url: '/v1/things/t-1', method: 'PUT', key, body: {} });
      const reused = await harness.send({ url: '/v1/things/t-2', method: 'PUT', key, body: {} });

      expect(reused.statusCode).toBe(422);
      expect(calls.update).toBe(1);
    });

    it('scopes keys per caller subject', async () => {
      const key = randomUUID();
      const alice = await harness.send({
        url: '/v1/things',
        key,
        subject: 'alice',
        body: { name: 'Pen' },
      });
      const bob = await harness.send({
        url: '/v1/things',
        key,
        subject: 'bob',
        body: { name: 'Pencil' },
      });

      expect(alice.statusCode).toBe(201);
      expect(bob.statusCode).toBe(201);
      expect(bob.headers['idempotent-replayed']).toBeUndefined();
      expect(bob.json()).toMatchObject({ name: 'Pencil', owner: 'bob' });
      expect(calls.create).toBe(2);
    });

    it('stores and replays 4xx outcomes from the handler', async () => {
      const key = randomUUID();
      const first = await harness.send({ url: '/v1/things/conflict', key, body: {} });
      const retry = await harness.send({ url: '/v1/things/conflict', key, body: {} });

      expect(first.statusCode).toBe(409);
      expect(retry.statusCode).toBe(409);
      expect(retry.headers['content-type']).toContain('application/problem+json');
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(retry.json()).toEqual(first.json());
      expect(calls.conflict).toBe(1);
    });

    it('stores and replays validation failures', async () => {
      const key = randomUUID();
      const first = await harness.send({ url: '/v1/things', key, body: { name: '' } });
      const retry = await harness.send({ url: '/v1/things', key, body: { name: '' } });

      expect(first.statusCode).toBe(400);
      expect(first.json()).toMatchObject({ errors: [{ path: 'name' }] });
      expect(retry.statusCode).toBe(400);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(retry.json()).toEqual(first.json());
    });

    it('does not store 5xx outcomes, so a retry runs the handler again', async () => {
      const key = randomUUID();
      const first = await harness.send({ url: '/v1/things/flaky', key, body: {} });
      const retry = await harness.send({ url: '/v1/things/flaky', key, body: {} });

      expect(first.statusCode).toBe(500);
      expect(retry.statusCode).toBe(201);
      expect(retry.headers['idempotent-replayed']).toBeUndefined();
      expect(retry.json()).toEqual({ attempt: 2 });
      expect(calls.flaky).toBe(2);
    });

    it('does not store a 2xx the route says is not final, so a retry runs the handler again', async () => {
      const key = randomUUID();
      const first = await harness.send({ url: '/v1/things/transient', key, body: {} });
      const retry = await harness.send({ url: '/v1/things/transient', key, body: {} });
      const again = await harness.send({ url: '/v1/things/transient', key, body: {} });

      expect(first.statusCode).toBe(201);
      expect(first.json()).toEqual({ status: 'try-again', attempt: 1 });
      expect(retry.headers['idempotent-replayed']).toBeUndefined();
      expect(retry.json()).toEqual({ status: 'done', attempt: 2 });
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(again.json()).toEqual({ status: 'done', attempt: 2 });
      expect(calls.transient).toBe(2);
    });

    it('refuses a retry while the first request is still running', async () => {
      const key = randomUUID();
      const first = harness.send({ url: '/v1/things/slow', key, body: {} });
      await waitFor(() => calls.slow === 1);

      const concurrent = await harness.send({ url: '/v1/things/slow', key, body: {} });
      releaseSlow();

      expect(concurrent.statusCode).toBe(409);
      expect(concurrent.json()).toMatchObject({ type: 'idempotency-key-in-use' });
      expect((await first).statusCode).toBe(201);
      expect(calls.slow).toBe(1);
    });

    it('leaves routes without the decorator alone', async () => {
      const response = await harness.send({ url: '/v1/things/plain', body: {} });

      expect(response.statusCode).toBe(201);
      expect(calls.plain).toBe(1);
    });

    extra?.(() => harness);
  });
}

export async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export { calls };
