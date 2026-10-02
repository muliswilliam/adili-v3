import { HttpStatus, Injectable } from '@nestjs/common';
import { type Principal, ProblemException } from '@adili/api-kit';
import { type Database, FieldCipher, InjectDatabase, withTenant } from '@adili/data-access';

import { AiGatewayUnavailable } from '../ai-gateway/ai-gateway-client.js';
import { caseTenant, isSupervisor } from '../cases/access.js';
import { findCase } from '../cases/case-lookup.js';
import type { ReviewSchema } from '../db/schema.js';
import { DeclarationsUnavailable } from '../declarations/declarations-client.js';
import { declarationsUnavailable, upstreamUnavailable } from '../internal-api/upstream.js';
import { type CopilotRatingView, ratingsOf } from './copilot-feedback.js';
import { copilotOf, copilotOutputRecordId, CopilotRequests } from './copilot-requests.js';
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
      summary: await this.open(tenant, record, 'summary'),
      explanations: await this.open(tenant, record, 'explanations'),
      jobs: { summarize: record.summaryJobId, explain: record.explanationsJobId },
      feedback,
    };
  }

  /**
   * Requests the copilot again (S11): the case's assignee or a supervisor of the Commission; any
   * other reviewer gets 403. 409 while the outputs of a first request are still produced, and
   * when AI assistance is not enabled for the Commission. The declaration is read for the caller.
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
      throw new ProblemException(
        {
          type: 'copilot-pending',
          title: 'Copilot already requested',
          status: HttpStatus.CONFLICT,
          detail: 'The summary and explanations are being prepared.',
        },
        { code: 'copilot-pending' },
      );
    }
    if (record?.status === 'not-enabled') {
      throw new ProblemException(
        {
          type: 'ai-not-enabled',
          title: 'AI assistance not enabled',
          status: HttpStatus.CONFLICT,
          detail: 'AI assistance is not enabled for this Commission.',
        },
        { code: 'ai-not-enabled' },
      );
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
      if (error instanceof AiGatewayUnavailable) {
        throw upstreamUnavailable(
          'ai-gateway',
          'The AI gateway cannot be reached. Try again shortly.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      throw error;
    }
    return this.view(principal, row.id);
  }

  private async open(
    tenant: string,
    record: CopilotRow,
    output: 'summary' | 'explanations',
  ): Promise<Record<string, unknown> | null> {
    const [jobId, ciphertext, envelope] =
      output === 'summary'
        ? [record.summaryJobId, record.summaryCiphertext, record.summaryEnvelope]
        : [record.explanationsJobId, record.explanationsCiphertext, record.explanationsEnvelope];
    if (jobId === null || ciphertext === null || envelope === null) return null;
    const plaintext = await this.cipher.decrypt({
      tenant,
      recordId: copilotOutputRecordId(record.caseId, jobId),
      ciphertext,
      envelope,
    });
    return JSON.parse(plaintext.toString('utf8')) as Record<string, unknown>;
  }
}
