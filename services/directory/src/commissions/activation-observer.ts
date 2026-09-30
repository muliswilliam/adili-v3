import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, eq, sql } from 'drizzle-orm';
import { from, type Observable, switchMap } from 'rxjs';
import { REPORTING_OFFICER } from '@adili/roles';

import type { DirectorySchema } from '../db/schema.js';
import { PLATFORM_TENANT } from './access.js';
import { ActivationLookups } from './activation-lookups.js';
import { reportingOfficerActivated } from './events.js';
import { reportingOfficerAssignments } from './schema.js';

/**
 * Observes reporting-officer activation (spec 01, S13) without any Keycloak extension: the first
 * authenticated request whose subject is the account of an `invited` assignment (in practice the
 * console's `/v1/me` right after sign-in) moves it to `activated` and records
 * `commission.reporting-officer.activated.v1`, exactly once.
 *
 * Runs before every authenticated handler, so the officer's own first request already sees the
 * new state. Only tokens carrying the reporting-officer role are looked at (an invited account
 * holds it from the moment it is assigned), so everyone else pays nothing. Officers found
 * without an invitation are remembered for a few minutes ({@link ActivationLookups}), which
 * keeps the database out of their later requests. Observing never fails the request: on error
 * the next request simply tries again.
 */
@Injectable()
export class ActivationObserver implements NestInterceptor {
  private readonly logger = new Logger(ActivationObserver.name);

  constructor(
    @InjectDatabase() private readonly db: Database<DirectorySchema>,
    private readonly events: EventPublisher,
    private readonly lookups: ActivationLookups,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const principal =
      context.getType() === 'http'
        ? context.switchToHttp().getRequest<AuthenticatedRequest>().principal
        : undefined;
    if (!principal?.roles.includes(REPORTING_OFFICER)) return next.handle();
    return from(this.observe(principal.subject)).pipe(switchMap(() => next.handle()));
  }

  private async observe(subject: string): Promise<void> {
    const lookup = await this.lookups.lookup(subject);
    if (lookup.notInvited) return;
    try {
      await this.activate(subject);
      // Activated now or never invited: either way nothing is waiting for this subject, unless
      // an assignment committed meanwhile, which the version check leaves to the next request.
      await this.lookups.rememberNotInvited(subject, lookup.version);
    } catch (error) {
      this.logger.warn({ err: error }, 'Observing reporting-officer activation failed');
    }
  }

  /**
   * Flips the subject's `invited` assignments in one statement. The row lock makes a concurrent
   * request wait and then match nothing, so the event is recorded once.
   */
  private async activate(subject: string): Promise<void> {
    await withTenant(this.db, { tenant: PLATFORM_TENANT, subject }, async (tx) => {
      const activated = await tx
        .update(reportingOfficerAssignments)
        .set({ state: 'activated', activatedAt: sql`now()` })
        .where(
          and(
            eq(reportingOfficerAssignments.keycloakUserId, subject),
            eq(reportingOfficerAssignments.state, 'invited'),
          ),
        )
        .returning({
          assignmentId: reportingOfficerAssignments.id,
          commissionId: reportingOfficerAssignments.commissionId,
          tenant: reportingOfficerAssignments.tenant,
        });
      for (const { tenant, ...data } of activated) {
        await this.events.record(tx, reportingOfficerActivated(tenant, data));
      }
    });
  }
}
