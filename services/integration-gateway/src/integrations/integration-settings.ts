import { HttpStatus, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { errorType, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { eq } from 'drizzle-orm';

import { PauseFlags } from '../adapter-kit/pause-flags.js';
import { integrationSettings, type schema, type System } from '../db/schema.js';
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
 * (`integrations.system.paused.v1` / `resumed.v1`) in the same transaction; the pause flag the
 * lookups read is set in Valkey inside that transaction, so a flag that cannot be set changes
 * nothing. Pausing a paused system (or resuming a running one) sets the flag again and records
 * nothing new. On start the flags of paused systems are restored from the table, so a Valkey
 * restart does not resume a system by itself.
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
      const paused = await this.db
        .select({ system: integrationSettings.system })
        .from(integrationSettings)
        .where(eq(integrationSettings.paused, true));
      for (const { system } of paused) await this.pauses.pause(system);
    } catch (error) {
      // Not fatal: lookups fail open while Valkey is down, and the next pause sets the flag.
      this.logger.warn({ errorType: errorType(error) }, 'Pause flags not restored');
    }
  }

  async pause(system: System, principal: Principal): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(integrationSettings)
        .where(eq(integrationSettings.system, system))
        .for('update');
      if (!current?.paused) {
        const paused = {
          paused: true,
          pausedBy: principal.subject,
          pausedByName: principal.name,
          pausedAt: new Date(),
          updatedAt: new Date(),
        };
        await tx
          .insert(integrationSettings)
          .values({ system, ...paused })
          .onConflictDoUpdate({ target: integrationSettings.system, set: paused });
        await this.events.record(
          tx,
          systemPauseEvent(INTEGRATIONS_SYSTEM_PAUSED, { system, by: principal.subject }),
        );
      }
      await this.applyFlag(() => this.pauses.pause(system));
    });
  }

  async resume(system: System, principal: Principal): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(integrationSettings)
        .where(eq(integrationSettings.system, system))
        .for('update');
      if (current?.paused) {
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
      }
      await this.applyFlag(() => this.pauses.resume(system));
    });
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

  private async applyFlag(apply: () => Promise<void>): Promise<void> {
    try {
      await apply();
    } catch (error) {
      this.logger.error({ errorType: errorType(error) }, 'Pause flag not written');
      throw new ProblemException({
        type: 'pause-flag-unavailable',
        title: 'Pause not applied',
        status: HttpStatus.SERVICE_UNAVAILABLE,
        detail: 'The pause flag could not be written. Nothing changed. Try again shortly.',
      });
    }
  }
}
