import { HttpStatus, Injectable } from '@nestjs/common';
import { type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, desc, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { caseTenant, isSupervisor } from '../cases/access.js';
import { findCase } from '../cases/case-lookup.js';
import { reviewTimeline } from '../cases/schema.js';
import { Clock } from '../clock.js';
import type { ReviewSchema } from '../db/schema.js';
import { RECHECK_COOLDOWN_MINUTES } from './contract.js';
import { type CaseRecheckedData, REVIEW_CASE_RECHECKED } from './events.js';
import { RegistryWorkflows } from './registry-workflows.js';

const COOLDOWN_MS = RECHECK_COOLDOWN_MINUTES * 60_000;

/**
 * A re-check of a case's registries (spec 07b S11), asked for by the case's assignee or a
 * supervisor: the registry check runs again for the case's current version, on its own workflow,
 * and its flags are reconciled with the case's (a flag no longer raised is closed
 * `superseded-by-recheck`, a reviewed one keeps its note). At most one every ten minutes per case
 * (429 `recheck-cooldown`), so a registry that is down is not asked again and again; the hourly
 * sweep re-checks such cases by itself.
 */
@Injectable()
export class RecheckService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly events: EventPublisher,
    private readonly workflows: RegistryWorkflows,
    private readonly clock: Clock,
  ) {}

  async recheck(principal: Principal, caseId: string): Promise<void> {
    const tenant = caseTenant(principal);
    const now = this.clock.now();
    await withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const row = await findCase(tx, tenant, caseId, { lock: true });
      if (row.assignee !== principal.subject && !isSupervisor(principal)) {
        throw new ProblemException({
          type: 'not-the-assignee',
          title: 'Forbidden',
          status: HttpStatus.FORBIDDEN,
          detail: "Only the case's assignee or a supervisor can re-check its registries.",
        });
      }
      if (row.status === 'determined') {
        throw new ProblemException({
          type: 'case-closed',
          title: 'Conflict',
          status: HttpStatus.CONFLICT,
          detail: 'The case is determined; its registries are no longer checked.',
        });
      }
      const [last] = await tx
        .select({ at: reviewTimeline.at })
        .from(reviewTimeline)
        .where(
          and(eq(reviewTimeline.caseId, row.id), eq(reviewTimeline.kind, 'registry-rechecked')),
        )
        .orderBy(desc(reviewTimeline.at))
        .limit(1);
      const wait = last ? last.at.getTime() + COOLDOWN_MS - now.getTime() : 0;
      if (wait > 0) {
        throw new ProblemException(
          {
            type: 'recheck-cooldown',
            title: 'Re-checked recently',
            status: HttpStatus.TOO_MANY_REQUESTS,
            detail: `The registries of this case were re-checked less than ${String(RECHECK_COOLDOWN_MINUTES)} minutes ago.`,
          },
          { retryAfterSeconds: Math.ceil(wait / 1000) },
        );
      }

      const recheckId = uuidv7();
      await tx.insert(reviewTimeline).values({
        id: uuidv7(),
        tenant,
        caseId: row.id,
        kind: 'registry-rechecked',
        ref: recheckId,
        actor: principal.subject,
        summary: 'Registry re-check requested',
        at: now,
      });
      await this.events.record<CaseRecheckedData>(tx, {
        type: REVIEW_CASE_RECHECKED,
        subject: row.id,
        tenant,
        data: { caseId: row.id, versionId: row.currentVersionId, by: principal.subject },
      });
      // Started inside the transaction: if Temporal refuses, nothing is recorded and the caller
      // can try again. A commit failing after the start leaves a check that changes nothing twice.
      await this.workflows.startRecheck(
        {
          tenant,
          caseId: row.id,
          declarationId: row.declarationId,
          versionId: row.currentVersionId,
          version: row.currentVersion,
        },
        recheckId,
      );
    });
  }
}
