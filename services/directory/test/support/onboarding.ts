import { PLATFORM_TENANT } from '@adili/api-kit';
import { randomUUID } from 'node:crypto';

import { withTenant } from '@adili/data-access';
import { allocateReference, OFR } from '@adili/numbering';
import type { ContactChannel } from '@adili/contacts';
import { eq, inArray } from 'drizzle-orm';

import { config } from '../../src/config.js';
import {
  onboardingOtps,
  onboardingSessions,
  persons,
  reportingEntities,
  rosterImports,
  rosterRecords,
} from '../../src/db/schema.js';
import { otpCodeHmac } from '../../src/onboarding/otp/otp-codes.js';
import { hashSessionSecret, newSessionSecret } from '../../src/onboarding/secret.js';
import {
  isTerminal,
  ONBOARDING_TIMING,
  type OnboardingState,
} from '../../src/onboarding/session-state.js';
import type { ContactSource, RosterRecordState } from '../../src/roster/schema.js';
import { recomputeRosterSummary } from '../../src/roster/summary.js';
import type { DirectoryApi } from './directory-api.js';

/**
 * Onboarding test support, for every onboarding suite (identify, codes and contacts, confirm,
 * declarant profile). Arrange with these, act over HTTP with `api.anonymous` or the helpers
 * below, and control time with `api.clock`:
 *
 * - `givenRoster(api, 'tsc', [...])`: a Commission's roster as a completed import leaves it
 *   (`hasRoster` true), records in any state. Returns record ids by file number.
 * - `givenSession(api, { recordId, state, ... })`: a session in any state, e.g. `phone-verified`
 *   for confirm tests, optionally with a channel's current code. Returns its id and secret.
 * - `givenOnboardedPerson(api, { recordIds })`: a person onboarded against records, as confirm
 *   leaves them (person with OFR and Keycloak user id, records `onboarded`), for the profile and
 *   lookup tests. `givenIdentityMismatch(api, recordId)`: as a confirm refused by IPRS leaves it.
 * - `identify`, `getSession`, `onSession`: the public routes as the portal calls them.
 * - `api.otpDelivery`: codes sent (`last(to)?.code`), `failNext()` to make a send fail.
 * - `api.iprs`: `givenPerson(nationalId, names)` for the confirm step, `failNext()` for an outage.
 *
 * Commissions themselves come from `givenCommissions` (fixtures.ts).
 */

export interface RecordFixture {
  personnelFileNumber: string;
  fullName: string;
  nationalId: string;
  designation?: string | null;
  reportingEntity?: string | null;
  email?: string | null;
  /** E.164. */
  phone?: string | null;
  state?: RosterRecordState;
}

/**
 * Arranges `slug`'s roster as one completed file import of `records` would leave it, so the
 * Commission `hasRoster` and identify can match its records. Returns record ids by file number.
 */
export async function givenRoster(
  api: DirectoryApi,
  slug: string,
  records: RecordFixture[],
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  await withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, async (tx) => {
    const [rosterImport] = await tx
      .insert(rosterImports)
      .values({
        tenant: slug,
        channel: 'file',
        declaredComplete: true,
        fileName: `${slug}.csv`,
        format: 'csv',
        state: 'completed',
        totalRows: records.length,
        processedRows: records.length,
        chunkCount: 1,
        startedByKind: 'user',
        startedBy: 'officer',
        completedAt: new Date(),
      })
      .returning({ id: rosterImports.id });
    if (!rosterImport) throw new Error('insert returned no row');
    for (const record of records) {
      let reportingEntityId: string | null = null;
      if (record.reportingEntity) {
        const [entity] = await tx
          .insert(reportingEntities)
          .values({
            tenant: slug,
            name: record.reportingEntity,
            normalisedName: record.reportingEntity.toLowerCase(),
          })
          .onConflictDoUpdate({
            target: [reportingEntities.tenant, reportingEntities.normalisedName],
            set: { name: record.reportingEntity },
          })
          .returning({ id: reportingEntities.id });
        reportingEntityId = entity?.id ?? null;
      }
      const state = record.state ?? 'not_onboarded';
      const [inserted] = await tx
        .insert(rosterRecords)
        .values({
          tenant: slug,
          personnelFileNumber: record.personnelFileNumber,
          fullName: record.fullName,
          nationalId: record.nationalId,
          designation: record.designation ?? null,
          reportingEntityId,
          email: record.email ?? null,
          phone: record.phone ?? null,
          state,
          exitDate: state === 'exited' ? '2026-06-30' : null,
          stateBeforeExit: state === 'exited' ? 'not_onboarded' : null,
          onboardedAt: state === 'onboarded' ? new Date('2026-09-01T08:00:00Z') : null,
          source: 'file',
          firstSeenImportId: rosterImport.id,
          lastSeenImportId: rosterImport.id,
        })
        .returning({ id: rosterRecords.id });
      if (!inserted) throw new Error('insert returned no row');
      ids.set(record.personnelFileNumber, inserted.id);
    }
    await recomputeRosterSummary(tx, slug, { id: rosterImport.id, declaredComplete: true });
  });
  return ids;
}

