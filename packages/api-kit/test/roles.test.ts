import 'reflect-metadata';

import { Controller, Get, Param } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type BaseEnv,
  CoreModule,
  createOpenApiDocument,
  CurrentPrincipal,
  notFoundIfInvisible,
  type Principal,
  Roles,
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

@Controller('v1/rosters')
@Roles('platform-admin')
class RostersController {
  @Get('officer-or-client')
  @Roles('reporting-officer')
  @Scopes('roster:write')
  both() {
    return { ok: true };
  }

  @Get('client')
  @Scopes('roster:write', 'roster:read')
  client() {
    return { ok: true };
  }

  @Get('admin')
  admin() {
    return { ok: true };
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
      controllers: [ThingsController, RostersController],
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

  async function get(url: string, roles: string[], tenant = 'psc', scope?: string) {
    const token = await signToken({ tenant, realm_access: { roles }, scope });
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

  describe('with scopes', () => {
    const client = (url: string, scope: string) => get(url, [], 'psc', scope);

    it('admits a role holder or a scope holder where both are accepted', async () => {
      expect((await get('/v1/rosters/officer-or-client', ['reporting-officer'])).statusCode).toBe(
        200,
      );
      expect(
        (await client('/v1/rosters/officer-or-client', 'profile roster:write')).statusCode,
      ).toBe(200);
    });

    it('refuses a token with neither the role nor the scope with 403 problem details', async () => {
      const response = await get('/v1/rosters/officer-or-client', ['declarant'], 'psc', 'profile');

      expect(response.statusCode).toBe(403);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.json()).toMatchObject({ status: 403, title: 'Forbidden' });
    });

    it('admits a token carrying any one of the scopes', async () => {
      expect((await client('/v1/rosters/client', 'roster:read')).statusCode).toBe(200);
      expect((await client('/v1/rosters/client', 'roster')).statusCode).toBe(403);
    });

    it('does not read scopes as roles or roles as scopes', async () => {
      expect((await get('/v1/rosters/client', ['roster:write'])).statusCode).toBe(403);
      expect((await client('/v1/rosters/officer-or-client', 'reporting-officer')).statusCode).toBe(
        403,
      );
    });

    it('lets a route-level @Scopes replace the controller roles', async () => {
      expect((await get('/v1/rosters/client', ['platform-admin'])).statusCode).toBe(403);
      expect((await get('/v1/rosters/admin', ['platform-admin'])).statusCode).toBe(200);
    });

    it('documents the combined rule as the 403 response', () => {
      const { paths } = createOpenApiDocument(app, { name: 'test', description: 'test' });
      const forbidden = (path: string) =>
        (paths[path]?.get?.responses['403'] as { description: string } | undefined)?.description;

      expect(forbidden('/v1/rosters/officer-or-client')).toBe(
        'Requires one of the roles: reporting-officer, or one of the scopes: roster:write',
      );
      expect(forbidden('/v1/rosters/client')).toBe(
        'Requires one of the scopes: roster:write, roster:read',
      );
      expect(forbidden('/v1/rosters/admin')).toBe('Requires one of the roles: platform-admin');
    });
  });
});
