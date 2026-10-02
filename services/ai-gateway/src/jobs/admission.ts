import { Injectable } from '@nestjs/common';

import { Budgets } from '../policy/budgets.js';
import { GatePolicies } from '../policy/gate-policies.js';
import { ProviderRegistry } from '../providers/providers.module.js';
import type { JobReason } from './job-states.js';
import type { DataClass } from './task-request.js';

/** How a job ends without reaching its provider. */
export interface Refusal {
  status: 'failed' | 'blocked';
  reason: JobReason;
}

/**
 * The checks a job passes before its provider is called, in order: the provider is one this
 * process can reach, the classification gate admits the data class to its provider class, and
 * the tenant has budget left. Run when a job is created and again at each attempt, since policy,
 * budget and providers may change in between.
 */
@Injectable()
export class Admission {
  constructor(
    private readonly providers: ProviderRegistry,
    private readonly gate: GatePolicies,
    private readonly budgets: Budgets,
  ) {}

  /** Why a job for `tenant` must end without its provider; undefined when it may go ahead. */
  async refusal(
    tenant: string,
    dataClass: DataClass,
    provider: string,
  ): Promise<Refusal | undefined> {
    const reachable = this.providers.get(provider);
    if (!reachable) return { status: 'failed', reason: 'provider-unavailable' };
    if (!(await this.gate.admits(tenant, dataClass, reachable.providerClass))) {
      return { status: 'blocked', reason: 'policy' };
    }
    if (await this.budgets.exhausted(tenant)) return { status: 'blocked', reason: 'budget' };
    return undefined;
  }
}
