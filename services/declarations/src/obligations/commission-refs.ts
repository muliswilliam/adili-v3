import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { inbox } from '@adili/events';
import { and, eq } from 'drizzle-orm';

import { Clock } from '../clock.js';
import type { DeclarationsSchema } from '../db/schema.js';
import { DirectoryClient, type PulledCommission } from '../directory/directory-client.js';
import { StartupTask } from '../startup-task.js';
import type { Transaction } from './apply-page.js';
import { commissionRefs } from './schema.js';
import { PLATFORM_CONTEXT } from './system-context.js';

/**
 * Keeps `commission_refs`, the service's read model of the platform's Commissions (ADR-013 local
 * read model): how obligations name their Commission, and the rows of the national summary, which
 * lists every Commission, a roster or not. Filled from `commission.created.v1` (the new
 * Commission pulled from the directory) and, on start-up, from the directory's list of every
 * Commission, so Commissions created before the service consumed the event, or while it was down,
 * are there too. Roster ingests refresh their Commission's row as well.
 */
@Injectable()
export class CommissionRefs implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CommissionRefs.name);
  private readonly task = new StartupTask(this.logger, 'Commission references not pulled', () =>
    this.pullAll(),
  );

  constructor(
    @InjectDatabase() private readonly db: Database<DeclarationsSchema>,
    private readonly directory: DirectoryClient,
    private readonly clock: Clock,
  ) {}

  onApplicationBootstrap(): void {
    this.task.start();
  }

  onApplicationShutdown(): void {
    this.task.stop();
  }

  /** Pulls every Commission from the directory into the read model. */
  async pullAll(): Promise<void> {
    const commissions = await this.directory.listCommissions();
    await withTenant(this.db, PLATFORM_CONTEXT, async (tx) => {
      for (const commission of commissions) {
        await upsertCommissionRef(tx, commission, this.clock.now());
      }
    });
  }

  /**
   * After `commission.created.v1`: pulls the new Commission into the read model, with the
   * consumer's inbox entry in the same transaction. Returns false when the consumer had already
   * handled the event; a failed pull throws and leaves the event for the retry.
   */
  async created(consumer: string, event: { id: string; tenant: string }): Promise<boolean> {
    const [handled] = await this.db
      .select({ eventId: inbox.eventId })
      .from(inbox)
      .where(and(eq(inbox.consumer, consumer), eq(inbox.eventId, event.id)))
      .limit(1);
    if (handled) return false;
    const commission = await this.directory.getCommission(event.tenant);
    await withTenant(this.db, PLATFORM_CONTEXT, async (tx) => {
      await upsertCommissionRef(tx, commission, this.clock.now());
      await tx.insert(inbox).values({ consumer, eventId: event.id }).onConflictDoNothing();
    });
    return true;
  }
}

/** Keeps the Commission's issuer code and name as last pulled; its last roster import stays. */
export async function upsertCommissionRef(
  tx: Transaction,
  commission: PulledCommission,
  fetchedAt: Date,
): Promise<void> {
  await tx
    .insert(commissionRefs)
    .values({ ...commission, fetchedAt })
    .onConflictDoUpdate({
      target: commissionRefs.slug,
      set: { issuerCode: commission.issuerCode, name: commission.name, fetchedAt },
    });
}
