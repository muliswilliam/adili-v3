import 'reflect-metadata';

import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { TokenVerifier } from '@adili/api-kit';
import { createDatabase, DATABASE, type Database } from '@adili/data-access';
import { OutboxRelay } from '@adili/events';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import pg from 'pg';

import { AppModule } from '../../src/app.module.js';
import { config } from '../../src/config.js';
import { schema } from '../../src/db/schema.js';
import { DIRECTORY_CONTACTS } from '../../src/contacts/contacts.module.js';
import type { PersonContactsSource } from '../../src/contacts/person-contacts.js';
import { EMAIL_SENDER, type MessageSender, SMS_SENDER } from '../../src/messages/message-sender.js';

const MIGRATIONS = new URL('../../migrations', import.meta.url).pathname;

export interface TestApp {
  app: NestFastifyApplication;
  db: Database<typeof schema>;
  /** Signs an access token as the given OAuth client with the given scopes. */
  token: (options?: { clientId?: string; scope?: string }) => Promise<string>;
  close: () => Promise<void>;
}

export interface TestAppOptions {
  email?: MessageSender;
  sms?: MessageSender;
  /** Stands in for the directory; the service's contacts cache still sits in front of it. */
  contacts?: PersonContactsSource;
}

/**
 * Boots the service against a fresh Postgres schema in the shared test database, so parallel
 * runs never see each other's rows. Senders default to the configured adapters.
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const baseUrl = requireEnv('TEST_DATABASE_URL');
  const schemaName = `notifications_test_${process.pid}_${Date.now()}`;
  const url = withSearchPath(baseUrl, schemaName);

  const admin = new pg.Pool({ connectionString: baseUrl, max: 1 });
  await admin.query(`create schema "${schemaName}"`);
  const migrator = new pg.Pool({ connectionString: url, max: 1 });
  await migrate(drizzle({ client: migrator }), {
    migrationsFolder: MIGRATIONS,
    migrationsSchema: schemaName,
  });
  await migrator.end();

  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256' };

  const db = createDatabase({ url, schema, applicationName: 'notifications-test' });
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE)
    .useValue(db)
    .overrideProvider(TokenVerifier)
    .useValue(
      new TokenVerifier(
        config.OIDC_ISSUER_URL,
        config.OIDC_AUDIENCE,
        createLocalJWKSet({ keys: [jwk] }),
      ),
    )
    // Events stay in the outbox: a live relay would publish them to the shared broker.
    .overrideProvider(OutboxRelay)
    .useValue({});
  if (options.email) builder = builder.overrideProvider(EMAIL_SENDER).useValue(options.email);
  if (options.sms) builder = builder.overrideProvider(SMS_SENDER).useValue(options.sms);
  if (options.contacts) {
    builder = builder.overrideProvider(DIRECTORY_CONTACTS).useValue(options.contacts);
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return {
    app,
    db,
    token: ({ clientId = 'directory', scope = 'profile messages' } = {}) =>
      new SignJWT({ azp: clientId, scope })
        .setProtectedHeader({ alg: 'RS256', kid: 'test' })
        .setIssuer(config.OIDC_ISSUER_URL)
        .setAudience(config.OIDC_AUDIENCE)
        .setSubject(`service-account-${clientId}`)
        .setExpirationTime('5m')
        .sign(privateKey),
    close: async () => {
      // Closing the app ends the database pool.
      await app.close();
      await admin.query(`drop schema "${schemaName}" cascade`);
      await admin.end();
    },
  };
}

function withSearchPath(url: string, schemaName: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('options', `-c search_path=${schemaName}`);
  return parsed.toString();
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required (see vitest.integration.config.ts)`);
  }
  return value;
}
