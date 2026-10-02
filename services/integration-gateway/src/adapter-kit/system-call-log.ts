import { Injectable } from '@nestjs/common';
import { type Database, InjectDatabase } from '@adili/data-access';
import { v7 as uuidv7 } from 'uuid';

import { type schema, type System, systemCalls } from '../db/schema.js';
import type { CallOutcome } from './resilient-calls.js';

/** A database or transaction the call's row is written with. */
type Writer = Pick<Database<typeof schema>, 'insert'>;

export interface SystemCall {
  system: System;
  outcome: CallOutcome<unknown>;
  /** `performance.now()` when the call started. */
  started: number;
  /** OAuth client of the calling service. */
  caller: string;
}

/**
 * The calls to systems that are not lookups (payroll instructions), one `system_calls` row each,
 * which coverage counts as it counts lookups from verification results. Counts, not an audit
 * trail: the adapter's own rows and events are that, written in the same transaction.
 */
@Injectable()
export class SystemCallLog {
  constructor(@InjectDatabase() private readonly db: Database<typeof schema>) {}

  /** Writes the call's row with `writer`: the transaction that records what the call achieved. */
  async record(call: SystemCall, writer: Writer = this.db): Promise<void> {
    await writer.insert(systemCalls).values({
      id: uuidv7(),
      system: call.system,
      outcome: call.outcome.outcome,
      reason: call.outcome.outcome === 'unavailable' ? call.outcome.reason : null,
      latencyMs: Math.round(performance.now() - call.started),
      caller: call.caller,
    });
  }
}
