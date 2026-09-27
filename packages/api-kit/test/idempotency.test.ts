import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { Controller, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import {
  type BaseEnv,
  CoreModule,
  type IdempotencyScope,
  InMemoryIdempotencyStore,
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

  override complete(scope: IdempotencyScope, response: StoredResponse): Promise<void> {
    if (this.failCompletes > 0) {
      this.failCompletes--;
      return Promise.reject(new Error('connection terminated unexpectedly'));
    }
    return super.complete(scope, response);
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
