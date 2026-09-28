import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher, inbox } from '@adili/events';
import { and, asc, eq, sql } from 'drizzle-orm';

import { Clock } from '../clock.js';
import type { DeclarationsSchema } from '../db/schema.js';
import {
  DirectoryClient,
  type PulledCommission,
  type PulledPolicy,
  type PulledRosterRecordPage,
  type RosterRecordSelector,
} from '../directory/directory-client.js';
import { applyRosterPage, type PageContext, type Transaction } from './apply-page.js';
import { nairobiDate } from './dates.js';
import type { CycleCalendar, ObligationPolicy } from './engine.js';
import { commissionRefs, cycleCalendar, tenantPolicyCache } from './schema.js';
import { systemContext } from './system-context.js';
import { CycleOpeningSchedules } from './workflow/cycle-opening-schedules.js';
import { ObligationWorkflows, tellWorkflows } from './workflows.js';

/** The records a roster event refers to: those of an import or exit batch, or one record. */
export type RosterSource =
  { kind: 'records'; selector: RosterRecordSelector } | { kind: 'record'; recordId: string };

/** The parts of a consumed event ingest reads. */
export interface IngestedEvent {
  id: string;
  /** The Commission's slug. */
  tenant: string;
  /** When the event occurred (CloudEvents `time`). */
  time: Date;
}

/**
 * Brings the obligations of the roster records a directory event refers to up to date (ADR-013
 * local read model): pulls the Commission's name and policy in force, then the records page by page
 * (1,000 each), and applies each page in its own transaction (`applyRosterPage`). The consumer's
 * inbox entry is written with the last page, so the event counts as handled only once every page
 * is in; a failed pull (directory down) throws and leaves it for the retry, which re-applies the
 * pages already in as no-ops. Workflows are told after each page commits, and the Commission's
 * cycle-opening schedule is ensured once the last one is in.
 */
@Injectable()
export class RosterIngest {
  private readonly logger = new Logger(RosterIngest.name);

  constructor(
    @InjectDatabase() private readonly db: Database<DeclarationsSchema>,
    @Inject(EventPublisher) private readonly events: EventPublisher,
    private readonly directory: DirectoryClient,
    private readonly workflows: ObligationWorkflows,
    private readonly clock: Clock,
    private readonly schedules: CycleOpeningSchedules,
  ) {}

  /** Returns false when the consumer had already handled the event. */
  async ingest(consumer: string, event: IngestedEvent, source: RosterSource): Promise<boolean> {
    if (await this.handled(consumer, event.id)) return false;
    const { tenant } = event;
    const [commission, policy, calendar] = await Promise.all([
      this.directory.getCommission(tenant),
      this.directory.getPolicy(tenant),
      this.calendar(),
    ]);
    const context: PageContext = {
      tenant,
      policy: { id: policy.id, rules: obligationPolicyOf(policy) },
      calendar,
      today: nairobiDate(this.clock.now()),
      syncedFrom: source.kind === 'records' ? selectedId(source.selector) : null,
    };

    let cursor: string | null = null;
    let first = true;
    for (;;) {
      const page = await this.pull(tenant, source, cursor);
      const last = page.nextCursor === null;
      const changes = await withTenant(this.db, systemContext(tenant), async (tx) => {
        if (first) await refreshReferenceData(tx, commission, policy);
        const applied = await applyRosterPage(tx, this.events, context, page.items);
        if (last) {
          if (source.kind === 'records' && 'importId' in source.selector)
            await recordRosterImport(tx, tenant, event.time);
          await tx.insert(inbox).values({ consumer, eventId: event.id }).onConflictDoNothing();
        }
        return applied;
      });
      await tellWorkflows(this.workflows, this.logger, tenant, changes);
      if (last) {
        await this.ensureCycleOpening(tenant);
        return true;
      }
      cursor = page.nextCursor;
      first = false;
    }
  }

