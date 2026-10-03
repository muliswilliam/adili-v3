import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import {
  RATE_LIMIT_CLOCK,
  RATE_LIMIT_POLICIES,
  type RateLimitPolicy,
  TokenVerifier,
  TRUSTED_PROXIES_DEFAULT,
} from '@adili/api-kit';
import { createValkey, VALKEY } from '@adili/cache';
import { createDatabase, DATABASE, type Database } from '@adili/data-access';
import { TEMPORAL_CLIENT, TemporalWorkerReadinessCheck, WorkflowBundler } from '@adili/temporal';
import { prebuiltWorkflowBundler, untilWorkerPolling } from '@adili/temporal/testing';
import { type Client as TemporalClient, ScheduleNotFoundError } from '@temporalio/client';
import { sql } from 'drizzle-orm';
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';
import { inject } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { config } from '../../src/config.js';
import { Clock } from '../../src/clock.js';
import {
  ActivationLookups,
  InMemoryActivationLookups,
} from '../../src/commissions/activation-lookups.js';
import { type DirectorySchema, schema } from '../../src/db/schema.js';
import { IdentityProvisioning } from '../../src/identity/identity-provisioning.js';
import { InMemoryIdentityProvisioning } from '../../src/identity/in-memory-identity-provisioning.js';
import { InMemoryIprsLookup } from '../../src/onboarding/iprs/in-memory-iprs-lookup.js';
import { IprsLookup } from '../../src/onboarding/iprs/iprs-lookup.js';
import { InMemoryOtpDelivery } from '../../src/onboarding/otp/in-memory-otp-delivery.js';
import { OtpDelivery } from '../../src/onboarding/otp/otp-delivery.js';
import {
  InMemoryInvitationDelivery,
  InvitationDelivery,
} from '../../src/roster/records/invitation-delivery.js';
import {
  OnboardingExpirySchedule,
  onboardingExpiryScheduleId,
} from '../../src/onboarding/sessions/expiry-schedule.js';
import { InMemoryRosterUploads } from '../../src/roster/import/in-memory-roster-uploads.js';
import { RosterUploads } from '../../src/roster/import/roster-uploads.js';
import { TestClock } from './clock.js';
import { applyMigrations } from './migrations.js';

const ISSUER = 'http://keycloak.test/realms/adili';
const AUDIENCE = 'adili-api';

export interface Caller {
  sub?: string;
  tenant?: string | null;
  roles?: string[];
  /** The `name` claim; absent by default. */
  name?: string;
  /** The `scope` claim (space-separated), as client-credentials tokens carry; absent by default. */
  scope?: string;
  /** The `azp` claim: `console` by default, an HR system's client id for machine callers. */
  azp?: string;
  /** The `iat` claim in seconds since the epoch: when the token is signed by default. */
  iat?: number;
}

export interface WriteOptions {
  /** Random by default; null sends no header. */
  idempotencyKey?: string | null;
  /** Extra headers, e.g. `X-Acting-Tenant` for a service. */
  headers?: Record<string, string>;
}

export interface AnonymousRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  /** A JSON body. */
  body?: unknown;
  headers?: Record<string, string>;
  /**
   * The client address the request comes from (the socket's, which per-IP rate limits key on):
   * `203.0.113.10` by default. Give each test its own to keep budgets apart.
   */
  ip?: string;
}

export interface DirectoryApiOptions {
  /** Rate limit policies replacing the configured ones for these groups. */
  rateLimits?: Record<string, RateLimitPolicy>;
  /**
   * Also accept tokens Keycloak issues at this realm (e.g. a service's client credentials
   * token); locally signed tokens keep working.
   */
  keycloakIssuerUrl?: string;
}

