import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, eq, ne, sql } from 'drizzle-orm';

import { config } from '../config.js';
import { failedToLock, violatedUniqueConstraint } from '../db/errors.js';
import type { DirectorySchema } from '../db/schema.js';
import {
  type ActivationEmailOptions,
  EmailTaken,
  IdentityProvisioning,
  IdentityUnavailable,
  IdentityUserNotFound,
  STAFF_REQUIRED_ACTIONS,
} from '../identity/identity-provisioning.js';
import { PLATFORM_TENANT, REPORTING_OFFICER_ROLE } from './access.js';
import { ActivationLookups } from './activation-lookups.js';
import { IdentityChanges } from './identity-changes.js';
import type { AssignReportingOfficerBody } from './assign-reporting-officer.js';
import { CommissionsService, type Transaction } from './commissions.service.js';
import { reportingOfficerAssigned } from './events.js';
import type { Commission } from './representation.js';
import { commissions, reportingOfficerAssignments } from './schema.js';

/** How long an activation link stays valid (spec 01: 72 hours). */
export const ACTIVATION_LIFESPAN_SECONDS = 72 * 60 * 60;

/**
 * How long a change to a Commission's reporting officer waits for another one to finish before
 * it is refused (409). The one holding the lock may be waiting on Keycloak; queueing behind it
 * would tie up a database connection per waiting request.
 */
export const OFFICER_LOCK_WAIT = '3s';

/**
 * The activation email every reporting officer receives (on assignment, and on resend): it names
 * the Commission and the role, then the link verifies the email, enrols OTP and sets a password.
 * Keycloak ends that flow without a session, so its "account ready" page leads to the console's
 * `/auth/login`, which starts sign-in at once instead of showing the signed-out landing page.
 */
export function activationEmail(
  commissionName: string,
  consoleUrl: string = config.CONSOLE_URL,
): ActivationEmailOptions {
  return {
    actions: STAFF_REQUIRED_ACTIONS,
    lifespanSeconds: ACTIVATION_LIFESPAN_SECONDS,
    redirectUri: new URL('/auth/login', consoleUrl).toString(),
    clientId: 'console',
    commissionName,
    role: REPORTING_OFFICER_ROLE,
  };
}

/**
 * The reporting officer of a Commission (spec 01): who is accountable for its roster, and the
 * staff account they sign in with. Assignments are tenant data under RLS, so every write runs in
 * the platform context.
 *
 * Identity calls cannot roll back with the database, so an assignment records each identity
 * change it makes and undoes them when a later step (or the commit) fails: Keycloak then looks
 * as it did before, like the database, and the request can be retried with the same
 * Idempotency-Key. The activation email cannot be undone, so it is sent only once the
 * assignment has committed.
 */
@Injectable()
export class ReportingOfficersService {
  private readonly logger = new Logger(ReportingOfficersService.name);

  constructor(
    @InjectDatabase() private readonly db: Database<DirectorySchema>,
    private readonly events: EventPublisher,
    private readonly identity: IdentityProvisioning,
    private readonly commissions: CommissionsService,
    private readonly activationLookups: ActivationLookups,
  ) {}

