import 'reflect-metadata';

import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  type BaseEnv,
  byClientIp,
  byClientIpAnd,
  CoreModule,
  createOpenApiDocument,
  InMemoryRateLimitStore,
  ProblemException,
  Public,
  RATE_LIMIT_CLOCK,
  RateLimit,
  RateLimitModule,
  rateLimitsSchema,
  TRUSTED_PROXIES_DEFAULT,
} from '../src/index.js';

const config: BaseEnv = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: 0,
  LOG_LEVEL: 'fatal',
  OIDC_ISSUER_URL: 'http://keycloak.test/realms/adili',
  OIDC_AUDIENCE: 'adili-api',
};

/** Shaped like the directory's public onboarding routes (spec 03). */
@Public()
@Controller('v1/onboarding')
class OnboardingController {
  @Post('sessions')
  @RateLimit('onboarding-identify', { key: byClientIp, refundOn: ['no-roster'] })
  @RateLimit('onboarding-identify-commission', {
    key: byClientIpAnd({ body: 'commission' }),
    refundOn: ['no-roster'],
  })
  identify(@Body() body: { commission?: string }) {
    if (body.commission === 'no-roster') throw ProblemException.fromCode('no-roster');
    if (body.commission === 'unknown') throw ProblemException.fromCode('no-match');
    return { ok: true };
  }

  @Get('commissions/:commission')
  @RateLimit('onboarding-commission', { key: byClientIpAnd({ param: 'commission' }) })
  commission(@Param('commission') commission: string) {
    return { commission };
  }
}

const policies = rateLimitsSchema.parse(
  'onboarding-identify=5/60s,onboarding-identify-commission=2/60s,onboarding-commission=1/60s',
);

