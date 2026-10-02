import { Injectable } from '@nestjs/common';
import type { Principal } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { and, count, eq, isNotNull } from 'drizzle-orm';

import { requireEacc } from '../access.js';
import type { ReportingSchema } from '../db/schema.js';
import { AI_FEEDBACK_REASONS } from '../projections/events.js';
import { aiFeedbackFacts, copilotCaseFacts } from '../projections/schema.js';
import { eaccContext } from '../system-context.js';

type AiFeedbackReason = (typeof AI_FEEDBACK_REASONS)[number];

/** reporting.yaml `AiTaskRatings`: the ratings of one task's outputs. */
export interface AiTaskRatings {
  task: string;
  helpful: number;
  notHelpful: number;
  /** Not-helpful (or helpful) ratings by the reason given; a rating without one is in neither. */
  reasons: Record<AiFeedbackReason, number>;
}

/** reporting.yaml `AiUsageCommission`. */
export interface AiUsageCommission {
  tenant: string;
  /** Cases whose copilot first had outputs to show in the year. */
  aiAssistedCases: number;
  /** Ratings last given in the year, by task, in task order. */
  ratings: AiTaskRatings[];
}

/** reporting.yaml `AiUsageReport`. */
export interface AiUsageReport {
  fy: number;
  /** Commissions with an AI-assisted case or a rating in the year, in slug order. */
  commissions: AiUsageCommission[];
}

const EACC_ONLY = 'Only EACC analysts and supervisors see the AI usage counts.';

/**
 * The AI reviewer copilot's counts per Commission and financial year (spec 07c story 19), for
 * EACC's analysts and supervisors: AI-assisted cases and reviewers' ratings, from the copilot and
 * rating events' facts. Counts only: no case, reviewer, output or note.
 */
@Injectable()
export class AiUsageService {
  constructor(@InjectDatabase() private readonly db: Database<ReportingSchema>) {}

  async report(principal: Principal, fy: number): Promise<AiUsageReport> {
    requireEacc(principal, EACC_ONLY);
    const { cases, ratings } = await withTenant(
      this.db,
      eaccContext(principal.subject),
      async (tx) => ({
        cases: await tx
          .select({ tenant: copilotCaseFacts.tenant, count: count() })
          .from(copilotCaseFacts)
          .where(and(eq(copilotCaseFacts.fy, fy), isNotNull(copilotCaseFacts.firstReadyAt)))
          .groupBy(copilotCaseFacts.tenant),
        ratings: await tx
          .select({
            tenant: aiFeedbackFacts.tenant,
            task: aiFeedbackFacts.task,
            rating: aiFeedbackFacts.rating,
            reason: aiFeedbackFacts.reason,
            count: count(),
          })
          .from(aiFeedbackFacts)
          .where(eq(aiFeedbackFacts.fy, fy))
          .groupBy(
            aiFeedbackFacts.tenant,
            aiFeedbackFacts.task,
            aiFeedbackFacts.rating,
            aiFeedbackFacts.reason,
          ),
      }),
    );

    const commissions = new Map<string, AiUsageCommission>();
    const commission = (tenant: string) => {
      let found = commissions.get(tenant);
      if (!found) {
        found = { tenant, aiAssistedCases: 0, ratings: [] };
        commissions.set(tenant, found);
      }
      return found;
    };
    for (const row of cases) commission(row.tenant).aiAssistedCases = row.count;
    for (const row of ratings) {
      const { ratings: tasks } = commission(row.tenant);
      let task = tasks.find((each) => each.task === row.task);
      if (!task) {
        task = { task: row.task, helpful: 0, notHelpful: 0, reasons: noReasons() };
        tasks.push(task);
      }
      if (row.rating === 'helpful') task.helpful += row.count;
      else task.notHelpful += row.count;
      if (row.reason !== null && row.reason in task.reasons) {
        task.reasons[row.reason as AiFeedbackReason] += row.count;
      }
    }
    return {
      fy,
      commissions: [...commissions.values()]
        .sort((a, b) => a.tenant.localeCompare(b.tenant))
        .map((each) => ({
          ...each,
          ratings: each.ratings.sort((a, b) => a.task.localeCompare(b.task)),
        })),
    };
  }
}

function noReasons(): Record<AiFeedbackReason, number> {
  return Object.fromEntries(AI_FEEDBACK_REASONS.map((reason) => [reason, 0])) as Record<
    AiFeedbackReason,
    number
  >;
}
