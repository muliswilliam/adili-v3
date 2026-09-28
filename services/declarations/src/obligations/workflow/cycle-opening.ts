import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, asc, eq, gt, ne } from 'drizzle-orm';

import { Clock } from '../../clock.js';
import type { DeclarationsSchema } from '../../db/schema.js';
import { DirectoryClient } from '../../directory/directory-client.js';
import { reconcileSnapshots, storedReconcileContext, type Transaction } from '../apply-page.js';
import { biennialCycleKey } from '../cycle-key.js';
import { nairobiDate } from '../dates.js';
import { type CycleCalendar, type ObligationPolicy, openedCycles } from '../engine.js';
import { cycleOpened } from '../events.js';
import { cachePolicy } from '../roster-ingest.js';
import { systemContext } from '../system-context.js';
import { cycleCalendar, cycleOpenings, rosterSnapshots, tenantPolicyCache } from '../schema.js';
import { noChanges, ObligationWorkflows, tellWorkflows } from '../workflows.js';
import type { CycleOpened, CycleOpeningPage, CycleOpeningPageRequest } from './contract.js';

/** Roster snapshots per page, as the directory pulls. */
const PAGE_SIZE = 1_000;

/**
 * What `CycleOpeningWorkflow` does for a Commission (the activities delegate here): find the cycles
 * the calendar has opened by today that were not opened for it yet, create each cycle's biennial
 * obligations for its active officers page by page, and record the cycle opened. Each step is safe
 * to repeat: the engine creates only what is missing, and a cycle is recorded (and announced)
 * once.
 *
 * Officers ingested after the opening date get the biennial on ingest (the engine's horizon is the
 * calendar, not this record), so the opening only has to reach the officers ingested before it.
 */
@Injectable()
export class CycleOpening {
  private readonly logger = new Logger(CycleOpening.name);

  constructor(
    @InjectDatabase() private readonly db: Database<DeclarationsSchema>,
    @Inject(EventPublisher) private readonly events: EventPublisher,
    private readonly directory: DirectoryClient,
    private readonly workflows: ObligationWorkflows,
    private readonly clock: Clock,
  ) {}

  /**
   * The cycles opened by today and not yet for the tenant, oldest first. Refreshes the tenant's
   * policy from the directory (the statement date and obligations-start date in force); the
   * cached one serves while the directory is unreachable. A Commission with no roster ingested
   * (no cached policy) has nothing to open.
   */
  async cyclesToOpen(tenant: string): Promise<number[]> {
    const cached = await this.cachedPolicy(tenant);
    if (!cached) return [];
    const rules = (await this.refreshPolicy(tenant)) ?? cached.rules;
    const [calendar, opened] = await Promise.all([
      this.calendar(),
      withTenant(this.db, systemContext(tenant), (tx) =>
        tx
          .select({ cycleYear: cycleOpenings.cycleYear })
          .from(cycleOpenings)
          .where(eq(cycleOpenings.tenant, tenant)),
      ),
    ]);
    const done = new Set(opened.map((row) => row.cycleYear));
    return openedCycles(calendar, rules, nairobiDate(this.clock.now())).filter(
      (year) => !done.has(year),
    );
  }

  /**
   * Creates the cycle's biennial obligations for one page of the tenant's active roster snapshots
   * (not exited), in one transaction, then starts their workflows (a failure is logged: the sweep
   * starts them).
   */
  async openPage(
    { tenant, cycleYear, cursor }: CycleOpeningPageRequest,
    progress: () => void = () => undefined,
  ): Promise<CycleOpeningPage> {
    const cycleKey = biennialCycleKey(cycleYear);
    const today = nairobiDate(this.clock.now());

    const { ids, changes } = await withTenant(this.db, systemContext(tenant), async (tx) => {
      const context = await storedReconcileContext(tx, tenant, today);
      if (!context) return { ids: [], changes: noChanges() };
      const page = await activeSnapshots(tx, tenant, cursor);
      const applied = await reconcileSnapshots(
        tx,
        this.events,
        context,
        page,
        (operation) => operation.kind === 'create' && operation.obligation.cycleKey === cycleKey,
      );
      return { ids: page, changes: applied };
    });
    progress();
    await tellWorkflows(this.workflows, this.logger, tenant, changes);
    return {
      created: changes.created.length,
      nextCursor: ids.length === PAGE_SIZE ? (ids.at(-1) ?? null) : null,
    };
  }

  /** Records the cycle opened for the tenant and announces it, once. */
  async recordOpened(tenant: string, { cycleYear, count }: CycleOpened): Promise<void> {
    await withTenant(this.db, systemContext(tenant), async (tx) => {
      const inserted = await tx
        .insert(cycleOpenings)
        .values({ tenant, cycleYear, obligationsCreated: count })
        .onConflictDoNothing()
        .returning({ cycleYear: cycleOpenings.cycleYear });
      if (inserted.length > 0) {
        await this.events.recordAll(tx, [cycleOpened(tenant, { cycleYear, count })]);
      }
    });
    this.logger.log({ tenant, cycleYear, count }, 'Cycle opened');
  }

  private async cachedPolicy(
    tenant: string,
  ): Promise<{ policyVersionId: string; rules: ObligationPolicy } | undefined> {
    const [row] = await withTenant(this.db, systemContext(tenant), (tx) =>
      tx
        .select({
          policyVersionId: tenantPolicyCache.policyVersionId,
          rules: tenantPolicyCache.policy,
        })
        .from(tenantPolicyCache)
        .where(eq(tenantPolicyCache.tenant, tenant)),
    );
    return row;
  }

  /** Pulls the policy in force into the cache; null when the directory could not be reached. */
  private async refreshPolicy(tenant: string): Promise<ObligationPolicy | null> {
    let pulled;
    try {
      pulled = await this.directory.getPolicy(tenant);
    } catch (error) {
      this.logger.warn({ err: error, tenant }, 'Policy not pulled; opening with the cached one');
      return null;
    }
    return withTenant(this.db, systemContext(tenant), (tx) => cachePolicy(tx, tenant, pulled));
  }

  private async calendar(): Promise<CycleCalendar> {
    return this.db.select().from(cycleCalendar).orderBy(asc(cycleCalendar.cycleYear));
  }
}

/** The ids of the next page of the tenant's roster snapshots still in office, by id. */
async function activeSnapshots(
  tx: Transaction,
  tenant: string,
  cursor: string | null,
): Promise<string[]> {
  const rows = await tx
    .select({ id: rosterSnapshots.rosterRecordId })
    .from(rosterSnapshots)
    .where(
      and(
        eq(rosterSnapshots.tenant, tenant),
        ne(rosterSnapshots.state, 'exited'),
        cursor === null ? undefined : gt(rosterSnapshots.rosterRecordId, cursor),
      ),
    )
    .orderBy(asc(rosterSnapshots.rosterRecordId))
    .limit(PAGE_SIZE);
  return rows.map((row) => row.id);
}
