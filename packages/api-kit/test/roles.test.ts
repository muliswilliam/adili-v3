import 'reflect-metadata';

import { Controller, Get, Param } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type BaseEnv,
  CoreModule,
  CurrentPrincipal,
  notFoundIfInvisible,
  type Principal,
  Roles,
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

const THINGS = [
  { id: 'a', tenant: 'psc' },
  { id: 'b', tenant: 'tsc' },
];

@Controller('v1/things')
@Roles('reviewer', 'platform-admin')
class ThingsController {
  @Get(':id')
  get(@Param('id') id: string, @CurrentPrincipal() principal: Principal) {
    return notFoundIfInvisible(
      THINGS.find((thing) => thing.id === id),
      (thing) => principal.roles.includes('platform-admin') || thing.tenant === principal.tenant,
    );
  }

  @Get()
  @Roles('platform-admin')
  list() {
    return THINGS;
  }
}

describe('Roles and notFoundIfInvisible', () => {
  let app: NestFastifyApplication;
  let signToken: (claims: Record<string, unknown>) => Promise<string>;

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256' };
    signToken = (claims) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'test' })
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setSubject('user-1')
        .setExpirationTime('5m')
        .sign(privateKey);

    const moduleRef = await Test.createTestingModule({
      imports: [CoreModule.forRoot({ serviceName: 'test', config })],
      controllers: [ThingsController],
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

  async function get(url: string, roles: string[], tenant = 'psc') {
    const token = await signToken({ tenant, realm_access: { roles } });
    return app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
  }

  it('lets a caller with one of the controller roles in', async () => {
    const response = await get('/v1/things/a', ['reviewer']);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: 'a', tenant: 'psc' });
  });

  it('refuses a caller without any of the roles with 403 problem details', async () => {
    const response = await get('/v1/things/a', ['declarant']);

    expect(response.statusCode).toBe(403);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({ status: 403, title: 'Forbidden' });
  });

  it('refuses a token without roles', async () => {
    expect((await get('/v1/things/a', [])).statusCode).toBe(403);
  });

  it('lets a route-level @Roles replace the controller roles', async () => {
    expect((await get('/v1/things', ['reviewer'])).statusCode).toBe(403);
    expect((await get('/v1/things', ['platform-admin'])).statusCode).toBe(200);
  });

  it('answers 404 for a record in another tenant, like a missing one', async () => {
    const invisible = await get('/v1/things/b', ['reviewer']);
    const missing = await get('/v1/things/zzz', ['reviewer']);

    expect(invisible.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(invisible.json()).toEqual({ ...missing.json(), instance: '/v1/things/b' });
  });
});
