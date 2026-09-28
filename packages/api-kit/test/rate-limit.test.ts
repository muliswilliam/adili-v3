import 'reflect-metadata';

import { Controller, Get, NotFoundException } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  type BaseEnv,
  CoreModule,
  InMemoryRateLimitStore,
  Public,
  RateLimit,
  type RateLimitDecision,
  RateLimitModule,
  rateLimitsSchema,
  RateLimitStore,
  takeToken,
  TokenVerifier,
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

@Controller('v1/rosters')
@RateLimit('roster-api')
class RostersController {
  @Get('batches')
  batches() {
    return { ok: true };
  }

  @Get('records')
  records() {
    return { ok: true };
  }

  @Get('missing')
  missing() {
    throw new NotFoundException('No such roster');
  }

  @Get('export')
  @RateLimit('roster-export')
  export() {
    return { ok: true };
  }
}

@Controller('v1')
class OtherController {
  @Get('unlimited')
  unlimited() {
    return { ok: true };
  }

  @Public()
  @Get('public')
  @RateLimit('roster-api')
  open() {
    return { ok: true };
  }
}

class BrokenStore extends RateLimitStore {
  consume(): Promise<RateLimitDecision> {
    return Promise.reject(new Error('connection refused'));
  }
}

const policies = rateLimitsSchema.parse('roster-api=3/60s, roster-export=1/60s');

async function signingKeys() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256' };
  const verifier = new TokenVerifier(ISSUER, AUDIENCE, createLocalJWKSet({ keys: [jwk] }));
  const sign = (claims: { sub: string; azp: string }) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime('5m')
      .sign(privateKey);
  return { verifier, sign };
}

async function createApp(store: RateLimitStore, verifier: TokenVerifier) {
  const moduleRef = await Test.createTestingModule({
    imports: [
      CoreModule.forRoot({ serviceName: 'test', config }),
      RateLimitModule.forRoot({ policies, store }),
    ],
    controllers: [RostersController, OtherController],
  })
    .overrideProvider(TokenVerifier)
    .useValue(verifier)
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe('RateLimit', () => {
  let app: NestFastifyApplication;
  let now = 0;
  let tokens: Record<'hr' | 'otherClient' | 'officer' | 'otherOfficer', string>;

  beforeAll(async () => {
    const { verifier, sign } = await signingKeys();
    tokens = {
      hr: await sign({ sub: 'service-account-psc-hr', azp: 'roster-psc' }),
      otherClient: await sign({ sub: 'service-account-tsc-hr', azp: 'roster-tsc' }),
      officer: await sign({ sub: 'officer-1', azp: 'console' }),
      otherOfficer: await sign({ sub: 'officer-2', azp: 'console' }),
    };
    app = await createApp(new InMemoryRateLimitStore({ now: () => now }), verifier);
  });

  beforeEach(() => {
    // Each test starts at a point far from the others, so every bucket is full again.
    now += 24 * 60 * 60 * 1000;
  });

  afterAll(async () => {
    await app.close();
  });

  function get(url: string, token?: string) {
    return app.inject({
      method: 'GET',
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  }

  function limitHeaders(response: Awaited<ReturnType<typeof get>>) {
    return {
      limit: response.headers['ratelimit-limit'],
      remaining: response.headers['ratelimit-remaining'],
      reset: response.headers['ratelimit-reset'],
    };
  }

  it('passes the limit, then answers 429 problem details with the headers', async () => {
    const passed = [];
    for (let i = 0; i < 3; i++) {
      passed.push(await get('/v1/rosters/batches', tokens.hr));
    }
    const refused = await get('/v1/rosters/batches', tokens.hr);

    expect(passed.map((response) => response.statusCode)).toEqual([200, 200, 200]);
    expect(passed.map(limitHeaders)).toEqual([
      { limit: '3', remaining: '2', reset: '20' },
      { limit: '3', remaining: '1', reset: '40' },
      { limit: '3', remaining: '0', reset: '60' },
    ]);
    expect(refused.statusCode).toBe(429);
    expect(refused.headers['content-type']).toContain('application/problem+json');
    expect(refused.json()).toMatchObject({
      type: 'rate-limit-exceeded',
      code: 'rate-limit-exceeded',
      title: 'Too Many Requests',
      status: 429,
      retryAfterSeconds: 20,
      instance: '/v1/rosters/batches',
    });
    expect(limitHeaders(refused)).toEqual({ limit: '3', remaining: '0', reset: '60' });
    expect(refused.headers['retry-after']).toBe('20');
  });

  it('refills over the window', async () => {
    for (let i = 0; i < 3; i++) await get('/v1/rosters/batches', tokens.hr);
    now += 19_000;
    const early = await get('/v1/rosters/batches', tokens.hr);
    now += 2_000;
    const refilled = await get('/v1/rosters/batches', tokens.hr);

    expect(early.statusCode).toBe(429);
    expect(early.headers['retry-after']).toBe('1');
    expect(refilled.statusCode).toBe(200);
    expect(limitHeaders(refilled)).toMatchObject({ remaining: '0' });
  });

  it('shares one budget across the routes of a group, and none with other groups', async () => {
    await get('/v1/rosters/batches', tokens.hr);
    await get('/v1/rosters/records', tokens.hr);
    await get('/v1/rosters/batches', tokens.hr);

    expect((await get('/v1/rosters/records', tokens.hr)).statusCode).toBe(429);
    const exported = await get('/v1/rosters/export', tokens.hr);
    expect(exported.statusCode).toBe(200);
    expect(limitHeaders(exported)).toMatchObject({ limit: '1', remaining: '0' });
  });

  it('counts each client, and each person signed in through the same app, separately', async () => {
    for (let i = 0; i < 3; i++) {
      await get('/v1/rosters/batches', tokens.hr);
      await get('/v1/rosters/batches', tokens.officer);
    }

    expect((await get('/v1/rosters/batches', tokens.hr)).statusCode).toBe(429);
    expect((await get('/v1/rosters/batches', tokens.officer)).statusCode).toBe(429);
    expect((await get('/v1/rosters/batches', tokens.otherClient)).statusCode).toBe(200);
    expect((await get('/v1/rosters/batches', tokens.otherOfficer)).statusCode).toBe(200);
  });

  it('sets the headers on error responses of a limited route too', async () => {
    const response = await get('/v1/rosters/missing', tokens.hr);

    expect(response.statusCode).toBe(404);
    expect(limitHeaders(response)).toEqual({ limit: '3', remaining: '2', reset: '20' });
  });

  it('leaves routes without @RateLimit alone', async () => {
    const response = await get('/v1/unlimited', tokens.hr);

    expect(response.statusCode).toBe(200);
    expect(response.headers['ratelimit-limit']).toBeUndefined();
  });

  it('counts unauthenticated callers of public routes by address', async () => {
    for (let i = 0; i < 3; i++) await get('/v1/public');

    expect((await get('/v1/public')).statusCode).toBe(429);
    const elsewhere = await app.inject({
      method: 'GET',
      url: '/v1/public',
      remoteAddress: '192.0.2.7',
    });
    expect(elsewhere.statusCode).toBe(200);
  });

  it('does not limit before authentication', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await get('/v1/rosters/batches')).statusCode).toBe(401);
    }
    expect((await get('/v1/rosters/batches', tokens.hr)).statusCode).toBe(200);
  });
});

