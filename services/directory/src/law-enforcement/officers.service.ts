import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  notFoundIfInvisible,
  type Principal,
  ProblemException,
  PLATFORM_TENANT,
} from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { LAW_ENFORCEMENT } from '@adili/roles';
import { and, asc, eq, sql } from 'drizzle-orm';

import { config } from '../config.js';
import { ActivationLookups } from '../commissions/activation-lookups.js';
import type { Transaction } from '../commissions/commissions.service.js';
import { IdentityChanges } from '../commissions/identity-changes.js';
import { ACTIVATION_LIFESPAN_SECONDS } from '../commissions/reporting-officers.service.js';
import { failedToLock } from '../db/errors.js';
import type { DirectorySchema } from '../db/schema.js';
import {
  type ActivationEmailOptions,
  EmailTaken,
  IdentityProvisioning,
  IdentityUnavailable,
  IdentityUserNotFound,
  STAFF_REQUIRED_ACTIONS,
} from '../identity/identity-provisioning.js';
import { newPersonId } from '../persons/person-id.js';
import { persons } from '../persons/schema.js';
import { leaAccountProvisioned, leaAccountRevoked, leaAccountUpdated } from './events.js';
import type {
  Agency,
  InternalLeaOfficer,
  LeaOfficerAccount,
  ProvisionAgencyOfficerBody,
} from './representation.js';
import { agencies, lawEnforcementOfficers, type LeaOfficerState } from './schema.js';

/**
 * How long provisioning waits for another provisioning of the same email, or a revoke of the
 * same officer, before it is refused (409): the one holding the lock may be waiting on Keycloak.
 */
export const LEA_OFFICER_LOCK_WAIT = '3s';

/**
 * The activation email of a law-enforcement officer: the staff one (verify the email, enrol
 * TOTP, set a password; 72 hours; back to the console's `/auth/login`), naming the agency where a
 * staff invitation names the Commission.
 */
export function leaActivationEmail(
  agencyName: string,
  consoleUrl: string = config.CONSOLE_URL,
): ActivationEmailOptions {
  return {
    actions: STAFF_REQUIRED_ACTIONS,
    lifespanSeconds: ACTIVATION_LIFESPAN_SECONDS,
    redirectUri: new URL('/auth/login', consoleUrl).toString(),
    clientId: 'console',
    commissionName: agencyName,
    role: LAW_ENFORCEMENT,
  };
}

const ACCOUNT_COLUMNS = {
  personId: lawEnforcementOfficers.personId,
  agencyCode: lawEnforcementOfficers.agencyCode,
  name: persons.fullName,
  email: persons.email,
  phone: persons.phone,
  keycloakUserId: persons.keycloakUserId,
  state: lawEnforcementOfficers.state,
  invitedAt: lawEnforcementOfficers.invitedAt,
  activatedAt: lawEnforcementOfficers.activatedAt,
  revokedAt: lawEnforcementOfficers.revokedAt,
};

/** An officer as read with {@link ACCOUNT_COLUMNS}. */
interface OfficerRow {
  personId: string;
  agencyCode: string;
  name: string;
  /** Provisioned with both; nullable only because declarants' may be. */
  email: string | null;
  phone: string | null;
  keycloakUserId: string;
  state: LeaOfficerState;
  invitedAt: Date;
  activatedAt: Date | null;
  revokedAt: Date | null;
}

/**
 * Law-enforcement officer accounts (spec 10): a platform admin provisions an officer for an
 * agency, which creates their directory person (kind `law-enforcement`) and their Keycloak
 * account (role `law-enforcement`, tenant `lea`, the `agency` and `person_id` attributes, the
 * staff required actions), and revokes them, which disables the account. Officers are platform
 * data, so every read and write runs in the platform context.
 *
 * As for reporting officers, identity changes are recorded with their undo and undone when a
 * later step (or the commit) fails, so a retry with the same Idempotency-Key starts from what
 * Keycloak looked like before; the activation email is sent only once the provisioning has
 * committed.
 */
@Injectable()
export class LawEnforcementOfficersService {
  private readonly logger = new Logger(LawEnforcementOfficersService.name);

  constructor(
    @InjectDatabase() private readonly db: Database<DirectorySchema>,
    private readonly events: EventPublisher,
    private readonly identity: IdentityProvisioning,
    private readonly activationLookups: ActivationLookups,
  ) {}

  /** The registered agencies, in display order. */
  listAgencies(principal: Principal): Promise<Agency[]> {
    return this.inPlatformContext(principal, (tx) =>
      tx
        .select({ code: agencies.code, name: agencies.name, legalBasis: agencies.legalBasis })
        .from(agencies)
        .orderBy(asc(agencies.sortOrder), asc(agencies.code)),
    );
  }

