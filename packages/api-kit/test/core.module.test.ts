import 'reflect-metadata';

import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type BaseEnv,
  CoreModule,
  CurrentPrincipal,
  type Principal,
  Public,
  ReadinessCheck,
  Scopes,
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

@Injectable()
class HealthyDependency extends ReadinessCheck {
  readonly name = 'healthy';
  check(): Promise<void> {
    return Promise.resolve();
  }
}

class BrokenDependency extends ReadinessCheck {
  readonly name = 'broken';
  check(): Promise<void> {
    return Promise.reject(new Error('connection refused'));
  }
}

@Controller()
class TestController {
  @Get('v1/me')
  me(@CurrentPrincipal() principal: Principal) {
    return principal;
  }

  @Scopes('messages')
  @Get('v1/messages')
  messages() {
    return { ok: true };
  }

  @Public()
  @Get('v1/public')
  open() {
    return { ok: true };
  }
}

@Module({ providers: [HealthyDependency], exports: [HealthyDependency] })
class DependencyModule {}

describe('CoreModule', () => {
  let app: NestFastifyApplication;
  let signToken: (claims: Record<string, unknown>, audience?: string) => Promise<string>;

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256' };
    signToken = (claims, audience = AUDIENCE) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'test' })
        .setIssuer(ISSUER)
        .setAudience(audience)
        .setSubject('user-1')
        .setExpirationTime('5m')
        .sign(privateKey);

    const moduleRef = await Test.createTestingModule({
      imports: [
        DependencyModule,
        CoreModule.forRoot({
          serviceName: 'test',
          config,
          readiness: [HealthyDependency, new BrokenDependency()],
        }),
      ],
      controllers: [TestController],
    })
      .overrideProvider(TokenVerifier)
      .useValue(new TokenVerifier(ISSUER, AUDIENCE, createLocalJWKSet({ keys: [jwk] })))
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports liveness without checking dependencies', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
  });

  it('reports not ready with the failing dependency named', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'down',
      checks: {
        healthy: { status: 'up' },
        broken: { status: 'down', error: 'connection refused' },
      },
    });
  });

  it('rejects requests without a bearer token as problem details', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/me' });

    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({ status: 401, instance: '/v1/me' });
  });

  it('rejects tokens issued for another audience', async () => {
    const token = await signToken({}, 'another-api');
    const response = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(401);
  });

  it('exposes the verified principal to handlers', async () => {
    const token = await signToken({
      azp: 'console',
      tenant: 'psc',
      realm_access: { roles: ['reviewer'] },
    });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      subject: 'user-1',
      tenant: 'psc',
      roles: ['reviewer'],
      scopes: [],
      clientId: 'console',
      name: null,
      issuedAt: null,
      personId: null,
      acr: null,
      authTime: null,
      tokenId: null,
    });
  });

  it('S21: exposes the person_id claim of a declarant token as personId', async () => {
    const token = await signToken({
      azp: 'portal',
      tenant: 'psc',
      realm_access: { roles: ['declarant'] },
      person_id: '5f0c7a8e-3b1d-4c2a-9e6f-2d4b8a1c7e90',
    });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.json()).toMatchObject({ personId: '5f0c7a8e-3b1d-4c2a-9e6f-2d4b8a1c7e90' });
  });

  it('names the caller from the name claim, else the preferred username', async () => {
    const named = await signToken({ name: 'Fatuma Wanjiru', preferred_username: 'fatuma' });
    const unnamed = await signToken({ preferred_username: 'service-account-roster-psc' });
    const me = async (token: string) =>
      (
        await app.inject({
          method: 'GET',
          url: '/v1/me',
          headers: { authorization: `Bearer ${token}` },
        })
      ).json<{ name: string | null }>().name;

    expect(await me(named)).toBe('Fatuma Wanjiru');
    expect(await me(unnamed)).toBe('service-account-roster-psc');
  });

  it('reads when the token was issued from the iat claim', async () => {
    const token = await signToken({ iat: 1_790_000_000 });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.json()).toMatchObject({ issuedAt: 1_790_000_000 });
  });

  it('parses scopes from the space-separated scope claim', async () => {
    const token = await signToken({ azp: 'directory', scope: 'profile messages  email' });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.json()).toMatchObject({ scopes: ['profile', 'messages', 'email'] });
  });

  it('admits a token carrying the required scope', async () => {
    const token = await signToken({ azp: 'directory', scope: 'profile messages' });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/messages',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
  });

  it('rejects a token without the required scope as 403 problem details', async () => {
    const token = await signToken({ azp: 'console', scope: 'profile email' });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/messages',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(403);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({ status: 403, instance: '/v1/messages' });
  });

  it('serves public routes without a token', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/public' });

    expect(response.statusCode).toBe(200);
  });
});
