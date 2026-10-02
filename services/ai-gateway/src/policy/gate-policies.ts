import { Injectable } from '@nestjs/common';
import { type Database, InjectDatabase } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, asc, eq, sql } from 'drizzle-orm';

import { type GatePolicy, gatePolicies, type schema } from '../db/schema.js';
import type { DataClass } from '../jobs/task-request.js';
import type { ProviderClass } from '../providers/port.js';
import { auditChange } from './audit.js';

/**
 * The classification gate's default, for a (data class, provider class) pair a tenant has no
 * rule for (spec 07c): self-hosted providers may see every data class; external providers see
 * synthetic data only, so no real declaration leaves the platform without a recorded decision.
 */
export function defaultGateAdmits(dataClass: DataClass, providerClass: ProviderClass): boolean {
  return providerClass === 'self-hosted' || dataClass === 'synthetic';
}

/** Contract `GatePolicyInput`. */
export interface GateRuleInput {
  dataClass: DataClass;
  providerClass: ProviderClass;
  allowed: boolean;
  approvalRef: string;
}

/** Contract `TenantPolicy` rule. */
export interface GateRule extends GateRuleInput {
  changedBy: string;
  changedAt: string;
}

/**
 * The classification gate: which provider class may see which data class, per tenant. A blocked
 * request never reaches a provider; the job is `blocked` with reason `policy`.
 */
@Injectable()
export class GatePolicies {
  constructor(
    @InjectDatabase() private readonly db: Database<typeof schema>,
    private readonly events: EventPublisher,
  ) {}

  async admits(
    tenant: string,
    dataClass: DataClass,
    providerClass: ProviderClass,
  ): Promise<boolean> {
    const [rule] = await this.db
      .select({ allowed: gatePolicies.allowed })
      .from(gatePolicies)
      .where(
        and(
          eq(gatePolicies.tenant, tenant),
          eq(gatePolicies.dataClass, dataClass),
          eq(gatePolicies.providerClass, providerClass),
        ),
      );
    return rule ? rule.allowed : defaultGateAdmits(dataClass, providerClass);
  }

  /** The tenant's explicit rules; pairs without one follow `defaultGateAdmits`. */
  async rules(tenant: string): Promise<GateRule[]> {
    const rows = await this.db
      .select()
      .from(gatePolicies)
      .where(eq(gatePolicies.tenant, tenant))
      .orderBy(asc(gatePolicies.dataClass), asc(gatePolicies.providerClass));
    return rows.map(toRule);
  }

  /**
   * Allows or blocks a provider class for a data class, recording who decided and on which
   * approval. The change, its audit record and its event commit together.
   */
  async set(tenant: string, input: GateRuleInput, actor: string): Promise<GateRule> {
    return this.db.transaction(async (tx) => {
      const key = and(
        eq(gatePolicies.tenant, tenant),
        eq(gatePolicies.dataClass, input.dataClass),
        eq(gatePolicies.providerClass, input.providerClass),
      );
      // Locks the rule, so concurrent changes are audited in the order they apply.
      const [before] = await tx.select().from(gatePolicies).where(key).for('update');
      const [after] = await tx
        .insert(gatePolicies)
        .values({ tenant, ...input, changedBy: actor })
        .onConflictDoUpdate({
          target: [gatePolicies.tenant, gatePolicies.dataClass, gatePolicies.providerClass],
          set: {
            allowed: input.allowed,
            approvalRef: input.approvalRef,
            changedBy: actor,
            changedAt: sql`now()`,
          },
        })
        .returning();
      if (!after) throw new Error('Upsert returned no row');
      const event = await auditChange(tx, {
        action: 'ai.gate-policy.changed',
        tenant,
        actor,
        approvalRef: input.approvalRef,
        before: {
          dataClass: input.dataClass,
          providerClass: input.providerClass,
          allowed: before
            ? before.allowed
            : defaultGateAdmits(input.dataClass, input.providerClass),
          explicit: before !== undefined,
        },
        after: {
          dataClass: input.dataClass,
          providerClass: input.providerClass,
          allowed: after.allowed,
          explicit: true,
        },
      });
      await this.events.record(tx, event);
      return toRule(after);
    });
  }
}

function toRule(row: GatePolicy): GateRule {
  return {
    dataClass: row.dataClass,
    providerClass: row.providerClass,
    allowed: row.allowed,
    approvalRef: row.approvalRef,
    changedBy: row.changedBy,
    changedAt: row.changedAt.toISOString(),
  };
}