  /**
   * Assigns the Commission's reporting officer: creates (or reuses, same tenant) their account
   * with the reporting-officer role and the staff required actions, records the assignment as
   * `invited` with `commission.reporting-officer.assigned.v1`, and has Keycloak send exactly one
   * activation email. A current officer is replaced: their account loses the role (and is
   * disabled when that was its only role), and their assignment becomes `replaced` with
   * `replacedBy` naming the new one.
   *
   * Assigning the current officer again (to correct their name or phone, or to retry an email
   * that was not sent) updates their assignment and account in place: an activated officer stays
   * activated and gets no email, an invited one gets their activation email again.
   *
   * Order: the new account first (an email of another tenant is refused before anything
   * changes), then the records and the previous officer's access, so that the current officer
   * keeps access whenever the new one could not be assigned; the email last, after the commit.
   */
  async assign(
    principal: Principal,
    slug: string,
    body: AssignReportingOfficerBody,
  ): Promise<Commission> {
    const changes = new IdentityChanges(this.logger);
    let assigned: Assigned;
    try {
      assigned = await this.inPlatformContext(principal, (tx) =>
        this.assignWithin(tx, principal, slug, body, changes).catch(async (error: unknown) => {
          // Undone while the Commission is still locked, so that a concurrent assignment
          // cannot build on an account that is being put back.
          await changes.undo();
          throw error;
        }),
      );
    } catch (error) {
      // Changes are still recorded here only when the commit itself failed.
      await changes.undo();
      throw asProblem(
        error,
        'The identity provider did not respond, so the officer was not assigned. Try again.',
      );
    }
    if (assigned.newlyInvited) {
      // A reused account may be remembered as having no invitation; look it up again next time.
      await this.activationLookups.forget(assigned.keycloakUserId);
    }
    if (assigned.sendEmail) {
      await this.sendAfterAssigning(assigned.keycloakUserId, assigned.commissionName);
    }
    return assigned.commission;
  }

  /** The unit of work of `assign`: what was assigned, and whether an email is due. */
  private async assignWithin(
    tx: Transaction,
    principal: Principal,
    slug: string,
    body: AssignReportingOfficerBody,
    changes: IdentityChanges,
  ): Promise<Assigned> {
    const { id: commissionId, name: commissionName } = await this.lockCommission(tx, slug);
    const previous = await this.currentAssignment(tx, commissionId);
    const keycloakUserId = await this.provisionAccount(slug, body, changes);
    if (previous?.keycloakUserId === keycloakUserId) {
      // The current officer again: the same assignment, with the details as now entered.
      await tx
        .update(reportingOfficerAssignments)
        .set({ name: body.name, email: body.email, phone: body.phone })
        .where(eq(reportingOfficerAssignments.id, previous.id));
      return {
        keycloakUserId,
        commissionName,
        newlyInvited: false,
        sendEmail: previous.state === 'invited',
        commission: await this.commissions.read(tx, slug),
      };
    }
    const now = new Date();
    if (previous) {
      // Replaced before the insert: the current key admits one non-replaced assignment.
      await tx
        .update(reportingOfficerAssignments)
        .set({ state: 'replaced', replacedAt: now })
        .where(eq(reportingOfficerAssignments.id, previous.id));
    }
    const [assignment] = await tx
      .insert(reportingOfficerAssignments)
      .values({
        commissionId,
        tenant: slug,
        name: body.name,
        email: body.email,
        phone: body.phone,
        keycloakUserId,
        state: 'invited',
        invitedAt: now,
        createdBy: principal.subject,
      })
      .returning({ id: reportingOfficerAssignments.id });
    if (!assignment) throw new Error('Assignment insert returned no row');
    if (previous) {
      await tx
        .update(reportingOfficerAssignments)
        .set({ replacedBy: assignment.id })
        .where(eq(reportingOfficerAssignments.id, previous.id));
    }
    await this.events.record(
      tx,
      reportingOfficerAssigned(slug, {
        commissionId,
        assignmentId: assignment.id,
        keycloakUserId,
        replacedAssignmentId: previous?.id ?? null,
      }),
    );
    if (previous) await this.retire(previous.keycloakUserId, changes);
    return {
      keycloakUserId,
      commissionName,
      newlyInvited: true,
      sendEmail: true,
      commission: await this.commissions.read(tx, slug),
    };
  }

  /**
   * The activation email of an assignment that has committed. A failure cannot undo the
   * assignment, so it is reported as such: a retry with the same Idempotency-Key (or a resend)
   * sends the email without assigning anyone again.
   */
  private async sendAfterAssigning(userId: string, commissionName: string): Promise<void> {
    try {
      await this.identity.sendActivationEmail(userId, activationEmail(commissionName));
    } catch (error) {
      this.logger.warn({ err: error }, 'Assigned a reporting officer but could not send the email');
      throw new ProblemException({
        type: 'invitation-not-sent',
        title: 'Activation email not sent',
        status: HttpStatus.BAD_GATEWAY,
        detail:
          'The officer was assigned, but the identity provider did not send the activation email. Resend the invitation.',
      });
    }
  }

