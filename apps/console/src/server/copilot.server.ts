import { z } from 'zod';

import { type AiLabel, aiLabelSchema } from './ai-label';
import type { ReviewClient } from './review/client.server';
import type { CopilotFeedbackInput, CopilotStatus, CopilotView } from './review/types';
import { callService, type ServiceResult } from './service-call';

/**
 * The review service's copilot endpoints for a case (spec 07c S10, S11, S13), folded into what
 * the Copilot panel switches on. Pure: the caller injects the client (`copilot.ts` holds the
 * server functions that call these as the signed-in reviewer or supervisor).
 *
 * The contract types the two outputs loosely (the ai-gateway's `SummarizeDeclarationOutput` and
 * `ExplainFlagsOutput`); they are read here against the parts the panel shows, so the browser
 * gets typed outputs or none.
 */

const sourceRef = z.object({
  sectionKey: z.string().nullable(),
  personKey: z.string().nullable(),
  itemId: z.string().nullable(),
  fieldPath: z.string().nullable(),
});

const summaryOutput = z.object({
  label: aiLabelSchema,
  overview: z.string(),
  changesSincePrevious: z.array(z.object({ text: z.string(), refs: z.array(sourceRef) })),
  sections: z.array(
    z.object({ sectionKey: z.string(), text: z.string(), refs: z.array(sourceRef) }),
  ),
  worthAttention: z.array(z.object({ text: z.string(), flagIds: z.array(z.string()) })),
});

const explainOutput = z.object({
  label: aiLabelSchema,
  explanations: z.array(
    z.object({
      flagId: z.string(),
      meaning: z.string(),
      whatToCheck: z.array(z.string()),
      typicalResolution: z.string(),
      refs: z.array(sourceRef),
    }),
  ),
});

export type CopilotSourceRef = z.infer<typeof sourceRef>;
export type CopilotAiLabel = AiLabel;
export type CopilotSummary = z.infer<typeof summaryOutput>;
export type CopilotExplanations = z.infer<typeof explainOutput>;
export type CopilotExplanation = CopilotExplanations['explanations'][number];

/** The copilot view with its outputs read; what the panel renders. */
export interface Copilot {
  status: CopilotStatus;
  forVersionId: string | null;
  generatedAt: string | null;
  /** The ai-gateway job reason (`provider-unavailable`, `refused`, `validation`, `budget`, ...). */
  failureReason: string | null;
  summary: CopilotSummary | null;
  explanations: CopilotExplanations | null;
  jobs: { summarize: string | null; explain: string | null };
  /** The caller's own ratings, by job and block. */
  feedback: CopilotView['feedback'];
}

/**
 * Reads the view's outputs. Outputs come from the review service already validated against the
 * task schemas; one that does not read here is dropped. A ready view left with no summary reads
 * as failed validation, so the panel never shows half an output; a stale one with no summary
 * yet reads as pending.
 */
export function readCopilotView(view: CopilotView): Copilot {
  const summary = summaryOutput.safeParse(view.summary);
  const explanations = explainOutput.safeParse(view.explanations);
  const copilot: Copilot = {
    status: view.status,
    forVersionId: view.forVersionId,
    generatedAt: view.generatedAt,
    failureReason: view.failureReason,
    summary: summary.success ? summary.data : null,
    explanations: explanations.success ? explanations.data : null,
    jobs: { summarize: view.jobs.summarize, explain: view.jobs.explain },
    feedback: view.feedback,
  };
  if (copilot.summary) return copilot;
  // Stale before anything was ready (an amendment while the first jobs ran) is still preparing.
  if (view.status === 'stale') return { ...copilot, status: 'pending' };
  if (view.status === 'ready') return { ...copilot, status: 'failed', failureReason: 'validation' };
  return copilot;
}

function read(result: ServiceResult<CopilotView>): ServiceResult<Copilot> {
  return result.ok ? { ok: true, data: readCopilotView(result.data) } : result;
}

/** `GET /v1/review/cases/{caseId}/copilot`: an audited read. */
export async function loadCopilot(
  client: ReviewClient,
  caseId: string,
): Promise<ServiceResult<Copilot>> {
  return read(
    await callService(() =>
      client.GET('/v1/review/cases/{caseId}/copilot', { params: { path: { caseId } } }),
    ),
  );
}

/**
 * `POST /v1/review/cases/{caseId}/copilot/refresh` (assignee or supervisor): new jobs, the view
 * comes back pending. 409 when it is already pending or AI is not enabled; 403 for anyone else.
 */
export async function refreshCopilot(
  client: ReviewClient,
  caseId: string,
): Promise<ServiceResult<Copilot>> {
  return read(
    await callService(() =>
      client.POST('/v1/review/cases/{caseId}/copilot/refresh', { params: { path: { caseId } } }),
    ),
  );
}

/**
 * `PUT /v1/review/copilot/outputs/{jobId}/feedback`: one rating per reviewer per output block
 * (`block`: a summary block, an explanation's `flag:<id>`, or null for a whole draft).
 */
export async function rateOutput(
  client: ReviewClient,
  jobId: string,
  feedback: CopilotFeedbackInput,
): Promise<ServiceResult<null>> {
  const result = await callService(() =>
    client.PUT('/v1/review/copilot/outputs/{jobId}/feedback', {
      params: { path: { jobId } },
      body: feedback,
    }),
  );
  return result.ok ? { ok: true, data: null } : result;
}
