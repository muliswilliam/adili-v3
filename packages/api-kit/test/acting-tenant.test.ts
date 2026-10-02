import 'reflect-metadata';

import { Controller, Get } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ActingSubject,
  ActingTenant,
  type BaseEnv,
  CoreModule,
  createOpenApiDocument,
  InternalApi,
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

@Controller('internal/v1/things')
@InternalApi('things:internal')
class InternalThingsController {
  @Get()
  get(@ActingTenant() tenant: string, @ActingSubject() subject: unknown) {
    return { tenant, ...(subject === undefined ? {} : { subject }) };
  }
}

@Controller('internal/v1/others')
@InternalApi('others:internal')
class InternalOthersController {
  @Get()
  get(@ActingTenant() tenant: string) {
    return { tenant };
  }
}

describe('InternalApi and ActingTenant', () => {
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
        .setSubject('service-account-1')
        .setExpirationTime('5m')
        .sign(privateKey);

    const moduleRef = await Test.createTestingModule({
      imports: [CoreModule.forRoot({ serviceName: 'test', config })],
      controllers: [InternalThingsController, InternalOthersController],
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

  async function get(
    url: string,
    claims: Record<string, unknown>,
    actingTenant: string | undefined,
  ) {
    const token = await signToken(claims);
    return app.inject({
      method: 'GET',
      url,
      headers: {
        authorization: `Bearer ${token}`,
        ...(actingTenant === undefined ? {} : { 'x-acting-tenant': actingTenant }),
      },
    });
  }

  it('admits a service token with the scope, acting for the tenant in the header', async () => {
    const response = await get('/internal/v1/things', { scope: 'profile things:internal' }, 'psc');

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ tenant: 'psc' });
  });

  it('reads whom the service acts for from X-Acting-Subject', async () => {
    const token = await signToken({ scope: 'things:internal' });
    const response = await app.inject({
      method: 'GET',
      url: '/internal/v1/things',
      headers: {
        authorization: `Bearer ${token}`,
        'x-acting-tenant': 'psc',
        'x-acting-subject': 'officer-7',
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ tenant: 'psc', subject: 'officer-7' });
  });

  it('refuses tokens without the scope with 403, whatever their roles and headers', async () => {
    const user = await get(
      '/internal/v1/things',
      { tenant: 'psc', realm_access: { roles: ['platform-admin'] } },
      'psc',
    );
    const otherScope = await get('/internal/v1/things', { scope: 'others:internal' }, 'psc');

    expect(user.statusCode).toBe(403);
    expect(user.json()).toMatchObject({
      status: 403,
      detail: 'Requires a service token with scope things:internal.',
    });
    expect(otherScope.statusCode).toBe(403);
  });

  it('keeps each controller to its own scope', async () => {
    const response = await get('/internal/v1/others', { scope: 'others:internal' }, 'psc');

    expect(response.statusCode).toBe(200);
  });

  it.each([
    ['missing', undefined],
    ['not a tenant key', 'PSC!'],
    ['the platform context', 'platform'],
  ])('answers 400 when X-Acting-Tenant is %s', async (_case, header) => {
    const response = await get('/internal/v1/things', { scope: 'things:internal' }, header);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      errors: [{ path: 'X-Acting-Tenant', message: 'Must name the tenant the call acts for' }],
    });
  });

  it('documents the header, the 400 and the 403', () => {
    const { paths } = createOpenApiDocument(app, { name: 'test', description: 'test' });
    const operation = paths['/internal/v1/things']?.get;

    expect(operation?.parameters).toContainEqual(
      expect.objectContaining({ name: 'X-Acting-Tenant', in: 'header', required: true }),
    );
    expect(operation?.responses['400']).toMatchObject({
      description: 'X-Acting-Tenant is missing or not a tenant key',
    });
    expect(operation?.responses['403']).toMatchObject({
      description: 'Requires a service token with scope things:internal',
    });
  });
});
