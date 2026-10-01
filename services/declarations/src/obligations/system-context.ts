import { PLATFORM_TENANT } from '@adili/api-kit';
import type { TenantContext } from '@adili/data-access';

/** `app.subject` of the service's own transactions (consumers, workflows, schedules). */
export const SYSTEM_SUBJECT = 'system:declarations';

/** The RLS context of the service's own work for one tenant. */
export function systemContext(tenant: string): TenantContext {
  return { tenant, subject: SYSTEM_SUBJECT };
}

/** The RLS context of the service's own work across tenants (the sweep, start-up schedules). */
export const PLATFORM_CONTEXT: TenantContext = { tenant: PLATFORM_TENANT, subject: SYSTEM_SUBJECT };
