import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { Controller, Headers, Param, Post } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type BaseEnv,
  CoreModule,
  IdempotencyModule,
  type IdempotencyScope,
  InMemoryIdempotencyStore,
  Public,
  RequireIdempotencyKey,
  type StoredResponse,
} from '../src/index.js';
import { calls, describeIdempotency } from './idempotency.scenarios.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const CLAIM_TIMEOUT_MS = 60 * 1000;
let clock = Date.now();

/** Fails the next `failCompletes` calls of `complete`, as a database blip would. */
class FlakyStore extends InMemoryIdempotencyStore {
  failCompletes = 0;

  override complete(
    scope: IdempotencyScope,
    token: string,
    response: StoredResponse,
  ): Promise<boolean> {
    if (this.failCompletes > 0) {
      this.failCompletes--;
      return Promise.reject(new Error('connection terminated unexpectedly'));
    }
    return super.complete(scope, token, response);
  }
}

const store = new FlakyStore({ now: () => clock });

describeIdempotency(
  'the in-memory store',
  () => store,
  (harness) => {
    it('forgets keys after 24 hours', async () => {
      const key = randomUUID();
      await harness().send({ url: '/v1/things', key, body: { name: 'Pen' } });

      clock += DAY_MS + 1;
      const later = await harness().send({ url: '/v1/things', key, body: { name: 'Pencil' } });

      expect(later.statusCode).toBe(201);
      expect(later.headers['idempotent-replayed']).toBeUndefined();
      expect(calls.create).toBe(2);
      expect(await store.purgeExpired()).toBeGreaterThan(0);
    });

    it('stores the outcome through a brief store failure, so a late retry replays it', async () => {
      const key = randomUUID();
      store.failCompletes = 1;

      const first = await harness().send({ url: '/v1/things', key, body: { name: 'Pen' } });
      clock += CLAIM_TIMEOUT_MS + 1;
      const retry = await harness().send({ url: '/v1/things', key, body: { name: 'Pen' } });

      expect(first.statusCode).toBe(201);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(retry.json()).toEqual(first.json());
      expect(calls.create).toBe(1);
    });

    it('does not let a request whose claim was taken over overwrite the outcome of the retry', async () => {
      const scope = { key: randomUUID(), subject: 'admin-1' };
      const slow = await store.claim(scope, 'first-body');
      clock += CLAIM_TIMEOUT_MS + 1;
      const retry = await store.claim(scope, 'second-body');
      if (slow.outcome !== 'claimed' || retry.outcome !== 'claimed') throw new Error('not claimed');

      expect(await store.complete(scope, retry.token, { status: 200, body: 'retry' })).toBe(true);
      expect(await store.complete(scope, slow.token, { status: 200, body: 'slow' })).toBe(false);
      await store.release(scope, slow.token);

      expect(await store.claim(scope, 'second-body')).toEqual({
        outcome: 'existing',
        requestHash: 'second-body',
        response: { status: 200, body: 'retry' },
      });
    });

    it("answers with the handler's result even when its outcome cannot be stored", async () => {
      store.failCompletes = Number.POSITIVE_INFINITY;

      const response = await harness().send({
        url: '/v1/things',
        key: randomUUID(),
        body: { name: 'Pen' },
      });
      store.failCompletes = 0;

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ name: 'Pen' });
      expect(calls.create).toBe(1);
    });

    it('keeps a 4xx answer when its outcome cannot be stored', async () => {
      store.failCompletes = Number.POSITIVE_INFINITY;

      const response = await harness().send({
        url: '/v1/things/conflict',
        key: randomUUID(),
        body: {},
      });
      store.failCompletes = 0;

      expect(response.statusCode).toBe(409);
    });
  },
);

describe('RequireIdempotencyKey without IdempotencyModule', () => {
  @Controller('v1/orphan')
  class OrphanController {
    @Post()
    @RequireIdempotencyKey()
    create() {
      return {};
    }
  }

  it('fails at startup instead of silently accepting retries', async () => {
    const config: BaseEnv = {
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: 0,
      LOG_LEVEL: 'fatal',
      OIDC_ISSUER_URL: 'http://keycloak.test/realms/adili',
      OIDC_AUDIENCE: 'adili-api',
    };
    const compile = Test.createTestingModule({
      imports: [CoreModule.forRoot({ serviceName: 'test', config })],
      controllers: [OrphanController],
    }).compile();

    await expect(compile).rejects.toThrow(/IdempotencyStore/);
  });
});

describe('RequireIdempotencyKey on a public route, with an owner', () => {
  const config: BaseEnv = {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: 0,
    LOG_LEVEL: 'fatal',
    OIDC_ISSUER_URL: 'http://keycloak.test/realms/adili',
    OIDC_AUDIENCE: 'adili-api',
  };
  let confirms = 0;

  /** Keys belong to the session and the secret presented, as onboarding's do. */
  const sessionOwner = (request: FastifyRequest) => {
    const { sessionId } = request.params as { sessionId: string };
    return `session:${sessionId}:${String(request.headers['x-secret'])}`;
  };

  @Public()
  @Controller('v1/sessions/:sessionId/confirm')
  class ConfirmController {
    @Post()
    @RequireIdempotencyKey({ owner: sessionOwner })
    confirm(@Param('sessionId') sessionId: string, @Headers('x-secret') secret: string) {
      confirms++;
      return { sessionId, secret, confirm: confirms };
    }
  }

  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        CoreModule.forRoot({ serviceName: 'test', config }),
        IdempotencyModule.forRoot({ store: new InMemoryIdempotencyStore() }),
      ],
      controllers: [ConfirmController],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useLogger(false);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const confirm = (sessionId: string, secret: string, key: string) =>
    app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/confirm`,
      headers: { 'x-secret': secret, 'idempotency-key': key },
    });

  it('replays the stored answer to the same owner without a token', async () => {
    const key = randomUUID();
    const first = await confirm('s1', 'secret-1', key);
    const retry = await confirm('s1', 'secret-1', key);

    expect(first.statusCode).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.json()).toEqual(first.json());
    expect(confirms).toBe(1);
  });

  it('keeps owners apart: another secret with the same key runs the handler', async () => {
    const key = randomUUID();
    await confirm('s2', 'secret-2', key);
    const other = await confirm('s2', 'guessed', key);

    expect(other.headers['idempotent-replayed']).toBeUndefined();
    expect(other.json()).toMatchObject({ secret: 'guessed' });
  });

  it('still requires the key', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/sessions/s3/confirm',
      headers: { 'x-secret': 'secret-3' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ type: 'idempotency-key-missing' });
  });
});
