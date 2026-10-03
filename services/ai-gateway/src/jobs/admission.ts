import { Injectable } from '@nestjs/common';

import { Budgets } from '../policy/budgets.js';
import { GatePolicies } from '../policy/gate-policies.js';
import { PROVIDER_CLASSES } from '../providers/port.js';
import { ProviderRegistry } from '../providers/providers.module.js';
import type { JobReason } from './job-states.js';
import type { DataClass } from './task-request.js';

/** How a job ends without reaching its provider. */
export interface Refusal {
  status: 'failed' | 'blocked';
  reason: JobReason;
}

/**
 * The checks a job passes before its provider is called, in order: the classification gate
 * admits the data class to its provider class, the tenant has budget left, and the provider is
 * one this process can reach. Run when a job is created and again at each attempt, since policy,
 * budget and providers may change in between.
 *
 * The gate comes first, so a job the tenant's policy refuses is `blocked` (`policy`) whatever
 * the route names. A provider this process cannot reach has no known class: the gate admits it
 * only if it admits the data class to every provider class, and the job then fails
 * `provider-unavailable`.
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
    const classes = reachable ? [reachable.providerClass] : PROVIDER_CLASSES;
    const admitted = await Promise.all(
      classes.map((providerClass) => this.gate.admits(tenant, dataClass, providerClass)),
    );
    if (!admitted.every(Boolean)) return { status: 'blocked', reason: 'policy' };
    if (await this.budgets.exhausted(tenant)) return { status: 'blocked', reason: 'budget' };
    if (!reachable) return { status: 'failed', reason: 'provider-unavailable' };
    return undefined;
  }
}