export interface SessionFixture {
  recordId: string;
  state: OnboardingState;
  /** The contacts in use; the record's are not read. Null (the default) means none. */
  email?: string | null;
  emailSource?: ContactSource;
  emailVerified?: boolean;
  phone?: string | null;
  phoneSource?: ContactSource;
  phoneVerified?: boolean;
  /** `api.clock.now()` by default. */
  createdAt?: Date;
  /** 30 minutes after `createdAt` by default. */
  expiresAt?: Date;
  /** The channel's current code, as `OtpIssuer` would have stored it when sending `code`. */
  otp?: {
    channel: ContactChannel;
    code: string;
    /** `createdAt` by default. */
    sentAt?: Date;
    attempts?: number;
    resends?: number;
  };
}

/**
 * Arranges an onboarding session in any state, as the steps before it would have left it, for
 * the record `recordId` (its tenant is the record's). Returns the session id and its secret.
 */
export async function givenSession(
  api: DirectoryApi,
  fixture: SessionFixture,
): Promise<{ id: string; secret: string }> {
  const secret = newSessionSecret();
  const createdAt = fixture.createdAt ?? api.clock.now();
  const expiresAt =
    fixture.expiresAt ?? new Date(createdAt.getTime() + ONBOARDING_TIMING.sessionTtlMs);
  const email = fixture.email ?? null;
  const phone = fixture.phone ?? null;
  const id = await withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, async (tx) => {
    const [record] = await tx
      .select({ tenant: rosterRecords.tenant })
      .from(rosterRecords)
      .where(eq(rosterRecords.id, fixture.recordId));
    if (!record) throw new Error(`no roster record ${fixture.recordId}`);
    const [session] = await tx
      .insert(onboardingSessions)
      .values({
        id: randomUUID(),
        tenant: record.tenant,
        rosterRecordId: fixture.recordId,
        secretHash: hashSessionSecret(secret),
        state: fixture.state,
        email,
        emailSource: email === null ? null : (fixture.emailSource ?? 'roster'),
        emailVerifiedAt: fixture.emailVerified ? createdAt : null,
        phone,
        phoneSource: phone === null ? null : (fixture.phoneSource ?? 'roster'),
        phoneVerifiedAt: fixture.phoneVerified ? createdAt : null,
        endReason: isTerminal(fixture.state)
          ? fixture.state === 'expired'
            ? 'expired'
            : fixture.state
          : null,
        completedAt: isTerminal(fixture.state) ? createdAt : null,
        expiresAt,
        createdAt,
        updatedAt: createdAt,
      })
      .returning({ id: onboardingSessions.id });
    if (!session) throw new Error('insert returned no row');
    if (fixture.otp) {
      const sentAt = fixture.otp.sentAt ?? createdAt;
      await tx.insert(onboardingOtps).values({
        sessionId: session.id,
        channel: fixture.otp.channel,
        tenant: record.tenant,
        codeHmac: otpCodeHmac(
          config.ONBOARDING_HMAC_KEY,
          session.id,
          fixture.otp.channel,
          fixture.otp.code,
        ),
        expiresAt: new Date(sentAt.getTime() + ONBOARDING_TIMING.otpTtlMs),
        attempts: fixture.otp.attempts ?? 0,
        resends: fixture.otp.resends ?? 0,
        lastSentAt: sentAt,
      });
    }
    return session.id;
  });
  return { id, secret };
}

export interface IdentifyInput {
  commission: string;
  personnelFileNumber: string;
  nationalId: string;
}

