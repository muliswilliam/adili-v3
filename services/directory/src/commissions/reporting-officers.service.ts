import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, eq, ne } from 'drizzle-orm';

import { config } from '../config.js';
import { violatedUniqueConstraint } from '../db/errors.js';
import type { DirectorySchema } from '../db/schema.js';
import {
  type ActivationEmailOptions,
  EmailTaken,
  IdentityProvisioning,
  IdentityUnavailable,
  IdentityUserNotFound,
  STAFF_REQUIRED_ACTIONS,
} from '../identity/identity-provisioning.js';
import { PLATFORM_TENANT } from './access.js';
import { ActivationLookups } from './activation-lookups.js';
import { IdentityChanges } from './identity-changes.js';
import type { AssignReportingOfficerBody } from './assign-reporting-officer.js';
import { CommissionsService, type Transaction } from './commissions.service.js';
import { reportingOfficerAssigned } from './events.js';
import type { Commission } from './representation.js';
import { commissions, reportingOfficerAssignments } from './schema.js';

/** Realm role that gives an account the roster tools of its tenant. */
export const REPORTING_OFFICER_ROLE = 'reporting-officer';

/** How long an activation link stays valid (spec 01: 72 hours). */
export const ACTIVATION_LIFESPAN_SECONDS = 72 * 60 * 60;

/**
 * The activation email every reporting officer receives (on assignment, and on resend): verify
 * the email, set a password, enrol OTP, then land on the console.
 */
export function activationEmail(consoleUrl: string = config.CONSOLE_URL): ActivationEmailOptions {
  return {
    actions: STAFF_REQUIRED_ACTIONS,
    lifespanSeconds: ACTIVATION_LIFESPAN_SECONDS,
    redirectUri: new URL('/', consoleUrl).toString(),
    clientId: 'console',
  };
}

/**
 * The reporting officer of a Commission (spec 01): who is accountable for its roster, and the
 * staff account they sign in with. Assignments are tenant data under RLS, so every write runs in
 * the platform context.
 *
 * Identity calls run inside the same unit of work but cannot roll back with it, so an assignment
 * records each identity change it makes and undoes them when a later step (or the commit) fails:
 * Keycloak then looks as it did before, like the database, and the request can be retried with
 * the same Idempotency-Key.
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
   * Order: the new account first (an email of another tenant is refused before anything
   * changes), then the records and the activation email, and the previous officer's access
   * last, so that the current officer keeps access whenever the new one could not be invited.
   */
  async assign(
    principal: Principal,
    slug: string,
    body: AssignReportingOfficerBody,
  ): Promise<Commission> {
    const changes = new IdentityChanges(this.logger);
    let assigned: { keycloakUserId: string; commission: Commission };
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
    // A reused account may be remembered as having no invitation; look it up again next time.
    // Never throws: nothing after the commit may fail, or a retry would assign again.
    await this.activationLookups.forget(assigned.keycloakUserId);
    return assigned.commission;
  }

  /** The unit of work of `assign`: the invited account id and the Commission to answer with. */
  private async assignWithin(
    tx: Transaction,
    principal: Principal,
    slug: string,
    body: AssignReportingOfficerBody,
    changes: IdentityChanges,
  ): Promise<{ keycloakUserId: string; commission: Commission }> {
    const commissionId = await this.lockCommission(tx, slug);
    const previous = await this.currentAssignment(tx, commissionId);
    const keycloakUserId = await this.provisionAccount(slug, body, changes);
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
    await this.identity.sendActivationEmail(keycloakUserId, activationEmail());
    // Re-assigning the same person (to correct their details) keeps their account.
    if (previous && previous.keycloakUserId !== keycloakUserId) {
      await this.retire(previous.keycloakUserId, changes);
    }
    return { keycloakUserId, commission: await this.commissions.read(tx, slug) };
  }

  /**
   * Has Keycloak send the current officer's activation email again (a new 72-hour link) while
   * they are `invited`. Not a state change, so no event is recorded.
   */
  async resendInvitation(principal: Principal, slug: string): Promise<void> {
    try {
      await this.inPlatformContext(principal, async (tx) => {
        const commissionId = await this.lockCommission(tx, slug);
        const current = await this.currentAssignment(tx, commissionId);
        if (!current) throw noReportingOfficer();
        if (current.state !== 'invited') throw officerAlreadyActivated();
        await this.identity.sendActivationEmail(current.keycloakUserId, activationEmail());
      });
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
   * The Commission's id, locked for the rest of the transaction so that assignments,
   * replacements and resends of one Commission run one at a time. 404 when it does not exist.
   */
  private async lockCommission(tx: Transaction, slug: string): Promise<string> {
    const [commission] = await tx
      .select({ id: commissions.id })
      .from(commissions)
      .where(eq(commissions.slug, slug))
      .for('update');
    return notFoundIfInvisible(commission).id;
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
   * again, in case it was replaced earlier), otherwise a new staff account is created. An account
   * of another tenant (or of none) is refused: a user belongs to one tenant until Keycloak
   * Organizations are adopted. Every change is recorded in `changes` with its undo.
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
