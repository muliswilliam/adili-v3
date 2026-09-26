import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { Controller, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import {
  type BaseEnv,
  CoreModule,
  InMemoryIdempotencyStore,
  RequireIdempotencyKey,
} from '../src/index.js';
import { calls, describeIdempotency } from './idempotency.scenarios.js';

const DAY_MS = 24 * 60 * 60 * 1000;
let clock = Date.now();
const store = new InMemoryIdempotencyStore({ now: () => clock });

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