/** `POST /v1/onboarding/sessions` from the client address `ip`. */
export function identify(api: DirectoryApi, body: IdentifyInput, ip?: string) {
  return api.anonymous({ method: 'POST', url: '/v1/onboarding/sessions', body, ip });
}

/** `GET /v1/onboarding/sessions/{id}` with `secret` in X-Onboarding-Secret (none if undefined). */
export function getSession(api: DirectoryApi, id: string, secret: string | undefined, ip?: string) {
  return onSession(api, 'GET', id, '', secret, undefined, ip);
}

/**
 * A call on a session: `path` below `/v1/onboarding/sessions/{id}` (e.g. `/otp/email/verify`),
 * with `secret` in X-Onboarding-Secret (none if undefined). A POST carries a fresh
 * Idempotency-Key, as the portal sends one per submission (`confirm` and
 * `resend-password-email` require it; the other steps ignore it).
 */
export function onSession(
  api: DirectoryApi,
  method: 'GET' | 'POST',
  id: string,
  path: string,
  secret: string | undefined,
  body?: unknown,
  ip?: string,
) {
  return api.anonymous({
    method,
    url: `/v1/onboarding/sessions/${id}${path}`,
    headers: {
      ...(secret === undefined ? {} : { 'x-onboarding-secret': secret }),
      ...(method === 'POST' ? { 'idempotency-key': randomUUID() } : {}),
    },
    body,
    ip,
  });
}

export interface OnboardedPersonFixture {
  /** Roster records the person onboarded against; the first gives their name and national ID. */
  recordIds: string[];
  /** The `sub` of the person's tokens; random by default. */
  keycloakUserId?: string;
  email?: string | null;
  /** E.164. */
  phone?: string | null;
  /** `api.clock.now()` by default. */
  onboardedAt?: Date;
}

export interface OnboardedPerson {
  personId: string;
  ofr: string;
  keycloakUserId: string;
}

/**
 * Arranges a person onboarded against `recordIds`, as confirm would leave them: a person with an
 * allocated OFR and a Keycloak user id, and each record `onboarded`, linked, with `onboardedAt`
 * and its Commission's summary recounted.
 */
export async function givenOnboardedPerson(
  api: DirectoryApi,
  fixture: OnboardedPersonFixture,
): Promise<OnboardedPerson> {
  const keycloakUserId = fixture.keycloakUserId ?? randomUUID();
  const onboardedAt = fixture.onboardedAt ?? api.clock.now();
  return withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, async (tx) => {
    const records = await tx
      .select({
        id: rosterRecords.id,
        tenant: rosterRecords.tenant,
        fullName: rosterRecords.fullName,
        nationalId: rosterRecords.nationalId,
      })
      .from(rosterRecords)
      .where(inArray(rosterRecords.id, fixture.recordIds));
    const first = records.find((record) => record.id === fixture.recordIds[0]);
    if (!first || records.length !== fixture.recordIds.length) {
      throw new Error(`no roster records ${fixture.recordIds.join(', ')}`);
    }
    const ofr = await allocateReference(tx, OFR);
    const [person] = await tx
      .insert(persons)
      .values({
        nationalId: first.nationalId,
        fullName: first.fullName,
        ofr,
        keycloakUserId,
        email: fixture.email ?? null,
        phone: fixture.phone ?? null,
        createdAt: onboardedAt,
      })
      .returning({ id: persons.id });
    if (!person) throw new Error('insert returned no row');
    await tx
      .update(rosterRecords)
      .set({ state: 'onboarded', personId: person.id, onboardedAt })
      .where(inArray(rosterRecords.id, fixture.recordIds));
    for (const tenant of new Set(records.map((record) => record.tenant))) {
      await recomputeRosterSummary(tx, tenant);
    }
    return { personId: person.id, ofr, keycloakUserId };
  });
}

/** Marks `recordId` as a confirm refused by IPRS leaves it: `identityMismatchAt` set. */
export async function givenIdentityMismatch(
  api: DirectoryApi,
  recordId: string,
  at: Date = api.clock.now(),
): Promise<void> {
  await withTenant(api.db, { tenant: PLATFORM_TENANT, subject: 'test' }, (tx) =>
    tx.update(rosterRecords).set({ identityMismatchAt: at }).where(eq(rosterRecords.id, recordId)),
  );
}