  /** The agency's officer accounts, by name; 404 when there is no such agency. */
  listOfficers(principal: Principal, code: string): Promise<LeaOfficerAccount[]> {
    return this.inPlatformContext(principal, async (tx) => {
      await this.findAgency(tx, code);
      const rows = await this.accounts(tx)
        .where(eq(lawEnforcementOfficers.agencyCode, code))
        .orderBy(asc(persons.fullName), asc(lawEnforcementOfficers.personId));
      return rows.map(account);
    });
  }

  /**
   * Officer `personId` with their agency, for the access service's provenance check of a law
   * enforcement request (r.23(1)); 404 when no officer has this id. Revoked officers are
   * returned too: the request they filed stays theirs.
   */
  async internalOfficer(subject: string, personId: string): Promise<InternalLeaOfficer> {
    const [found] = await withTenant(this.db, { tenant: PLATFORM_TENANT, subject }, (tx) =>
      tx
        .select({
          ...ACCOUNT_COLUMNS,
          agencyName: agencies.name,
          agencyLegalBasis: agencies.legalBasis,
        })
        .from(lawEnforcementOfficers)
        .innerJoin(persons, eq(persons.id, lawEnforcementOfficers.personId))
        .innerJoin(agencies, eq(agencies.code, lawEnforcementOfficers.agencyCode))
        .where(eq(lawEnforcementOfficers.personId, personId)),
    );
    const officer = notFoundIfInvisible(found);
    return {
      personId: officer.personId,
      keycloakUserId: officer.keycloakUserId,
      name: officer.name,
      agency: {
        code: officer.agencyCode,
        name: officer.agencyName,
        legalBasis: officer.agencyLegalBasis,
      },
      state: officer.state,
      activatedAt: officer.activatedAt?.toISOString() ?? null,
      revokedAt: officer.revokedAt?.toISOString() ?? null,
    };
  }

  /**
   * Provisions an officer for the agency: a new person and account in state `invited`, with
   * `lea.account.provisioned.v1`, and one activation email after the commit.
   *
   * The officer's email again converges instead of creating anyone twice: an officer of this
   * agency gets the name and phone as now entered (and, while still `invited`, their activation
   * email again); a revoked one is enabled and invited again, with a new event. An email that
   * belongs to an officer of another agency, or to any account that is not an officer's, is
   * refused (409).
   */
  async provision(
    principal: Principal,
    code: string,
    body: ProvisionAgencyOfficerBody,
  ): Promise<LeaOfficerAccount> {
    const changes = new IdentityChanges(this.logger);
    let provisioned: Provisioned;
    try {
      provisioned = await this.inPlatformContext(principal, (tx) =>
        this.provisionWithin(tx, principal, code, body, changes).catch(async (error: unknown) => {
          // Undone while the email is still locked, so that a concurrent provisioning cannot
          // build on an account that is being put back.
          await changes.undo();
          throw error;
        }),
      );
    } catch (error) {
      // Changes are still recorded here only when the commit itself failed.
      await changes.undo();
      throw asProblem(
        error,
        'The identity provider did not respond, so the officer was not provisioned. Try again.',
      );
    }
    const { officer, agencyName, newlyInvited, sendEmail } = provisioned;
    if (newlyInvited) {
      // A reused account may be remembered as having no invitation; look it up again next time.
      await this.activationLookups.forget(officer.keycloakUserId);
    }
    if (sendEmail) await this.sendAfterProvisioning(officer.keycloakUserId, agencyName);
    return account(officer);
  }

  /**
   * Revokes the officer: disables their account and records `revoked` with
   * `lea.account.revoked.v1`. Revoking a revoked officer changes nothing. 404 when no officer
   * has this id.
   */
  async revoke(principal: Principal, personId: string): Promise<LeaOfficerAccount> {
    const changes = new IdentityChanges(this.logger);
    try {
      return await this.inPlatformContext(principal, (tx) =>
        this.revokeWithin(tx, personId, changes).catch(async (error: unknown) => {
          await changes.undo();
          throw error;
        }),
      );
    } catch (error) {
      await changes.undo();
      throw asProblem(
        error,
        'The identity provider did not respond, so the officer was not revoked. Try again.',
      );
    }
  }

