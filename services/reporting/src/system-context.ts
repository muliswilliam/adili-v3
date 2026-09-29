import type { TenantContext } from '@adili/data-access';

/** `app.subject` of the service's own transactions (consumers, workflows). */
export const SYSTEM_SUBJECT = 'system:reporting';

/** The RLS context of the service's own work for one tenant. */
export function systemContext(tenant: string): TenantContext {
  return { tenant, subject: SYSTEM_SUBJECT };
}