export interface DirectoryApi {
  app: NestFastifyApplication;
  /** Direct database access for arranging fixtures; assertions go through HTTP. */
  db: Database<DirectorySchema>;
  identity: InMemoryIdentityProvisioning;
  /** Roster uploads the import endpoints read, standing in for the documents service. */
  uploads: InMemoryRosterUploads;
  /** The activation observer's cache of subjects without an invitation. */
  activationLookups: InMemoryActivationLookups;
  /** The service's clock and the rate limiter's; real time until a test sets it. */
  clock: TestClock;
  /** Onboarding one-time codes sent, with their codes (standing in for notifications). */
  otpDelivery: InMemoryOtpDelivery;
  /** Invitations to onboard sent to roster contacts (standing in for notifications). */
  invitations: InMemoryInvitationDelivery;
  /** IPRS as the confirm step sees it (standing in for the integration-gateway). */
  iprs: InMemoryIprsLookup;
  /** The suite's onboarding session expiry schedule, paused: trigger it to run the sweep. */
  expirySchedule: ReturnType<TemporalClient['schedule']['getHandle']>;
  /** A request without a bearer token, as the portal BFF calls the public onboarding routes. */
  anonymous(request: AnonymousRequest): ReturnType<NestFastifyApplication['inject']>;
  /**
   * `GET` as the given caller, with any extra `headers` (e.g. `X-Acting-Tenant` for a service);
   * returns Fastify's injected response.
   */
  get(
    url: string,
    caller: Caller,
    headers?: Record<string, string>,
  ): ReturnType<NestFastifyApplication['inject']>;
  /** `POST` a JSON body as the given caller, with an `Idempotency-Key` unless it is null. */
  post(
    url: string,
    body: unknown,
    caller: Caller,
    options?: WriteOptions,
  ): ReturnType<NestFastifyApplication['inject']>;
  /** `PUT` a JSON body as the given caller, with an `Idempotency-Key` unless it is null. */
  put(
    url: string,
    body: unknown,
    caller: Caller,
    options?: WriteOptions,
  ): ReturnType<NestFastifyApplication['inject']>;
  /** `DELETE` as the given caller. */
  delete(url: string, caller: Caller): ReturnType<NestFastifyApplication['inject']>;
  /** Empties every directory table except seeded reference data. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

/**
 * The directory service over HTTP against a real Postgres (`TEST_DATABASE_URL`), with tokens
 * signed locally, the in-memory identity adapter and in-memory roster uploads. Each suite gets a
 * private Postgres schema with the service's migrations applied, so suites can share the test
 * database. Roster imports run on compose Temporal through the service's own worker, polling a
 * task queue of the suite's own (test/support/temporal-task-queue.ts).
 *
 * Time is `api.clock` (the service's `Clock` and the rate limiter's), real until a test sets it.
 * Onboarding codes go to `api.otpDelivery`, IPRS lookups to `api.iprs`; the public onboarding routes are called with
 * `api.anonymous` (see test/support/onboarding.ts for arranging rosters and sessions).
 */
export async function startDirectoryApi(options: DirectoryApiOptions = {}): Promise<DirectoryApi> {
  const baseUrl = requireEnv('TEST_DATABASE_URL');
  const pgSchema = `directory_test_${process.pid}_${randomUUID().slice(0, 8)}`;
  const url = withSearchPath(baseUrl, pgSchema);

  const admin = createDatabase({ url: baseUrl, schema: {}, applicationName: 'directory-test' });
  await admin.execute(sql.raw(`create schema ${pgSchema}`));
  await admin.$client.end();

  const db = createDatabase({ url, schema, applicationName: 'directory-test' });
  await applyMigrations(db);

  const { signer, jwk } = await tokenSigner();
  const identity = new InMemoryIdentityProvisioning();
  const activationLookups = new InMemoryActivationLookups();
  const uploads = new InMemoryRosterUploads();
  const clock = new TestClock();
  const otpDelivery = new InMemoryOtpDelivery();
  const invitations = new InMemoryInvitationDelivery();
  const iprs = new InMemoryIprsLookup();
  // The suite's own key prefix, so rate limit budgets and throttles start fresh and never meet
  // another suite's (or an earlier run's) on the shared Valkey.
  const valkey = createValkey({
    url: requireEnv('TEST_VALKEY_URL'),
    keyPrefix: `${pgSchema}:`,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE)
    .useValue(db)
    .overrideProvider(TokenVerifier)
    .useValue(verifier(jwk, options.keycloakIssuerUrl))
    .overrideProvider(IdentityProvisioning)
    .useValue(identity)
    .overrideProvider(ActivationLookups)
    .useValue(activationLookups)
    .overrideProvider(RosterUploads)
    .useValue(uploads)
    .overrideProvider(VALKEY)
    .useValue(valkey)
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(RATE_LIMIT_CLOCK)
    .useValue(() => clock.now().getTime())
    .overrideProvider(OtpDelivery)
    .useValue(otpDelivery)
    .overrideProvider(InvitationDelivery)
    .useValue(invitations)
    .overrideProvider(IprsLookup)
    .useValue(iprs)
    .overrideProvider(RATE_LIMIT_POLICIES)
    .useValue({ ...config.RATE_LIMITS, ...options.rateLimits })
    .overrideProvider(WorkflowBundler)
    .useValue(prebuiltWorkflowBundler(inject('workflowBundles')))
    .compile();
  // Quiet like LOG_LEVEL=fatal in the service; expected 5xx in tests would otherwise log errors.
  // Proxies trusted as `createService` trusts them, so the client address is the socket's
  // unless a private-network proxy (the portal) sends X-Forwarded-For.
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ trustProxy: TRUSTED_PROXIES_DEFAULT }),
    { logger: ['fatal'] },
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  // Tests start once the worker polls, as traffic waits for readiness (see untilWorkerPolling).
  await untilWorkerPolling(app.get(TemporalWorkerReadinessCheck));
  // The suite's own expiry schedule (its task queue is the suite's) stays paused, so no sweep
  // ends sessions under a test that moves the clock; the schedule's test triggers it.
  const temporal = app.get<TemporalClient>(TEMPORAL_CLIENT);
  const expirySchedule = temporal.schedule.getHandle(onboardingExpiryScheduleId());
  if (!(await app.get(OnboardingExpirySchedule).ensure())) {
    throw new Error('The onboarding session expiry schedule could not be created');
  }
  await expirySchedule.pause('Tests trigger the sweep themselves');

