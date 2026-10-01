import { PLATFORM_TENANT } from '@adili/api-kit';
import type { NewEvent } from '@adili/events';

import type { System } from '../db/schema.js';

/**
 * A platform administrator paused a system during a known outage, or resumed it (spec 07b).
 * Subject: the system; tenant: `platform` (a pause is no Commission's). `by` is the
 * administrator's subject. Documented here until the AsyncAPI file lands.
 */
export const INTEGRATIONS_SYSTEM_PAUSED = 'integrations.system.paused.v1';
export const INTEGRATIONS_SYSTEM_RESUMED = 'integrations.system.resumed.v1';

export interface SystemPauseData extends Record<string, unknown> {
  system: System;
  by: string;
}

export function systemPauseEvent(
  type: typeof INTEGRATIONS_SYSTEM_PAUSED | typeof INTEGRATIONS_SYSTEM_RESUMED,
  data: SystemPauseData,
): NewEvent<SystemPauseData> {
  return { type, subject: data.system, tenant: PLATFORM_TENANT, data };
}
