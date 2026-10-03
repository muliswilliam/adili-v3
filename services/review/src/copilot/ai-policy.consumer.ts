import { Controller } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { PLATFORM_TENANT, TENANT_KEY } from '@adili/api-kit';
import { type Database, InjectDatabase } from '@adili/data-access';
import { consumeOnce, type EventEnvelope, OnEvent } from '@adili/events';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import type { ReviewTask } from '../ai-gateway/ai-gateway-client.js';
import { type InboxTransaction, withInboxTenant } from '../system-context.js';
import { CopilotWorkflows } from './copilot-workflows.js';
import { AI_GATE_POLICY_CHANGED, AI_POLICY_CHANGED, AI_ROUTE_CHANGED } from './events.js';
import { reviewCopilots } from './schema.js';

/** The inbox consumer name of `ai.policy.changed.v1`. */
export const AI_POLICY_CONSUMER = 'review.ai-policy';

/**
 * What the consumer reads from `ai.policy.changed.v1`: the action, for a gate rule whether it now
 * admits, and for a route its task. A route's `after` has no `allowed`.
 */
const policyChangedData = z.object({
  action: z.string(),
  before: z.object({ task: z.string().optional() }).loose().nullish(),
  after: z
    .object({ allowed: z.boolean().optional(), task: z.string().optional() })
    .loose()
    .nullish(),
});

/** The tasks a case's copilot runs; a route of any other task (drafts) leaves copilots alone. */
const COPILOT_TASKS: ReadonlySet<string> = new Set<ReviewTask>([
  'summarize-declaration',
  'explain-flags',
]);

/**
 * The ai-gateway's policy changes (spec 07c). A case's copilot reads `not-enabled` while the
 * classification gate blocks its Commission; the consumer starts `copilotPolicyChanged`, which
 * requests each such copilot again so the gateway decides anew, when a gate rule of the
 * Commission now admits a provider class, or when a route moved: the Commission's own (event
 * tenant), or a default route (tenant `platform`), for every Commission with a not-enabled
 * copilot. A route may admit by moving a copilot task to a provider class the gate allows; a
 * route of another task (drafts) changes nothing. Budget changes and rules that block change
 * nothing here. Each event is handled once (inbox); the starts are
 * idempotent by event and Commission.
 */
@Controller()
export class AiPolicyConsumer {
  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly workflows: CopilotWorkflows,
  ) {}

  @OnEvent(AI_POLICY_CHANGED)
  async changed(@Payload() event: EventEnvelope): Promise<void> {
    const data = policyChangedData.safeParse(event.data);
    if (!data.success) return;
    const { action, before, after } = data.data;
    const tenant = event.tenant;
    if (typeof tenant !== 'string' || !TENANT_KEY.test(tenant)) return;
    const admits = action === AI_GATE_POLICY_CHANGED && after?.allowed === true;
    const copilotRoute =
      action === AI_ROUTE_CHANGED &&
      [before?.task, after?.task].some((task) => task !== undefined && COPILOT_TASKS.has(task));
    if (!admits && !copilotRoute) return;
    // Only a default route is platform-wide; a gate rule is always one Commission's.
    if (tenant === PLATFORM_TENANT && action !== AI_ROUTE_CHANGED) return;
    await consumeOnce(this.db, AI_POLICY_CONSUMER, event, async (inboxTx) => {
      const tenants = tenant === PLATFORM_TENANT ? await notEnabledTenants(inboxTx) : [tenant];
      for (const each of tenants) await this.workflows.policyChanged(event.id, each);
    });
  }
}

/** The Commissions with a copilot the gate blocked, read across tenants as platform work. */
async function notEnabledTenants(inboxTx: InboxTransaction): Promise<string[]> {
  const tx = await withInboxTenant(inboxTx, PLATFORM_TENANT);
  const rows = await tx
    .selectDistinct({ tenant: reviewCopilots.tenant })
    .from(reviewCopilots)
    .where(eq(reviewCopilots.status, 'not-enabled'));
  return rows.map((row) => row.tenant).sort();
}