  const write = async (
    method: 'POST' | 'PUT',
    path: string,
    body: unknown,
    caller: Caller,
    { idempotencyKey = randomUUID(), headers = {} }: WriteOptions = {},
  ) => {
    const token = await signer(caller);
    return app.inject({
      method,
      url: path,
      headers: {
        ...headers,
        authorization: `Bearer ${token}`,
        ...(idempotencyKey === null ? {} : { 'idempotency-key': idempotencyKey }),
      },
      payload: body as Record<string, unknown>,
    });
  };

  return {
    app,
    db,
    identity,
    uploads,
    activationLookups,
    clock,
    otpDelivery,
    invitations,
    iprs,
    expirySchedule,
    anonymous({ method = 'GET', url: path, body, headers = {}, ip = '203.0.113.10' }) {
      return app.inject({
        method,
        url: path,
        headers,
        remoteAddress: ip,
        ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
      });
    },
    async get(path, caller, headers = {}) {
      const token = await signer(caller);
      return app.inject({
        method: 'GET',
        url: path,
        headers: { ...headers, authorization: `Bearer ${token}` },
      });
    },
    post(path, body, caller, options) {
      return write('POST', path, body, caller, options);
    },
    put(path, body, caller, options) {
      return write('PUT', path, body, caller, options);
    },
    async delete(path, caller) {
      const token = await signer(caller);
      return app.inject({
        method: 'DELETE',
        url: path,
        headers: { authorization: `Bearer ${token}` },
      });
    },
    async reset() {
      await db.execute(
        sql`truncate onboarding_invitations, onboarding_otps, onboarding_sessions, onboarding_failures, law_enforcement_officers, persons, numbering_counters, roster_import_batches, roster_import_rows, roster_exits, roster_records, reporting_entities, roster_summaries, roster_imports, roster_api_credentials, reporting_officer_assignments, tenant_policy_versions, commission_categories, commissions, outbox, inbox, idempotency_keys`,
      );
      identity.reset();
      otpDelivery.reset();
      invitations.reset();
      iprs.reset();
      clock.reset();
      uploads.reset();
      activationLookups.expireAll();
    },
    async close() {
      // Suites that start a second app share its task queue, and so its schedule.
      await expirySchedule.delete().catch((error: unknown) => {
        if (!(error instanceof ScheduleNotFoundError)) throw error;
      });
      // Closing the app ends the pool (DatabaseModule lifecycle), so drop the schema first.
      await db.execute(sql.raw(`drop schema if exists ${pgSchema} cascade`));
      await app.close();
    },
  };
}

async function tokenSigner(): Promise<{ signer: (caller: Caller) => Promise<string>; jwk: JWK }> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256' };
  const signer = ({
    sub = randomUUID(),
    tenant = null,
    roles = [],
    name,
    scope,
    azp = 'console',
    iat,
  }: Caller) =>
    new SignJWT({ azp, tenant, realm_access: { roles }, name, scope })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuedAt(iat)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(sub)
      .setExpirationTime('5m')
      .sign(privateKey);
  return { signer, jwk };
}

function verifier(jwk: JWK, keycloakIssuerUrl: string | undefined): Pick<TokenVerifier, 'verify'> {
  const local = new TokenVerifier(ISSUER, AUDIENCE, createLocalJWKSet({ keys: [jwk] }));
  if (!keycloakIssuerUrl) return local;
  const keycloak = new TokenVerifier(keycloakIssuerUrl, AUDIENCE);
  return { verify: (token) => local.verify(token).catch(() => keycloak.verify(token)) };
}

function withSearchPath(databaseUrl: string, pgSchema: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('options', `-c search_path=${pgSchema}`);
  return url.toString();
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; see vitest.integration.config.ts`);
  return value;
}