describe('RateLimit on public routes', () => {
  let app: NestFastifyApplication;
  let now = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        CoreModule.forRoot({ serviceName: 'test', config }),
        RateLimitModule.forRoot({ policies, store: new InMemoryRateLimitStore() }),
      ],
      controllers: [OnboardingController],
    })
      // How a consuming service's tests control time: its app module stays as it is.
      .overrideProvider(RATE_LIMIT_CLOCK)
      .useValue(() => now)
      .compile();
    // As `createService` configures it by default.
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ trustProxy: TRUSTED_PROXIES_DEFAULT }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(() => {
    // Each test starts far from the others, so every window is empty again.
    now += 24 * 60 * 60 * 1000;
  });

  afterAll(async () => {
    await app.close();
  });

  /** A request through the portal, which sends the browser's address as X-Forwarded-For. */
  function identify(commission: string | undefined, clientIp = '203.0.113.7') {
    return app.inject({
      method: 'POST',
      url: '/v1/onboarding/sessions',
      remoteAddress: '10.0.0.5',
      headers: { 'x-forwarded-for': clientIp },
      payload: commission === undefined ? {} : { commission },
    });
  }

  function limitHeaders(response: Awaited<ReturnType<typeof identify>>) {
    return {
      limit: response.headers['ratelimit-limit'],
      remaining: response.headers['ratelimit-remaining'],
      reset: response.headers['ratelimit-reset'],
    };
  }

  it('passes N requests per IP, then answers 429 with the headers and retryAfterSeconds', async () => {
    const passed = [];
    for (let i = 0; i < 5; i++) passed.push(await identify(`commission-${i}`));
    const refused = await identify('commission-5');

    expect(passed.map((response) => response.statusCode)).toEqual([201, 201, 201, 201, 201]);
    // The tightest budget is shown: per IP and Commission (1 left) until per IP is as low.
    expect(passed.map(limitHeaders)).toEqual([
      { limit: '2', remaining: '1', reset: '60' },
      { limit: '2', remaining: '1', reset: '60' },
      { limit: '2', remaining: '1', reset: '60' },
      { limit: '5', remaining: '1', reset: '60' },
      { limit: '5', remaining: '0', reset: '60' },
    ]);
    expect(refused.statusCode).toBe(429);
    expect(refused.headers['content-type']).toContain('application/problem+json');
    expect(refused.json()).toEqual({
      type: 'rate-limit-exceeded',
      code: 'rate-limit-exceeded',
      title: 'Too Many Requests',
      status: 429,
      detail: 'Rate limit of 5 requests per 60 seconds exceeded. Retry after 60 seconds.',
      retryAfterSeconds: 60,
      instance: '/v1/onboarding/sessions',
    });
    expect(limitHeaders(refused)).toEqual({ limit: '5', remaining: '0', reset: '60' });
    expect(refused.headers['retry-after']).toBe('60');
  });

  it('keeps the per IP and Commission budget apart from the per IP one', async () => {
    await identify('psc');
    await identify('psc');
    const samePair = await identify('psc');
    const otherCommission = await identify('tsc');
    const otherAddress = await identify('psc', '198.51.100.9');

    expect(samePair.statusCode).toBe(429);
    expect(samePair.json()).toMatchObject({ code: 'rate-limit-exceeded', retryAfterSeconds: 60 });
    expect(limitHeaders(samePair)).toEqual({ limit: '2', remaining: '0', reset: '60' });
    expect(otherCommission.statusCode).toBe(201);
    expect(otherAddress.statusCode).toBe(201);

    // The address's own budget is spent by any Commission, and then refuses them all.
    await identify('commission-a');
    await identify('commission-b');
    expect((await identify('commission-c')).statusCode).toBe(429);
  });

  it('counts the address the trusted proxy vouches for, not one the client made up', async () => {
    for (let i = 0; i < 5; i++) {
      await identify(`commission-${i}`, `192.0.2.${i}, 203.0.113.50`);
    }

    expect((await identify('commission-5', '192.0.2.99, 203.0.113.50')).statusCode).toBe(429);
    expect((await identify('commission-5', '203.0.113.51')).statusCode).toBe(201);

    // A client reaching the service directly cannot pose as others.
    const direct = (forwardedFor: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/onboarding/sessions',
        remoteAddress: '198.51.100.20',
        headers: { 'x-forwarded-for': forwardedFor },
        payload: {},
      });
    for (let i = 0; i < 5; i++) await direct(`192.0.2.${i}`);
    expect((await direct('192.0.2.200')).statusCode).toBe(429);
  });

  it('counts no request for a refunded outcome, and one for others', async () => {
    const noRoster = [];
    for (let i = 0; i < 7; i++) noRoster.push(await identify('no-roster'));
    const last = await identify('no-roster');

    expect(noRoster.map((response) => response.statusCode)).toEqual(Array(7).fill(409));
    expect(last.statusCode).toBe(409);
    expect(last.json()).toMatchObject({ code: 'no-roster', type: 'no-roster' });
    expect(limitHeaders(last)).toEqual({ limit: '2', remaining: '2', reset: '0' });

    const noMatch = await identify('unknown');
    expect(noMatch.statusCode).toBe(404);
    expect(noMatch.json()).toMatchObject({ code: 'no-match' });
    expect(limitHeaders(noMatch)).toEqual({ limit: '2', remaining: '1', reset: '60' });
    for (let i = 0; i < 3; i++) await identify(`commission-${i}`);
    expect((await identify('commission-4')).statusCode).toBe(201);
    expect((await identify('commission-5')).statusCode).toBe(429);
  });

  it('applies only the per IP budget when the request names no Commission', async () => {
    const response = await identify(undefined);

    expect(response.statusCode).toBe(201);
    expect(limitHeaders(response)).toEqual({ limit: '5', remaining: '4', reset: '60' });
  });

  it('keys on a route parameter', async () => {
    const get = (commission: string) =>
      app.inject({ method: 'GET', url: `/v1/onboarding/commissions/${commission}` });

    expect((await get('psc')).statusCode).toBe(200);
    expect((await get('psc')).statusCode).toBe(429);
    expect((await get('tsc')).statusCode).toBe(200);
  });

  it('slides the window on the injected clock', async () => {
    // One request every 10 seconds: the sixth, 50 seconds after the first, is refused.
    for (let i = 0; i < 5; i++) {
      await identify(`commission-${i}`);
      now += 10_000;
    }
    const sixth = await identify('commission-5');
    expect(sixth.statusCode).toBe(429);
    expect(sixth.headers['retry-after']).toBe('10');

    now += 9_999;
    expect((await identify('commission-5')).statusCode).toBe(429);
    // The first request leaves the window 60 seconds after it was made; only one fits.
    now += 1;
    expect((await identify('commission-5')).statusCode).toBe(201);
    expect((await identify('commission-6')).statusCode).toBe(429);

    now += 60_000;
    const reset = await identify('commission-6');
    expect(limitHeaders(reset)).toEqual({ limit: '2', remaining: '1', reset: '60' });
    expect((await identify(undefined)).headers['ratelimit-remaining']).toBe('3');
  });

  it('documents one 429 for a route with several budgets', () => {
    const { paths } = createOpenApiDocument(app, { name: 'test', description: 'test' });
    const tooMany = paths['/v1/onboarding/sessions']?.post?.responses['429'] as {
      description: string;
    };
    expect(tooMany.description).toBe(
      'Problem code `rate-limit-exceeded`: rate limit exceeded; retry after the seconds in `retryAfterSeconds` and Retry-After',
    );
  });
});
