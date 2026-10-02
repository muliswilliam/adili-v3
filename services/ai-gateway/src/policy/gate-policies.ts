import { Injectable } from '@nestjs/common';
import { type Database, InjectDatabase } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, asc, eq, sql } from 'drizzle-orm';

import { type GatePolicy, gatePolicies, type schema } from '../db/schema.js';
import { DATA_CLASSES, type DataClass } from '../jobs/task-request.js';
import { PROVIDER_CLASSES, type ProviderClass } from '../providers/port.js';
import { auditChange } from './audit.js';

/**
 * The classification gate's default, for a (data class, provider class) pair a tenant has no
 * rule for (spec 07c): self-hosted providers may see every data class; external providers see
 * none, so nothing leaves the platform until a platform admin records an approved rule. The
 * demo tenant's external-on-synthetic rule is recorded like one (see `seedDemoGatePolicies`).
 */
export function defaultGateAdmits(providerClass: ProviderClass): boolean {
  return providerClass === 'self-hosted';
}

/** Contract `GateRuleInput`: whether a provider class may see a data class. */
export interface GateCell {
  dataClass: DataClass;
  providerClass: ProviderClass;
  allowed: boolean;
}

/** Contract `GatePolicyInput`: rules applied together, on one approval. */
export interface GateChange {
  rules: GateCell[];
  approvalRef: string;
}

/** Contract `GateRule`: an explicit rule with who decided it and on which approval. */
export interface GateRule extends GateCell {
  approvalRef: string;
  changedBy: string;
  changedByName: string | null;
  changedAt: string;
}

/** Contract `TenantPolicy`. */
export interface TenantGate {
  tenant: string;
  rules: GateRule[];
}

/** Who changes a policy: the platform admin's subject and display name. */
export interface Actor {
  subject: string;
  name: string | null;
}

/** The default gate of every pair, in data class then provider class order. */
export function defaultGate(): GateCell[] {
  return DATA_CLASSES.flatMap((dataClass) =>
    PROVIDER_CLASSES.map((providerClass) => ({
      dataClass,
      providerClass,
      allowed: defaultGateAdmits(providerClass),
    })),
  );
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
    return rule ? rule.allowed : defaultGateAdmits(providerClass);
  }

  /** The tenant's gate for every pair: its rule where it has one, else the default. */
  async effective(tenant: string): Promise<GateCell[]> {
    const rules = await this.rules(tenant);
    return defaultGate().map(
      (cell) =>
        rules.find(
          (rule) => rule.dataClass === cell.dataClass && rule.providerClass === cell.providerClass,
        ) ?? cell,
    );
  }

  /** The tenant's explicit rules; pairs without one follow `defaultGateAdmits`. */
  async rules(tenant: string): Promise<GateRule[]> {
    const rows = await this.db.select().from(gatePolicies).where(eq(gatePolicies.tenant, tenant));
    return sortRules(rows.map(toRule));
  }

  /** Every tenant with explicit rules, by tenant. */
  async list(): Promise<TenantGate[]> {
    const rows = await this.db.select().from(gatePolicies).orderBy(asc(gatePolicies.tenant));
    const byTenant = new Map<string, GateRule[]>();
    for (const row of rows) {
      byTenant.set(row.tenant, [...(byTenant.get(row.tenant) ?? []), toRule(row)]);
    }
    return [...byTenant].map(([tenant, rules]) => ({ tenant, rules: sortRules(rules) }));
  }

  /**
   * Allows or blocks provider classes for data classes, recording who decided and on which
   * approval. Every rule, its audit record and its event commit together, or none does.
   */
  async set(tenant: string, change: GateChange, actor: Actor): Promise<TenantGate> {
    await this.db.transaction(async (tx) => {
      for (const input of change.rules) {
        const key = and(
          eq(gatePolicies.tenant, tenant),
          eq(gatePolicies.dataClass, input.dataClass),
          eq(gatePolicies.providerClass, input.providerClass),
        );
        // Locks the rule, so concurrent changes are audited in the order they apply.
        const [before] = await tx.select().from(gatePolicies).where(key).for('update');
        const decision = {
          allowed: input.allowed,
          approvalRef: change.approvalRef,
          changedBy: actor.subject,
          changedByName: actor.name,
        };
        const [after] = await tx
          .insert(gatePolicies)
          .values({
            tenant,
            dataClass: input.dataClass,
            providerClass: input.providerClass,
            ...decision,
          })
          .onConflictDoUpdate({
            target: [gatePolicies.tenant, gatePolicies.dataClass, gatePolicies.providerClass],
            set: { ...decision, changedAt: sql`now()` },
          })
          .returning();
        if (!after) throw new Error('Upsert returned no row');
        const event = await auditChange(tx, {
          action: 'ai.gate-policy.changed',
          tenant,
          actor: actor.subject,
          approvalRef: change.approvalRef,
          before: {
            dataClass: input.dataClass,
            providerClass: input.providerClass,
            allowed: before ? before.allowed : defaultGateAdmits(input.providerClass),
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
      }
    });
    return { tenant, rules: await this.rules(tenant) };
  }
}

/** Rules in the contract's order: data class, then provider class, as the enums list them. */
function sortRules(rules: GateRule[]): GateRule[] {
  const rank = (rule: GateRule) =>
    DATA_CLASSES.indexOf(rule.dataClass) * PROVIDER_CLASSES.length +
    PROVIDER_CLASSES.indexOf(rule.providerClass);
  return rules.sort((a, b) => rank(a) - rank(b));
}

function toRule(row: GatePolicy): GateRule {
  return {
    dataClass: row.dataClass,
    providerClass: row.providerClass,
    allowed: row.allowed,
    approvalRef: row.approvalRef,
    changedBy: row.changedBy,
    changedByName: row.changedByName,
    changedAt: row.changedAt.toISOString(),
  };
}
