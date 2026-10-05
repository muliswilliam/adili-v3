import { Client, Connection } from '@temporalio/client';

import type { SeedConfig } from '../config.js';

/**
 * Runs one of the services' Temporal schedules now (e.g. review's daily closure sweep), as
 * Temporal's own "trigger" does, instead of waiting for its next run.
 */
export async function triggerSchedule(config: SeedConfig, scheduleId: string): Promise<void> {
  const connection = await Connection.connect({ address: config.TEMPORAL_ADDRESS });
  try {
    const client = new Client({ connection, namespace: config.TEMPORAL_NAMESPACE });
    await client.schedule.getHandle(scheduleId).trigger();
  } finally {
    await connection.close();
  }
}