describe('RateLimit with the store down', () => {
  it('lets requests through without headers', async () => {
    const { verifier, sign } = await signingKeys();
    const app = await createApp(new BrokenStore(), verifier);
    try {
      const token = await sign({ sub: 'service-account-psc-hr', azp: 'roster-psc' });
      const response = await app.inject({
        method: 'GET',
        url: '/v1/rosters/batches',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['ratelimit-limit']).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});

describe('RateLimitModule', () => {
  it('refuses to start when a @RateLimit group has no configured policy', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        CoreModule.forRoot({ serviceName: 'test', config }),
        RateLimitModule.forRoot({
          policies: rateLimitsSchema.parse('roster-api=3/60s'),
          store: new InMemoryRateLimitStore(),
        }),
      ],
      controllers: [RostersController],
    }).compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());

    await expect(app.init()).rejects.toThrow(
      'No rate limit configured for @RateLimit group(s) roster-export; configured: roster-api',
    );
    await app.close();
  });
});

describe('rateLimitsSchema', () => {
  it('parses comma-separated group policies', () => {
    expect(rateLimitsSchema.parse('roster-api=120/60s,roster-batch=10/3600s')).toEqual({
      'roster-api': { limit: 120, windowSeconds: 60 },
      'roster-batch': { limit: 10, windowSeconds: 3600 },
    });
    expect(rateLimitsSchema.parse('')).toEqual({});
  });

  it.each([
    'roster-api=120',
    'roster-api=0/60s',
    'roster-api=5/0s',
    'Roster=1/1s',
    'a=1/1s,a=2/1s',
  ])('rejects %s', (value) => {
    expect(rateLimitsSchema.safeParse(value).success).toBe(false);
  });
});

describe('takeToken', () => {
  const policy = { limit: 2, windowSeconds: 10 };

  it('starts full and takes one token per request', () => {
    const first = takeToken(undefined, policy, 0);
    const second = takeToken(first.bucket, policy, 0);
    const third = takeToken(second.bucket, policy, 0);

    expect(first.decision).toEqual({
      allowed: true,
      limit: 2,
      remaining: 1,
      resetSeconds: 5,
      retryAfterSeconds: 0,
    });
    expect(second.decision).toMatchObject({ allowed: true, remaining: 0, resetSeconds: 10 });
    expect(third.decision).toMatchObject({ allowed: false, remaining: 0, retryAfterSeconds: 5 });
    expect(third.bucket.tokens).toBe(0);
  });

  it('refills continuously up to the limit', () => {
    const empty = { tokens: 0, updatedAtMs: 0 };

    expect(takeToken(empty, policy, 2_500).decision).toMatchObject({
      allowed: false,
      retryAfterSeconds: 3,
    });
    expect(takeToken(empty, policy, 6_000).decision).toMatchObject({ allowed: true, remaining: 0 });
    expect(takeToken(empty, policy, 60_000).decision).toMatchObject({ remaining: 1 });
  });

  it('gives a token back for a negative cost, up to the limit', () => {
    const empty = { tokens: 0, updatedAtMs: 0 };
    const refunded = takeToken(empty, policy, 0, -1);

    expect(refunded.decision).toEqual({
      allowed: true,
      limit: 2,
      remaining: 1,
      resetSeconds: 5,
      retryAfterSeconds: 0,
    });
    expect(takeToken(undefined, policy, 0, -1).bucket.tokens).toBe(2);
  });
});
