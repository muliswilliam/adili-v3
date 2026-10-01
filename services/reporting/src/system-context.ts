import type { TenantContext } from '@adili/data-access';

import { EACC_TENANT } from './access.js';

/** `app.subject` of the service's own transactions (consumers, workflows). */
export const SYSTEM_SUBJECT = 'system:reporting';

/**
 * The platform's tenant: its row-level security context sees every Commission's rows (the
 * service's reads across Commissions), and calls about every Commission act on its behalf.
 */
export const PLATFORM_TENANT = 'platform';

/** The RLS context of the service's own work for one tenant. */
export function systemContext(tenant: string): TenantContext {
  return { tenant, subject: SYSTEM_SUBJECT };
}

/**
 * The RLS context of work in EACC's tenant (every Commission's submitted reports, the national
 * report, the referrals intake): an EACC officer's (`subject`), or the service's own.
 */
export function eaccContext(subject: string = SYSTEM_SUBJECT): TenantContext {
  return { tenant: EACC_TENANT, subject };
}
