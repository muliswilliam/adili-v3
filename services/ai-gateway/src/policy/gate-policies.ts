import { HttpStatus, Injectable } from '@nestjs/common';
import { ProblemException } from '@adili/api-kit';
import { InjectDatabase } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { lockTenantSetting } from '../db/locks.js';
import { asPlatform, asTenant, type GatewayDatabase } from '../db/context.js';
import { type GatePolicy, gatePolicies } from '../db/schema.js';
import { DATA_CLASSES, type DataClass, dataClassSchema } from '../jobs/task-request.js';
import { PROVIDER_CLASSES, type ProviderClass, providerClassSchema } from '../providers/port.js';
import { type TaskName, taskNameSchema } from '../tasks/task.js';
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
export const gateCellSchema = z.strictObject({
  dataClass: dataClassSchema,
  providerClass: providerClassSchema,
  allowed: z.boolean(),
});
export type GateCell = z.infer<typeof gateCellSchema>;

/**
 * The tasks a rule is for, or null for every task. A task the rule does not name follows the
 * gate's default for the pair, so an approval for one task (the demo reading synthetic documents
 * into the form) opens no other.
 */
const ruleTasks = z.array(taskNameSchema).min(1).nullable().meta({
  description:
    "The tasks the rule is for; null for every task. Any other task follows the gate's default for the pair",
});

/**
 * Contract `GateRuleInput`: a cell of the gate, for every task or only the ones named. Leaving
 * `tasks` out keeps an existing rule's scope; a rule for some tasks only is refused a change
 * without `tasks` (send them again, or null to widen it to every task).
 */
export const gateRuleInputSchema = z.strictObject({
  ...gateCellSchema.shape,
  tasks: ruleTasks.optional().meta({
    description:
      'The tasks the rule is for; null for every task, which a rule for some tasks only needs to be widened. Left out: every task for a new rule; refused for a rule that names tasks',
  }),
});
export type GateRuleInput = z.input<typeof gateRuleInputSchema>;

/** Contract `GatePolicyInput`: rules applied together, on one approval. */
export interface GateChange {
  rules: GateRuleInput[];
  approvalRef: string;
}

/** Whether `rule` decides for `task`: it names no tasks, or names this one. */
function decidesFor(rule: { tasks: readonly TaskName[] | null }, task: TaskName): boolean {
  return rule.tasks === null || rule.tasks.includes(task);
}

/** Contract `GateRule`: an explicit rule with who decided it and on which approval. */
export const gateRuleSchema = z
  .object({
    ...gateCellSchema.shape,
    tasks: ruleTasks,
    approvalRef: z.string(),
    changedBy: z.string().meta({ description: '`sub` of the platform admin who made the change' }),
    changedByName: z
      .string()
      .nullable()
      .meta({ description: 'Their display name at the time; null when unknown' }),
    changedAt: z.iso.datetime(),
  })
  .meta({
    description: "An explicit rule of a tenant's gate, with who decided it and on which approval",
  });
export type GateRule = z.infer<typeof gateRuleSchema>;

/** Contract `TenantPolicy`. */
export const tenantGateSchema = z.object({
  tenant: z.string(),
  rules: z.array(gateRuleSchema).meta({
    description:
      'Explicit rules, allowing or blocking, in DataClass then ProviderClass order. A pair without one follows `GatePolicyList.defaults`',
  }),
});
export type TenantGate = z.infer<typeof tenantGateSchema>;

