import { Injectable, Logger } from '@nestjs/common';
import { notFoundIfInvisible, type Principal } from '@adili/api-kit';
import { type Database, InjectDatabase, withPerson } from '@adili/data-access';
import type { DeclarationIssue } from '@adili/forms';
import { and, eq } from 'drizzle-orm';

import {
  AiGatewayClient,
  AiGatewayUnavailable,
  type AiLabel,
} from '../ai-gateway/ai-gateway-client.js';
import { Clock } from '../clock.js';
import { isEditable } from '../declaration/schema.js';
import type { DeclarationsSchema } from '../db/schema.js';
import { personOf } from '../drafts/access.js';
import { documentFrame, liveDeclaration, liveSections } from '../drafts/repository.js';
import { SectionCipher } from '../drafts/section-cipher.js';
import { reviewDraft } from '../drafts/summary.js';
import { isUuid } from '../guards.js';
import { householdCountsOf } from './context.js';
import { HINTS_PROMPT_VERSION, hintsJobKey, hintsOf, type HintsPlan, planHints } from './hints.js';
import type { CompletenessHints, HintsQuery } from './representation.js';
import { assistantHintCache } from './schema.js';

/** Hints written for a plan (none when nothing is left to complete), or why there are none. */
type Written =
  | { status: 'ready'; hints: string[]; label: AiLabel | null }
  | { status: 'pending' | 'unavailable' };

/**
 * Summary hints (spec 11 S5): on the summary of a draft, a plain-language hint from the
 * ai-gateway's hints mode beneath each residual's deterministic text, which is always there.
 * Hints already written for the same residuals are served from the cache; otherwise one hints
 * job is run, waited on for up to 10 s. Without AI (the gateway down or refusing, the job
 * failed, its hints not one per residual) the residuals come with their text only, and nothing
 * is cached; a job still running is `pending`, and the next load waits on the same job. The
 * declarant's own draft by the `person_id` claim; anyone else gets 404.
 */
@Injectable()
export class HintsService {
  private readonly logger = new Logger(HintsService.name);

  constructor(
    @InjectDatabase() private readonly db: Database<DeclarationsSchema>,
    private readonly sections: SectionCipher,
    private readonly gateway: AiGatewayClient,
    private readonly clock: Clock,
  ) {}

  async hints(
    principal: Principal,
    declarationId: string,
    query: HintsQuery,
  ): Promise<CompletenessHints> {
    const person = personOf(principal);
    const found = await withPerson(this.db, person, async (tx) => {
      if (!isUuid(declarationId)) return null;
      const declaration = await liveDeclaration(tx, declarationId);
      if (!declaration || !isEditable(declaration.status)) return null;
      return { declaration, sections: await liveSections(tx, declaration.id) };
    });
    const { declaration, sections } = notFoundIfInvisible(found);
    const review = reviewDraft(
      documentFrame(declaration),
      await this.sections.openAll(declaration.tenant, sections),
      sections.map((section) => ({ key: section.sectionKey, completeness: section.completeness })),
    );
    const plan = planHints(
      review.blocking,
      {
        declarationType: declaration.type,
        householdCounts: householdCountsOf(
          sections.find((section) => section.sectionKey === 'household')?.metadata,
        ),
      },
      query.language,
    );
    const written: Written =
      plan.input.context.residuals.length === 0
        ? { status: 'ready', hints: [], label: null }
        : ((await this.cached(plan)) ??
          (await this.write(declaration.tenant, declarationId, plan)));
    const { hints, label } = written.status === 'ready' ? written : { hints: [], label: null };
    return { status: written.status, label, residuals: withHints(review.blocking, plan, hints) };
  }

  private async cached(plan: HintsPlan): Promise<Written | null> {
    const [row] = await this.db
      .select()
      .from(assistantHintCache)
      .where(
        and(
          eq(assistantHintCache.residualHash, plan.hash),
          eq(assistantHintCache.language, plan.input.language),
          eq(assistantHintCache.promptVersion, HINTS_PROMPT_VERSION),
        ),
      );
    return row ? { status: 'ready', hints: row.hints, label: row.label } : null;
  }

  /** One hints job, waited on; its hints cached once checked. */
  private async write(tenant: string, declarationId: string, plan: HintsPlan): Promise<Written> {
    let job;
    try {
      job = await this.gateway.runHints(
        {
          tenant,
          subjectRef: `declaration:${declarationId}`,
          promptVersion: HINTS_PROMPT_VERSION,
          input: plan.input,
        },
        hintsJobKey(declarationId, plan, this.clock.now()),
      );
    } catch (error) {
      if (!(error instanceof AiGatewayUnavailable)) throw error;
      this.logger.warn({ err: error }, 'The ai-gateway did not take a hints job');
      return { status: 'unavailable' };
    }
    if (job.status === 'queued' || job.status === 'running') return { status: 'pending' };
    const hints = job.output ? hintsOf(job.output, plan.input) : null;
    if (!job.output || !hints) {
      if (job.status === 'succeeded') {
        this.logger.warn(
          { jobId: job.id },
          'A hints job wrote hints that are not one per residual',
        );
      }
      return { status: 'unavailable' };
    }
    const { label } = job.output;
    await this.db
      .insert(assistantHintCache)
      .values({
        residualHash: plan.hash,
        language: plan.input.language,
        promptVersion: HINTS_PROMPT_VERSION,
        hints,
        label,
        at: this.clock.now(),
      })
      .onConflictDoNothing();
    return { status: 'ready', hints, label };
  }
}

/** The blocking issues as the summary shows them, each with its hint (or none). */
function withHints(
  blocking: readonly DeclarationIssue[],
  plan: HintsPlan,
  hints: readonly string[],
): CompletenessHints['residuals'] {
  return blocking.map((issue, index) => {
    const residual = plan.residualOf[index];
    return {
      sectionKey: issue.sectionKey,
      path: issue.path,
      code: issue.code,
      message: issue.message,
      hint: residual === null || residual === undefined ? null : (hints[residual] ?? null),
    };
  });
}
