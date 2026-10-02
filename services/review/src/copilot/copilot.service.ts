import { HttpStatus, Injectable } from '@nestjs/common';
import { type Principal, ProblemException } from '@adili/api-kit';
import { type Database, FieldCipher, InjectDatabase, withTenant } from '@adili/data-access';

import { AiGatewayUnavailable } from '../ai-gateway/ai-gateway-client.js';
import { caseTenant, isSupervisor } from '../cases/access.js';
import { findCase } from '../cases/case-lookup.js';
import type { ReviewSchema } from '../db/schema.js';
import { DeclarationsUnavailable } from '../declarations/declarations-client.js';
import { declarationsUnavailable } from '../internal-api/upstream.js';
import { type CopilotRatingView, ratingsOf } from './copilot-feedback.js';
import { copilotOf, CopilotRequests, openOutput } from './copilot-requests.js';
import { aiGatewayUnavailable } from './problems.js';
import { systemContext } from '../system-context.js';
import type { CopilotRow, CopilotStatus } from './schema.js';

/** review.yaml `CopilotView`. */
export interface CopilotView {
  status: CopilotStatus;
  forVersionId: string | null;
  generatedAt: string | null;
  failureReason: string | null;
  /** ai-gateway `SummarizeDeclarationOutput`. */
  summary: Record<string, unknown> | null;
  /** ai-gateway `ExplainFlagsOutput`. */
  explanations: Record<string, unknown> | null;
  /** The jobs of the outputs shown, which reviewers rate. */
  jobs: { summarize: string | null; explain: string | null };
  /** The caller's own ratings of the outputs shown. */
  feedback: CopilotRatingView[];
}

/**
 * The copilot panel of a case (spec 07c): the AI-assisted summary and flag explanations, read by
 * the Commission's reviewers and supervisors (anyone else gets 404), and their refresh by the
 * assignee or a supervisor.
 */
@Injectable()
export class CopilotService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly requests: CopilotRequests,
    private readonly cipher: FieldCipher,
  ) {}

  /**
   * The copilot of the case, outputs decrypted. A case whose copilot has not been requested yet
   * (the workflow has not reached it, or the case predates the copilot) reads as `pending`.
   */
  async view(principal: Principal, caseId: string): Promise<CopilotView> {
    const tenant = caseTenant(principal);
    const { row, record, feedback } = await withTenant(
      this.db,
      { tenant, subject: principal.subject },
      async (tx) => {
        const found = await findCase(tx, tenant, caseId);
        const copilot = await copilotOf(tx, found.id);
        const shown = [copilot?.summaryJobId ?? null, copilot?.explanationsJobId ?? null];
        return {
          row: found,
          record: copilot,
          feedback: await ratingsOf(tx, principal.subject, shown),
        };
      },
    );
    if (!record) {
      return {
        status: 'pending',
        forVersionId: row.currentVersionId,
        generatedAt: null,
        failureReason: null,
        summary: null,
        explanations: null,
        jobs: { summarize: null, explain: null },
        feedback: [],
      };
    }
    return {
      status: record.status,
      forVersionId: record.generatedForVersionId ?? record.forVersionId,
      generatedAt: record.generatedAt?.toISOString() ?? null,
      failureReason: record.failureReason,
      summary: await openOutput(this.cipher, record, 'summary'),
      explanations: await openOutput(this.cipher, record, 'explanations'),
      jobs: { summarize: record.summaryJobId, explain: record.explanationsJobId },
      feedback,
    };
  }

  /**
   * Requests the copilot again (S11): the case's assignee or a supervisor of the Commission; any
   * other reviewer gets 403. 409 while the outputs of a first request are still produced (its jobs
   * are pulled first, so a copilot whose job events were lost is recorded, not stuck). A
   * copilot that was not enabled is requested again: the gateway decides whether the Commission
   * may use AI now. The declaration is read for the caller.
   */
  async refresh(principal: Principal, caseId: string): Promise<CopilotView> {
    const tenant = caseTenant(principal);
    const { row, record } = await withTenant(
      this.db,
      { tenant, subject: principal.subject },
      async (tx) => {
        const found = await findCase(tx, tenant, caseId);
        return { row: found, record: await copilotOf(tx, found.id) };
      },
    );
    if (row.assignee !== principal.subject && !isSupervisor(principal)) {
      throw new ProblemException({
        type: 'not-the-assignee',
        title: 'Forbidden',
        status: HttpStatus.FORBIDDEN,
        detail: "Only the case's assignee or a supervisor can refresh its copilot.",
      });
    }
    if (record?.status === 'pending') {
      // The jobs may have ended with their events lost: pull them before refusing.
      const settled = await this.settled(tenant, row.id);
      if (settled?.status === 'ready') return this.view(principal, row.id);
      if (settled?.status === 'pending') throw copilotPending();
    }

    try {
      await this.requests.request({
        tenant,
        caseId: row.id,
        trigger: 'refresh',
        actingSubject: principal.subject,
      });
    } catch (error) {
      if (error instanceof DeclarationsUnavailable) throw declarationsUnavailable();
      if (error instanceof AiGatewayUnavailable) throw aiGatewayUnavailable();
      throw error;
    }
    return this.view(principal, row.id);
  }

  /** The record after the latest request's ended jobs are pulled and recorded. */
  private async settled(tenant: string, caseId: string): Promise<CopilotRow | undefined> {
    try {
      await this.requests.settle(tenant, caseId);
    } catch (error) {
      if (error instanceof AiGatewayUnavailable) throw aiGatewayUnavailable();
      throw error;
    }
    return withTenant(this.db, systemContext(tenant), (tx) => copilotOf(tx, caseId));
  }
}

/** 409: the outputs of a first request are still being produced. */
function copilotPending(): ProblemException {
  return new ProblemException(
    {
      type: 'copilot-pending',
      title: 'Copilot already requested',
      status: HttpStatus.CONFLICT,
      detail: 'The summary and explanations are being prepared.',
    },
    { code: 'copilot-pending' },
  );
}
