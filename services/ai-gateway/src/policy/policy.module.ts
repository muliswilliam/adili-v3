import { Module } from '@nestjs/common';

import { config } from '../config.js';
import { BUDGET_DEFAULTS, type BudgetLimits, Budgets } from './budgets.js';
import { BREAKER_OPTIONS, type BreakerOptions, CircuitBreaker } from './circuit-breaker.js';
import { GatePolicies } from './gate-policies.js';
import { GenAiTelemetry } from './telemetry.js';

/** The policy layer between tasks and providers: gate, budgets, breaker, telemetry (spec 07c). */
@Module({
  providers: [
    GatePolicies,
    Budgets,
    CircuitBreaker,
    GenAiTelemetry,
    {
      provide: BUDGET_DEFAULTS,
      useValue: {
        monthlyTokens: config.AI_DEFAULT_MONTHLY_TOKENS,
        perMinute: config.AI_DEFAULT_PER_MINUTE,
      } satisfies BudgetLimits,
    },
    {
      provide: BREAKER_OPTIONS,
      useValue: {
        failureThreshold: config.AI_BREAKER_FAILURE_THRESHOLD,
        cooldownMs: config.AI_BREAKER_COOLDOWN_MS,
      } satisfies BreakerOptions,
    },
  ],
  exports: [GatePolicies, Budgets, CircuitBreaker, GenAiTelemetry],
})
export class PolicyModule {}
