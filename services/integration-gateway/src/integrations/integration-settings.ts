import { HttpStatus, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { errorType, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { eq } from 'drizzle-orm';

import { PauseFlags } from '../adapter-kit/pause-flags.js';
import { integrationSettings, type schema, type System, SYSTEMS } from '../db/schema.js';
import {
  INTEGRATIONS_SYSTEM_PAUSED,
  INTEGRATIONS_SYSTEM_RESUMED,
  systemPauseEvent,
} from './integration-events.js';

/** Who paused a system and when, as the Integrations page shows it. */
export interface PauseRecord {
  pausedBy: string;
  pausedAt: string;
}

/**
 * Pausing and resuming a system (spec 07b S13): a platform administrator forces a registry's
 * lookups to `unavailable` (reason `paused`) during a known outage, then lets them through again.
 *
 * The pause is recorded in `integration_settings` with who and when, and announced
 * (`integrations.system.paused.v1` / `resumed.v1`) in the same transaction. The table is the
 * truth; the pause flag the lookups read in Valkey follows it, written only once the transaction
 * has committed and from what the table then says, so a flag never runs ahead of a record that
 * did not commit. A flag that cannot be written is 503 with the record kept: pausing a paused
 * system (or resuming a running one) records nothing new and writes the flag again, so the retry
 * the 503 asks for converges. On start every flag is reconciled with the table both ways, so a
 * Valkey restart neither resumes a paused system nor leaves a stray flag pausing a running one.
 */
@Injectable()
export class IntegrationSettings implements OnApplicationBootstrap {
  private readonly logger = new Logger(IntegrationSettings.name);

  constructor(
    @InjectDatabase() private readonly db: Database<typeof schema>,
    private readonly events: EventPublisher,
    private readonly pauses: PauseFlags,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const rows = await this.db
        .select({ system: integrationSettings.system })
        .from(integrationSettings)
        .where(eq(integrationSettings.paused, true));
      const paused = new Set(rows.map((row) => row.system));
      for (const system of SYSTEMS) {
        await (paused.has(system) ? this.pauses.pause(system) : this.pauses.resume(system));
      }
    } catch (error) {
      // Not fatal: lookups fail open while Valkey is down, and the next pause sets the flag.
      this.logger.warn({ errorType: errorType(error) }, 'Pause flags not reconciled');
    }
  }

  async pause(system: System, principal: Principal): Promise<void> {
    await this.db.transaction(async (tx) => {
      // A system never paused has no row to lock: create it first, so two first pauses at once
      // queue on the row and the second finds it paused (one event, not two).
      await tx.insert(integrationSettings).values({ system }).onConflictDoNothing();
      const [current] = await tx
        .select()
        .from(integrationSettings)
        .where(eq(integrationSettings.system, system))
        .for('update');
      if (current?.paused) return;
      const paused = {
        paused: true,
        pausedBy: principal.subject,
        pausedByName: principal.name,
        pausedAt: new Date(),
        updatedAt: new Date(),
      };
      await tx
        .update(integrationSettings)
        .set(paused)
        .where(eq(integrationSettings.system, system));
      await this.events.record(
        tx,
        systemPauseEvent(INTEGRATIONS_SYSTEM_PAUSED, { system, by: principal.subject }),
      );
    });
    await this.syncFlag(system);
  }

  async resume(system: System, principal: Principal): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(integrationSettings)
        .where(eq(integrationSettings.system, system))
        .for('update');
      if (!current?.paused) return;
      await tx
        .update(integrationSettings)
        .set({
          paused: false,
          pausedBy: null,
          pausedByName: null,
          pausedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(integrationSettings.system, system));
      await this.events.record(
        tx,
        systemPauseEvent(INTEGRATIONS_SYSTEM_RESUMED, { system, by: principal.subject }),
      );
    });
    await this.syncFlag(system);
  }

  /** Who paused each paused system, and when. */
  async pauseRecords(): Promise<Map<System, PauseRecord>> {
    const rows = await this.db
      .select()
      .from(integrationSettings)
      .where(eq(integrationSettings.paused, true));
    return new Map(
      rows.flatMap((row) =>
        row.pausedAt === null
          ? []
          : [
              [
                row.system,
                {
                  pausedBy: row.pausedByName ?? row.pausedBy ?? 'A platform administrator',
                  pausedAt: row.pausedAt.toISOString(),
                },
              ],
            ],
      ),
    );
  }

  /**
   * Writes the system's pause flag as the committed table has it. Read after the commit, so of a
   * pause and a resume racing, the flag ends as the record that committed last.
   */
  private async syncFlag(system: System): Promise<void> {
    try {
      const [row] = await this.db
        .select({ paused: integrationSettings.paused })
        .from(integrationSettings)
        .where(eq(integrationSettings.system, system));
      await (row?.paused ? this.pauses.pause(system) : this.pauses.resume(system));
    } catch (error) {
      this.logger.error({ system, errorType: errorType(error) }, 'Pause flag not written');
      throw new ProblemException({
        type: 'pause-flag-unavailable',
        title: 'Pause not applied',
        status: HttpStatus.SERVICE_UNAVAILABLE,
        detail:
          'The change is recorded, but the pause flag could not be written, so lookups do not follow it yet. Try again shortly.',
      });
    }
  }
}
