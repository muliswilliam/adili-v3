import { Injectable } from '@nestjs/common';

import { Routing } from '../jobs/routing.js';
import { DATA_CLASSES, type DataClass } from '../jobs/task-request.js';
import { GatePolicies } from '../policy/gate-policies.js';
import type { ProviderClass } from '../providers/port.js';
import { ProviderRegistry } from '../providers/providers.module.js';
import { TASK_NAMES } from '../tasks/task.js';

/** Contract `TenantAiStatus`. */
export interface TenantAiStatus {
  tenant: string;
  enabled: boolean;
  providerClass: ProviderClass | null;
  dataClasses: DataClass[];
}

/**
 * Whether AI assistance is enabled for a tenant (the Commission status line, spec 07c): the
 * provider classes its tasks are routed to, and the data classes every one of them may process
 * under its gate. Routes on more than one class report `external`, the one that leaves the
 * platform; a route naming a provider this gateway cannot reach sends nothing anywhere.
 */
@Injectable()
export class TenantStatus {
  constructor(
    private readonly routing: Routing,
    private readonly providers: ProviderRegistry,
    private readonly gate: GatePolicies,
  ) {}

  async of(tenant: string): Promise<TenantAiStatus> {
    const [routes, gate] = await Promise.all([
      Promise.all(TASK_NAMES.map((task) => this.routing.route(tenant, task))),
      this.gate.effective(tenant),
    ]);
    const classes = new Set(
      routes.flatMap((route) => {
        const provider = this.providers.get(route.provider);
        return provider ? [provider.providerClass] : [];
      }),
    );
    if (classes.size === 0) {
      return { tenant, enabled: false, providerClass: null, dataClasses: [] };
    }
    const admits = (dataClass: DataClass, providerClass: ProviderClass) =>
      gate.some(
        (cell) =>
          cell.dataClass === dataClass && cell.providerClass === providerClass && cell.allowed,
      );
    const dataClasses = DATA_CLASSES.filter((dataClass) =>
      [...classes].every((providerClass) => admits(dataClass, providerClass)),
    );
    return {
      tenant,
      enabled: dataClasses.length > 0,
      providerClass: classes.has('external') ? 'external' : 'self-hosted',
      dataClasses,
    };
  }
}
