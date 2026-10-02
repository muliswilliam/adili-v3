/**
 * The scope a service's token needs for the gateway's internal API (tasks, jobs, feedback,
 * tenant status). Its holders name the tenant they act for in `X-Acting-Tenant` (ADR-013 §8.8).
 */
export const AI_SCOPE = 'ai:internal';
