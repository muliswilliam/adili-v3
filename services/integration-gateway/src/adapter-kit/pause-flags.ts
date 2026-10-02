import { Injectable, Logger } from '@nestjs/common';
import { errorType } from '@adili/api-kit';
import { InjectValkey } from '@adili/cache';
import type { Redis } from 'iovalkey';

import type { System } from '../db/schema.js';

/**
 * Systems a platform administrator paused during a known outage: a circuit forced open, shared
 * by every instance. Lookups of a paused system answer `unavailable` (reason `paused`) without
 * calling it; cached answers are still served. When Valkey is down no system reads as paused.
 */
@Injectable()
export class PauseFlags {
  private readonly logger = new Logger(PauseFlags.name);

  constructor(@InjectValkey() private readonly valkey: Redis) {}

  async isPaused(system: System): Promise<boolean> {
    try {
      return (await this.valkey.exists(key(system))) === 1;
    } catch (error) {
      this.logger.warn(
        { system, errorType: errorType(error) },
        'Pause flag unreadable; not paused',
      );
      return false;
    }
  }

  async pause(system: System): Promise<void> {
    await this.valkey.set(key(system), new Date().toISOString());
  }

  async resume(system: System): Promise<void> {
    await this.valkey.del(key(system));
  }
}

const key = (system: System) => `paused:${system}`;