  /**
   * Has Keycloak send the current officer's activation email again (a new 72-hour link) while
   * they are `invited`. Not a state change, so no event is recorded.
   */
  async resendInvitation(principal: Principal, slug: string): Promise<void> {
    try {
      // Read, then sent outside the transaction: the email holds no row lock or connection.
      const { userId, commissionName } = await this.inPlatformContext(principal, async (tx) => {
        const commission = await this.findCommission(tx, slug);
        const current = await this.currentAssignment(tx, commission.id);
        if (!current) throw noReportingOfficer();
        if (current.state !== 'invited') throw officerAlreadyActivated();
        return { userId: current.keycloakUserId, commissionName: commission.name };
      });
      await this.identity.sendActivationEmail(userId, activationEmail(commissionName));
    } catch (error) {
      throw asProblem(
        error,
        'The identity provider did not respond, so the invitation was not sent. Try again.',
      );
    }
  }

  private inPlatformContext<T>(principal: Principal, work: (tx: Transaction) => Promise<T>) {
    return withTenant(this.db, { tenant: PLATFORM_TENANT, subject: principal.subject }, work);
  }

  /**
   * The Commission's id and display name, locked for the rest of the transaction so that
   * assignments and replacements of one Commission run one at a time. 404 when it does not
   * exist; a lock not granted within {@link OFFICER_LOCK_WAIT} fails the transaction.
   */
  private async lockCommission(
    tx: Transaction,
    slug: string,
  ): Promise<{ id: string; name: string }> {
    await tx.execute(sql.raw(`set local lock_timeout = '${OFFICER_LOCK_WAIT}'`));
    return this.findCommission(tx, slug, { lock: true });
  }

  private async findCommission(
    tx: Transaction,
    slug: string,
    { lock = false } = {},
  ): Promise<{ id: string; name: string }> {
    const query = tx
      .select({ id: commissions.id, name: commissions.name })
      .from(commissions)
      .where(eq(commissions.slug, slug));
    const [commission] = await (lock ? query.for('update') : query);
    return notFoundIfInvisible(commission);
  }

  /** The Commission's assignment that is not `replaced`, if any (at most one, by constraint). */
  private async currentAssignment(tx: Transaction, commissionId: string) {
    const [current] = await tx
      .select({
        id: reportingOfficerAssignments.id,
        state: reportingOfficerAssignments.state,
        keycloakUserId: reportingOfficerAssignments.keycloakUserId,
      })
      .from(reportingOfficerAssignments)
      .where(
        and(
          eq(reportingOfficerAssignments.commissionId, commissionId),
          ne(reportingOfficerAssignments.state, 'replaced'),
        ),
      )
      .limit(1);
    return current;
  }

  /**
   * The officer's account id: an existing account of this tenant gets the role (and is enabled
   * again, in case it was replaced earlier) and the name and phone as entered, otherwise a new
   * staff account is created. An account of another tenant (or of none) is refused: a user
   * belongs to one tenant until Keycloak Organizations are adopted. Every change is recorded in
   * `changes` with its undo.
   */
  private async provisionAccount(
    slug: string,
    body: AssignReportingOfficerBody,
    changes: IdentityChanges,
  ): Promise<string> {
    const existing = await this.identity.findByEmail(body.email);
    if (existing) {
      if (existing.tenant !== slug) throw emailInOtherTenant();
      const { userId } = existing;
      if (!existing.roles.includes(REPORTING_OFFICER_ROLE)) {
        await this.identity.grantRole(userId, REPORTING_OFFICER_ROLE);
        changes.made(`granted ${REPORTING_OFFICER_ROLE} to ${userId}`, () =>
          this.identity.revokeRole(userId, REPORTING_OFFICER_ROLE),
        );
      }
      if (!existing.enabled) {
        await this.identity.setEnabled(userId, true);
        changes.made(`enabled ${userId}`, () => this.identity.setEnabled(userId, false));
      }
      const restore = await this.identity.updateProfile(userId, {
        name: body.name,
        phone: body.phone,
      });
      if (restore) changes.made(`updated the name and phone of ${userId}`, restore);
      return userId;
    }
    const userId = await this.identity.createStaffUser({
      email: body.email,
      name: body.name,
      phone: body.phone,
      tenant: slug,
      role: REPORTING_OFFICER_ROLE,
      requiredActions: STAFF_REQUIRED_ACTIONS,
    });
    changes.made(`created ${userId}`, () => this.identity.deleteUser(userId));
    return userId;
  }

