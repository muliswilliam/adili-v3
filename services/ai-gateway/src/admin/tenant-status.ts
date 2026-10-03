import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { Routing } from '../jobs/routing.js';
import { DATA_CLASSES, type DataClass, dataClassSchema } from '../jobs/task-request.js';
import { GatePolicies } from '../policy/gate-policies.js';
import { type ProviderClass, providerClassSchema } from '../providers/port.js';
import { ProviderRegistry } from '../providers/providers.module.js';
import { REVIEWER_TASKS } from '../tasks/task.js';

/** Contract `TenantAiStatus`. */
export const tenantAiStatusSchema = z.object({
  tenant: z.string(),
  enabled: z
    .boolean()
    .meta({ description: "Some data class may be sent to the tenant's routed provider class" }),
  providerClass: providerClassSchema.nullable().meta({
    description:
      "The provider class of the tenant's reviewer task routes; `external` when they are on more than one. Null when no route names a provider this gateway can reach",
  }),
  provider: z.string().nullable().meta({
    description:
      "The provider the tenant's reviewer task routes name, of `providerClass` (the first by task order when they name several). Null when `providerClass` is",
  }),
  dataClasses: z.array(dataClassSchema).meta({
    description: 'Data classes every routed provider class may process, in DataClass order',
  }),
});
export type TenantAiStatus = z.infer<typeof tenantAiStatusSchema>;

/**
 * Whether AI assistance is enabled for a tenant (the Commission status line, spec 07c): the
 * provider classes its reviewer tasks are routed to, and the data classes every one of them may
 * process under its gate. EACC-only tasks are left out, as a Commission never calls them, and so is
 * Ask Adili, which its declarants call whatever its policy. Routes on
 * more than one class report `external`, the one that leaves the platform; a route naming a
 * provider this gateway cannot reach sends nothing anywhere.
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
      Promise.all(REVIEWER_TASKS.map((task) => this.routing.route(tenant, task))),
      this.gate.effective(tenant),
    ]);
    const reachable = routes.flatMap((route) => {
      const provider = this.providers.get(route.provider);
      return provider ? [provider] : [];
    });
    const classes = new Set(reachable.map((provider) => provider.providerClass));
    if (classes.size === 0) {
      return { tenant, enabled: false, providerClass: null, provider: null, dataClasses: [] };
    }
    const providerClass = classes.has('external') ? 'external' : 'self-hosted';
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
      providerClass,
      provider: reachable.find((each) => each.providerClass === providerClass)?.name ?? null,
      dataClasses,
    };
  }
}