/** Contract `GatePolicyList`. */
export const gatePolicyListSchema = z.object({
  defaults: z.array(gateCellSchema).meta({
    description:
      "The gate of every (data class, provider class) pair a tenant has no rule for: self-hosted providers may see every data class, external providers none, so a new tenant sends nothing outside the platform until a platform admin records an approved rule (the demo tenant's synthetic rule is seeded that way)",
  }),
  tenants: z
    .array(tenantGateSchema)
    .meta({ description: 'Tenants with at least one explicit rule, by tenant' }),
});
export type GatePolicyList = z.infer<typeof gatePolicyListSchema>;

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
    @InjectDatabase() private readonly db: GatewayDatabase,
    private readonly events: EventPublisher,
  ) {}

  /** Whether `task`'s jobs for `tenant` may send `dataClass` to `providerClass`. */
  async admits(
    tenant: string,
    dataClass: DataClass,
    providerClass: ProviderClass,
    task: TaskName,
  ): Promise<boolean> {
    const [rule] = await asTenant(this.db, tenant, (tx) =>
      tx
        .select({ allowed: gatePolicies.allowed, tasks: gatePolicies.tasks })
        .from(gatePolicies)
        .where(
          and(
            eq(gatePolicies.tenant, tenant),
            eq(gatePolicies.dataClass, dataClass),
            eq(gatePolicies.providerClass, providerClass),
          ),
        ),
    );
    return rule && decidesFor(rule, task) ? rule.allowed : defaultGateAdmits(providerClass);
  }

  /**
   * The tenant's gate for every pair, for every one of `tasks`: its rule where it has one that
   * decides for them all, else the default.
   */
  async effective(tenant: string, tasks: readonly TaskName[]): Promise<GateCell[]> {
    const rules = await this.rules(tenant);
    return defaultGate().map((cell) => {
      const rule = rules.find(
        (each) => each.dataClass === cell.dataClass && each.providerClass === cell.providerClass,
      );
      if (!rule || !tasks.every((task) => decidesFor(rule, task))) return cell;
      return {
        dataClass: rule.dataClass,
        providerClass: rule.providerClass,
        allowed: rule.allowed,
      };
    });
  }

  /** The tenant's explicit rules; pairs without one follow `defaultGateAdmits`. */
  async rules(tenant: string): Promise<GateRule[]> {
    const rows = await asTenant(this.db, tenant, (tx) =>
      tx.select().from(gatePolicies).where(eq(gatePolicies.tenant, tenant)),
    );
    return sortRules(rows.map(toRule));
  }

  /** Every tenant with explicit rules, by tenant. */
  async list(): Promise<TenantGate[]> {
    const rows = await asPlatform(this.db, (tx) =>
      tx.select().from(gatePolicies).orderBy(asc(gatePolicies.tenant)),
    );
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
    await asTenant(
      this.db,
      tenant,
      async (tx) => {
        // Concurrent changes of the tenant's gate apply, and are audited, in turn.
        await lockTenantSetting(tx, 'gate', tenant);
        for (const [index, input] of change.rules.entries()) {
          const key = and(
            eq(gatePolicies.tenant, tenant),
            eq(gatePolicies.dataClass, input.dataClass),
            eq(gatePolicies.providerClass, input.providerClass),
          );
          const [before] = await tx.select().from(gatePolicies).where(key);
          // A rule for some tasks only is widened to every task on purpose (`tasks: null`), never
          // by a change that does not mention tasks; the throw rolls back the whole change.
          if (before?.tasks && input.tasks === undefined) {
            throw new ProblemException({
              type: 'about:blank',
              title: 'Validation failed',
              status: HttpStatus.BAD_REQUEST,
              errors: [
                {
                  path: `rules.${index}.tasks`,
                  message: `The rule is for ${before.tasks.join(', ')} only: send tasks to keep it so, or null for every task`,
                },
              ],
            });
          }
          const tasks = input.tasks ?? before?.tasks ?? null;
          const decision = {
            allowed: input.allowed,
            tasks,
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
              tasks: before?.tasks ?? null,
              explicit: before !== undefined,
            },
            after: {
              dataClass: input.dataClass,
              providerClass: input.providerClass,
              allowed: after.allowed,
              tasks: after.tasks,
              explicit: true,
            },
          });
          await this.events.record(tx, event);
        }
      },
      actor.subject,
    );
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
    tasks: row.tasks,
    approvalRef: row.approvalRef,
    changedBy: row.changedBy,
    changedByName: row.changedByName,
    changedAt: row.changedAt.toISOString(),
  };
}