  /**
   * Takes the reporting-officer role from a replaced officer's account, and disables the account
   * when that was its only role. An account with other roles (a reviewer of the Commission who
   * was also its reporting officer, say) keeps them and stays enabled. An account already
   * deleted in Keycloak has no access left to remove.
   */
  private async retire(userId: string, changes: IdentityChanges): Promise<void> {
    const account = await this.identity.findById(userId);
    if (!account) return;
    if (account.roles.includes(REPORTING_OFFICER_ROLE)) {
      await this.identity.revokeRole(userId, REPORTING_OFFICER_ROLE);
      changes.made(`revoked ${REPORTING_OFFICER_ROLE} from ${userId}`, () =>
        this.identity.grantRole(userId, REPORTING_OFFICER_ROLE),
      );
    }
    const otherRoles = account.roles.filter((role) => role !== REPORTING_OFFICER_ROLE);
    if (account.enabled && otherRoles.length === 0) {
      await this.identity.setEnabled(userId, false);
      changes.made(`disabled ${userId}`, () => this.identity.setEnabled(userId, true));
    }
  }
}

/**
 * Maps identity and constraint failures to the problem the caller receives. `unavailable` says
 * what did not happen when the identity provider failed.
 */
/** What `assign` committed, and what is left to do after the commit. */
interface Assigned {
  keycloakUserId: string;
  commissionName: string;
  /** A new assignment: the account now has an invitation waiting. */
  newlyInvited: boolean;
  /** The officer is invited, so the activation email is due. */
  sendEmail: boolean;
  commission: Commission;
}

function asProblem(error: unknown, unavailable: string): unknown {
  if (error instanceof EmailTaken) {
    // Created by someone else between the lookup and the create, or a username clash.
    return emailInOtherTenant();
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
      type: 'reporting-officer-account-missing',
      title: 'Reporting officer account missing',
      status: HttpStatus.CONFLICT,
      detail:
        "The reporting officer's account no longer exists in the identity provider. Replace the officer instead.",
    });
  }
  if (failedToLock(error)) {
    return new ProblemException({
      type: 'reporting-officer-busy',
      title: 'Reporting officer being changed',
      status: HttpStatus.CONFLICT,
      detail:
        "Another change to this Commission's reporting officer is still in progress. Try again shortly.",
    });
  }
  if (violatedUniqueConstraint(error) === 'reporting_officer_assignments_current_key') {
    // Unreachable while writes lock the Commission; kept so that a race is a 409, not a 500.
    return new ProblemException({
      type: 'reporting-officer-changed',
      title: 'Reporting officer changed',
      status: HttpStatus.CONFLICT,
      detail: 'The reporting officer changed while this request ran. Check it and try again.',
    });
  }
  return error;
}

function emailInOtherTenant() {
  return new ProblemException({
    type: 'email-belongs-to-other-tenant',
    title: 'Email belongs to another tenant',
    status: HttpStatus.CONFLICT,
    detail: 'This email already belongs to an account in another Commission.',
    errors: [
      { path: 'email', message: 'This email already belongs to an account in another Commission' },
    ],
  });
}

function noReportingOfficer() {
  return new ProblemException({
    type: 'reporting-officer-not-assigned',
    title: 'No reporting officer',
    status: HttpStatus.NOT_FOUND,
    detail: 'This Commission has no reporting officer to invite.',
  });
}

function officerAlreadyActivated() {
  return new ProblemException({
    type: 'reporting-officer-activated',
    title: 'Reporting officer already activated',
    status: HttpStatus.CONFLICT,
    detail: 'This officer has already activated their account, so there is nothing to resend.',
  });
}