  private async provisionWithin(
    tx: Transaction,
    principal: Principal,
    code: string,
    body: ProvisionAgencyOfficerBody,
    changes: IdentityChanges,
  ): Promise<Provisioned> {
    const agency = await this.findAgency(tx, code);
    // Provisionings of one email take turns, so that two cannot both find no account.
    await tx.execute(sql.raw(`set local lock_timeout = '${LEA_OFFICER_LOCK_WAIT}'`));
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`lea-officer:${body.email}`}, 0))`,
    );
    const now = new Date();
    const existing = await this.identity.findByEmail(body.email);
    if (!existing) {
      const personId = await newPersonId(tx);
      const keycloakUserId = await this.identity.createLawEnforcementUser({
        email: body.email,
        name: body.name,
        phone: body.phone,
        agency: agency.code,
        personId,
      });
      changes.made(`created ${keycloakUserId}`, () => this.identity.deleteUser(keycloakUserId));
      await tx.insert(persons).values({
        id: personId,
        kind: 'law-enforcement',
        fullName: body.name,
        email: body.email,
        phone: body.phone,
        keycloakUserId,
      });
      await tx.insert(lawEnforcementOfficers).values({
        personId,
        agencyCode: agency.code,
        state: 'invited',
        invitedAt: now,
        createdBy: principal.subject,
      });
      await this.events.record(
        tx,
        leaAccountProvisioned({ personId, agencyCode: agency.code, keycloakUserId }),
      );
      return {
        officer: await this.lockedAccount(tx, personId),
        agencyName: agency.name,
        newlyInvited: true,
        sendEmail: true,
      };
    }

    const officer = await this.officerOfAccount(tx, existing.userId);
    if (!officer) throw emailTaken();
    if (officer.agencyCode !== agency.code) throw officerOfOtherAgency();
    const { personId, keycloakUserId } = officer;
    const restore = await this.identity.updateProfile(keycloakUserId, {
      name: body.name,
      phone: body.phone,
    });
    if (restore) changes.made(`updated the name and phone of ${keycloakUserId}`, restore);
    await tx
      .update(persons)
      .set({ fullName: body.name, phone: body.phone })
      .where(eq(persons.id, personId));
    if (officer.state !== 'revoked') {
      // Every write is recorded (ADR-008): the account and the person now hold the name and phone.
      await this.events.record(
        tx,
        leaAccountUpdated({ personId, agencyCode: agency.code, keycloakUserId }),
      );
      return {
        officer: await this.lockedAccount(tx, personId),
        agencyName: agency.name,
        newlyInvited: false,
        sendEmail: officer.state === 'invited',
      };
    }
    // Provisioned again: enabled, with the role, and invited as if new.
    if (!existing.roles.includes(LAW_ENFORCEMENT)) {
      await this.identity.grantRole(keycloakUserId, LAW_ENFORCEMENT);
      changes.made(`granted ${LAW_ENFORCEMENT} to ${keycloakUserId}`, () =>
        this.identity.revokeRole(keycloakUserId, LAW_ENFORCEMENT),
      );
    }
    if (!existing.enabled) {
      await this.identity.setEnabled(keycloakUserId, true);
      changes.made(`enabled ${keycloakUserId}`, () =>
        this.identity.setEnabled(keycloakUserId, false),
      );
    }
    await tx
      .update(lawEnforcementOfficers)
      .set({ state: 'invited', invitedAt: now, activatedAt: null, revokedAt: null })
      .where(eq(lawEnforcementOfficers.personId, personId));
    await this.events.record(
      tx,
      leaAccountProvisioned({ personId, agencyCode: agency.code, keycloakUserId }),
    );
    return {
      officer: await this.lockedAccount(tx, personId),
      agencyName: agency.name,
      newlyInvited: true,
      sendEmail: true,
    };
  }

  private async revokeWithin(
    tx: Transaction,
    personId: string,
    changes: IdentityChanges,
  ): Promise<LeaOfficerAccount> {
    await tx.execute(sql.raw(`set local lock_timeout = '${LEA_OFFICER_LOCK_WAIT}'`));
    const officer = await this.lockedAccount(tx, personId);
    if (officer.state === 'revoked') return account(officer);
    const { keycloakUserId, agencyCode } = officer;
    try {
      await this.identity.setEnabled(keycloakUserId, false);
      changes.made(`disabled ${keycloakUserId}`, () =>
        this.identity.setEnabled(keycloakUserId, true),
      );
    } catch (error) {
      // Deleted in Keycloak by hand: it has no access left to take away.
      if (!(error instanceof IdentityUserNotFound)) throw error;
    }
    await tx
      .update(lawEnforcementOfficers)
      .set({ state: 'revoked', revokedAt: new Date() })
      .where(eq(lawEnforcementOfficers.personId, personId));
    await this.events.record(tx, leaAccountRevoked({ personId, agencyCode, keycloakUserId }));
    return account(await this.lockedAccount(tx, personId));
  }

  /**
   * The activation email of a provisioning that has committed. A failure cannot undo it, so it is
   * reported as such: provisioning the officer again sends the email without creating anyone.
   */
  private async sendAfterProvisioning(userId: string, agencyName: string): Promise<void> {
    try {
      await this.identity.sendActivationEmail(userId, leaActivationEmail(agencyName));
    } catch (error) {
      this.logger.warn({ err: error }, 'Provisioned an officer but could not send the email');
      throw new ProblemException({
        type: 'invitation-not-sent',
        title: 'Activation email not sent',
        status: HttpStatus.BAD_GATEWAY,
        detail:
          'The officer was provisioned, but the identity provider did not send the activation email. Provision the officer again to resend it.',
      });
    }
  }

  private inPlatformContext<T>(principal: Principal, work: (tx: Transaction) => Promise<T>) {
    return withTenant(this.db, { tenant: PLATFORM_TENANT, subject: principal.subject }, work);
  }

  private async findAgency(tx: Transaction, code: string): Promise<{ code: string; name: string }> {
    const [agency] = await tx
      .select({ code: agencies.code, name: agencies.name })
      .from(agencies)
      .where(eq(agencies.code, code));
    return notFoundIfInvisible(agency);
  }

  private accounts(tx: Transaction) {
    return tx
      .select(ACCOUNT_COLUMNS)
      .from(lawEnforcementOfficers)
      .innerJoin(persons, eq(persons.id, lawEnforcementOfficers.personId))
      .$dynamic();
  }

  /** The officer whose account is `keycloakUserId`, locked, or undefined when it is no officer's. */
  private async officerOfAccount(
    tx: Transaction,
    keycloakUserId: string,
  ): Promise<OfficerRow | undefined> {
    const [officer] = await this.accounts(tx)
      .where(and(eq(persons.keycloakUserId, keycloakUserId), eq(persons.kind, 'law-enforcement')))
      .for('update', { of: lawEnforcementOfficers });
    return officer;
  }

  /** The officer, locked for the rest of the transaction; 404 when no officer has this id. */
  private async lockedAccount(tx: Transaction, personId: string): Promise<OfficerRow> {
    const [officer] = await this.accounts(tx)
      .where(eq(lawEnforcementOfficers.personId, personId))
      .for('update', { of: lawEnforcementOfficers });
    return notFoundIfInvisible(officer);
  }
}

/** What `provision` committed, and what is left to do after the commit. */
interface Provisioned {
  officer: OfficerRow;
  agencyName: string;
  /** The account now has an invitation waiting that it did not have before. */
  newlyInvited: boolean;
  /** The officer is invited, so the activation email is due. */
  sendEmail: boolean;
}

function account(row: OfficerRow): LeaOfficerAccount {
  return {
    id: row.personId,
    agencyCode: row.agencyCode,
    name: row.name,
    email: row.email ?? '',
    phone: row.phone ?? '',
    state: row.state,
    invitedAt: row.invitedAt.toISOString(),
    activatedAt: row.activatedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

/**
 * Maps identity and lock failures to the problem the caller receives. `unavailable` says what
 * did not happen when the identity provider failed.
 */
function asProblem(error: unknown, unavailable: string): unknown {
  if (error instanceof EmailTaken) {
    // Created by someone else between the lookup and the create.
    return emailTaken();
  }
  if (error instanceof IdentityUnavailable) {
    return new ProblemException({
      type: 'identity-unavailable',
      title: 'Identity provider unavailable',
      status: HttpStatus.BAD_GATEWAY,
      detail: unavailable,
    });
  }
  if (error instanceof IdentityUserNotFound) {
    return new ProblemException({
      type: 'lea-officer-account-missing',
      title: 'Officer account missing',
      status: HttpStatus.CONFLICT,
      detail:
        "The officer's account no longer exists in the identity provider. An operator has to restore or remove it.",
    });
  }
  if (failedToLock(error)) {
    return new ProblemException({
      type: 'lea-officer-busy',
      title: 'Officer being changed',
      status: HttpStatus.CONFLICT,
      detail: 'Another change to this officer is still in progress. Try again shortly.',
    });
  }
  return error;
}

function emailTaken() {
  return new ProblemException({
    type: 'email-belongs-to-other-tenant',
    title: 'Email belongs to another account',
    status: HttpStatus.CONFLICT,
    detail: 'This email already belongs to another account.',
    errors: [{ path: 'email', message: 'This email already belongs to another account' }],
  });
}

function officerOfOtherAgency() {
  return new ProblemException({
    type: 'lea-officer-of-other-agency',
    title: 'Officer of another agency',
    status: HttpStatus.CONFLICT,
    detail: 'This email belongs to an officer of another agency.',
    errors: [{ path: 'email', message: 'This email belongs to an officer of another agency' }],
  });
}
