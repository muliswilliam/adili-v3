import { Controller } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { TENANT_KEY } from '@adili/api-kit';
import { type Database, InjectDatabase } from '@adili/data-access';
import { consumeOnce, type EventEnvelope, OnEvent } from '@adili/events';
import { z } from 'zod';

import { CopilotWorkflows } from './copilot-workflows.js';
import { AI_GATE_POLICY_CHANGED, AI_POLICY_CHANGED } from './events.js';

/** The inbox consumer name of `ai.policy.changed.v1`. */
export const AI_POLICY_CONSUMER = 'review.ai-policy';

/** What the consumer reads from `ai.policy.changed.v1`: the action and whether a rule now admits. */
const policyChangedData = z.object({
  action: z.string(),
  after: z.object({ allowed: z.boolean() }).loose().nullish(),
});

/**
 * The ai-gateway's policy changes (spec 07c). A case's copilot reads `not-enabled` while the
 * classification gate blocks its Commission; when a gate rule of the Commission now admits a
 * provider class, the consumer starts `copilotPolicyChanged`, which requests each such copilot
 * again so the gateway decides anew. Budget changes and rules that block change nothing here.
 * Each event is handled once (inbox); the start is idempotent by event.
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
    if (!data.success || data.data.action !== AI_GATE_POLICY_CHANGED) return;
    if (data.data.after?.allowed !== true) return;
    const tenant = event.tenant;
    if (typeof tenant !== 'string' || !TENANT_KEY.test(tenant)) return;
    await consumeOnce(this.db, AI_POLICY_CONSUMER, event, () =>
      this.workflows.policyChanged(event.id, tenant),
    );
  }
}