  /**
   * Pulls the Commission's policy in force into the cache after `directory.policy.changed.v1`,
   * with the consumer's inbox entry in the same transaction. Returns false when the consumer had
   * already handled the event; a failed pull throws and leaves the event for the retry.
   */
  async refreshPolicy(consumer: string, event: IngestedEvent): Promise<boolean> {
    if (await this.handled(consumer, event.id)) return false;
    const policy = await this.directory.getPolicy(event.tenant);
    await withTenant(this.db, systemContext(event.tenant), async (tx) => {
      await cachePolicy(tx, event.tenant, policy);
      await tx.insert(inbox).values({ consumer, eventId: event.id }).onConflictDoNothing();
    });
    return true;
  }

  private async handled(consumer: string, eventId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ eventId: inbox.eventId })
      .from(inbox)
      .where(and(eq(inbox.consumer, consumer), eq(inbox.eventId, eventId)))
      .limit(1);
    return row !== undefined;
  }

  private async calendar(): Promise<CycleCalendar> {
    return this.db.select().from(cycleCalendar).orderBy(asc(cycleCalendar.cycleYear));
  }

  private async pull(
    tenant: string,
    source: RosterSource,
    cursor: string | null,
  ): Promise<PulledRosterRecordPage> {
    if (source.kind === 'records') {
      return this.directory.listRosterRecords(tenant, source.selector, cursor);
    }
    const record = await this.directory.getRosterRecord(tenant, source.recordId);
    if (record === null) {
      this.logger.warn({ tenant, rosterRecordId: source.recordId }, 'Roster record not found');
    }
    return { items: record === null ? [] : [record], nextCursor: null };
  }

  /**
   * Makes sure the Commission's cycle-opening schedule exists once it has a roster. A failure is
   * logged: the next ingest, or the service's next start, tries again.
   */
  private async ensureCycleOpening(tenant: string): Promise<void> {
    try {
      await this.schedules.ensure(tenant);
    } catch (error) {
      this.logger.warn({ err: error, tenant }, 'Cycle-opening schedule not ensured');
    }
  }
}

function selectedId(selector: RosterRecordSelector): string {
  return 'importId' in selector ? selector.importId : selector.exitBatchId;
}

export function obligationPolicyOf(policy: PulledPolicy): ObligationPolicy {
  return {
    version: policy.version,
    obligationsStartDate: policy.obligationsStartDate,
    initialDueAfterAppointmentDays: policy.initialDueAfterAppointmentDays,
    biennial: policy.biennial,
    finalDueAfterExitDays: policy.finalDueAfterExitDays,
    reminderOffsetsDays: policy.reminderOffsetsDays,
  };
}

/** Keeps the Commission's name and its policy in force as last pulled. */
async function refreshReferenceData(
  tx: Transaction,
  commission: PulledCommission,
  policy: PulledPolicy,
): Promise<void> {
  const fetchedAt = new Date();
  await tx
    .insert(commissionRefs)
    .values({ ...commission, fetchedAt })
    .onConflictDoUpdate({
      target: commissionRefs.slug,
      set: { issuerCode: commission.issuerCode, name: commission.name, fetchedAt },
    });
  await cachePolicy(tx, commission.slug, policy);
}

/**
 * Caches the tenant's policy in force as pulled. A pull that raced a policy change never puts an
 * older version back.
 */
export async function cachePolicy(
  tx: Transaction,
  tenant: string,
  policy: PulledPolicy,
): Promise<ObligationPolicy | null> {
  const rules = obligationPolicyOf(policy);
  const cached = {
    policyVersionId: policy.id,
    version: policy.version,
    policy: rules,
    fetchedAt: new Date(),
  };
  const [kept] = await tx
    .insert(tenantPolicyCache)
    .values({ tenant, ...cached })
    .onConflictDoUpdate({
      target: tenantPolicyCache.tenant,
      set: cached,
      setWhere: sql`${tenantPolicyCache.version} <= excluded.version`,
    })
    .returning({ policy: tenantPolicyCache.policy });
  return kept?.policy ?? null;
}

/** Keeps when the Commission's latest roster import completed; an older one handled late is ignored. */
async function recordRosterImport(tx: Transaction, tenant: string, time: Date): Promise<void> {
  await tx
    .update(commissionRefs)
    .set({
      lastRosterImportAt: sql`greatest(${commissionRefs.lastRosterImportAt}, ${time.toISOString()}::timestamptz)`,
    })
    .where(eq(commissionRefs.slug, tenant));
}
