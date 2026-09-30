import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, asc, count, eq, ne } from 'drizzle-orm';

import { Clock } from '../../clock.js';
import type { DeclarationsSchema } from '../../db/schema.js';
import { DirectoryClient } from '../../directory/directory-client.js';
import {
  reconcileSnapshots,
  SNAPSHOT_PAGE_SIZE,
  snapshotPage,
  storedReconcileContext,
} from '../apply-page.js';
import { biennialCycleKey } from '../cycle-key.js';
import { nairobiDate } from '../dates.js';
import { type CycleCalendar, type ObligationPolicy, openedCycles } from '../engine.js';
import { cycleOpened } from '../events.js';
import { cachePolicy } from '../roster-ingest.js';
import { systemContext } from '../system-context.js';
import { cycleCalendar, cycleOpenings, filingObligations, tenantPolicyCache } from '../schema.js';
import { noChanges, ObligationWorkflows, tellWorkflows } from '../workflows.js';
import type { CycleOpened, CycleOpeningPage, CycleOpeningPageRequest } from './contract.js';

/**
 * How often a page reports progress while it works (its transaction, then its workflow starts):
 * well inside the activity's 2-minute heartbeat timeout.
 */
const HEARTBEAT_EVERY_MS = 15_000;

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
   * starts them). Calls `progress` at the start and every 15 seconds until done, so a live page is
   * never taken for a dead one.
   */
  async openPage(
    request: CycleOpeningPageRequest,
    progress: () => void = () => undefined,
  ): Promise<CycleOpeningPage> {
    progress();
    const beat = setInterval(progress, HEARTBEAT_EVERY_MS);
    try {
      return await this.createPage(request);
    } finally {
      clearInterval(beat);
    }
  }

  private async createPage({
    tenant,
    cycleYear,
    cursor,
  }: CycleOpeningPageRequest): Promise<CycleOpeningPage> {
    const cycleKey = biennialCycleKey(cycleYear);
    const today = nairobiDate(this.clock.now());

    const { ids, changes } = await withTenant(this.db, systemContext(tenant), async (tx) => {
      const context = await storedReconcileContext(tx, tenant, today);
      if (!context) return { ids: [], changes: noChanges() };
      const page = await snapshotPage(tx, tenant, cursor, { inOffice: true });
      const applied = await reconcileSnapshots(
        tx,
        this.events,
        context,
        page,
        (operation) => operation.kind === 'create' && operation.obligation.cycleKey === cycleKey,
      );
      return { ids: page, changes: applied };
    });
    await tellWorkflows(this.workflows, this.logger, tenant, changes);
    return {
      created: changes.created.length,
      nextCursor: ids.length === SNAPSHOT_PAGE_SIZE ? (ids.at(-1) ?? null) : null,
    };
  }

  /**
   * Records the cycle opened for the tenant and announces it, once, with the tenant's live
   * biennial obligations of the cycle counted from the database: a retried page (which creates
   * nothing the second time) cannot skew it. A repeat returns the count first recorded.
   */
  async recordOpened(tenant: string, cycleYear: number): Promise<CycleOpened> {
    const opened = await withTenant(this.db, systemContext(tenant), async (tx) => {
      const [live] = await tx
        .select({ count: count() })
        .from(filingObligations)
        .where(
          and(
            eq(filingObligations.tenant, tenant),
            eq(filingObligations.cycleKey, biennialCycleKey(cycleYear)),
            ne(filingObligations.status, 'cancelled'),
          ),
        );
      const inserted = await tx
        .insert(cycleOpenings)
        .values({ tenant, cycleYear, obligationsCreated: live?.count ?? 0 })
        .onConflictDoNothing()
        .returning({ count: cycleOpenings.obligationsCreated });
      const [first] = inserted;
      if (first) {
        await this.events.recordAll(tx, [cycleOpened(tenant, { cycleYear, count: first.count })]);
        return { cycleYear, count: first.count };
      }
      const [recorded] = await tx
        .select({ count: cycleOpenings.obligationsCreated })
        .from(cycleOpenings)
        .where(and(eq(cycleOpenings.tenant, tenant), eq(cycleOpenings.cycleYear, cycleYear)));
      return { cycleYear, count: recorded?.count ?? 0 };
    });
    this.logger.log({ tenant, ...opened }, 'Cycle opened');
    return opened;
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
    return withTenant(this.db, systemContext(tenant), (tx) =>
      cachePolicy(tx, tenant, pulled, this.clock.now()),
    );
  }

  private async calendar(): Promise<CycleCalendar> {
    return this.db.select().from(cycleCalendar).orderBy(asc(cycleCalendar.cycleYear));
  }
}
