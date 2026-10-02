import { burstOf, type SystemPolicies } from './adapter-kit/system-policies.js';
import { config } from './config.js';
import { KRA_BURST } from './registries/kra-adapter.js';

/**
 * Every system's policy, from the service's configuration: what `AdapterKitModule.forRoot` is
 * given. A system with no policy has no adapter (coverage leaves it out).
 */
export const SYSTEM_POLICY_CONFIG: SystemPolicies = {
  iprs: {
    timeoutMs: config.IPRS_TIMEOUT_MS,
    cacheTtlSeconds: config.IPRS_CACHE_TTL_SECONDS,
    ratePerMinute: config.IPRS_RATE_LIMIT_PER_MINUTE,
    burst: burstOf(config.IPRS_RATE_LIMIT_PER_MINUTE),
    maxQueueMs: config.RATE_LIMIT_MAX_WAIT_MS,
  },
  kra: {
    timeoutMs: config.KRA_TIMEOUT_MS,
    cacheTtlSeconds: config.KRA_CACHE_TTL_SECONDS,
    ratePerMinute: config.KRA_RATE_LIMIT_PER_MINUTE,
    burst: burstOf(config.KRA_RATE_LIMIT_PER_MINUTE, KRA_BURST),
    maxQueueMs: config.RATE_LIMIT_MAX_WAIT_MS,
  },
  ntsa: {
    timeoutMs: config.NTSA_TIMEOUT_MS,
    cacheTtlSeconds: config.NTSA_CACHE_TTL_SECONDS,
    ratePerMinute: config.NTSA_RATE_LIMIT_PER_MINUTE,
    burst: burstOf(config.NTSA_RATE_LIMIT_PER_MINUTE),
    maxQueueMs: config.RATE_LIMIT_MAX_WAIT_MS,
  },
  brs: {
    timeoutMs: config.BRS_TIMEOUT_MS,
    cacheTtlSeconds: config.BRS_CACHE_TTL_SECONDS,
    ratePerMinute: config.BRS_RATE_LIMIT_PER_MINUTE,
    burst: burstOf(config.BRS_RATE_LIMIT_PER_MINUTE),
    maxQueueMs: config.RATE_LIMIT_MAX_WAIT_MS,
  },
  ardhisasa: {
    timeoutMs: config.ARDHISASA_TIMEOUT_MS,
    cacheTtlSeconds: config.ARDHISASA_CACHE_TTL_SECONDS,
    ratePerMinute: config.ARDHISASA_RATE_LIMIT_PER_MINUTE,
    burst: burstOf(config.ARDHISASA_RATE_LIMIT_PER_MINUTE),
    maxQueueMs: config.RATE_LIMIT_MAX_WAIT_MS,
  },
  'hr-suppliers': {
    timeoutMs: config.HR_SUPPLIERS_TIMEOUT_MS,
    cacheTtlSeconds: config.HR_SUPPLIERS_CACHE_TTL_SECONDS,
    ratePerMinute: config.HR_SUPPLIERS_RATE_LIMIT_PER_MINUTE,
    burst: burstOf(config.HR_SUPPLIERS_RATE_LIMIT_PER_MINUTE),
    maxQueueMs: config.RATE_LIMIT_MAX_WAIT_MS,
  },
  payroll: {
    timeoutMs: config.PAYROLL_TIMEOUT_MS,
    // An instruction is an act, not a read: never answered from a cache.
    cacheTtlSeconds: null,
    ratePerMinute: config.PAYROLL_RATE_LIMIT_PER_MINUTE,
    burst: burstOf(config.PAYROLL_RATE_LIMIT_PER_MINUTE),
    maxQueueMs: config.RATE_LIMIT_MAX_WAIT_MS,
  },
};
