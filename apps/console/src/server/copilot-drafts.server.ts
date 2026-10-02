import type { AiLabelDetails } from '@adili/ui';
import { z } from 'zod';

import type { ReviewClient } from './review/client.server';
import type { CopilotDraftInput, Requirement } from './review/types';
import { callService, type ServiceResult } from './service-call';

/**
 * Draft with AI (spec 07c FE-3, S12): the review service's draft endpoints, read into what the
 * composer inserts. Pure: the caller injects the client (`copilot.ts` holds the server functions
 * that call these as the signed-in reviewer).
 *
 * The contract types the draft's label loosely (the ai-gateway's `AiLabel`); it is read here
 * field by field into the `AiLabel` badge's details, so a draft without a readable label is
 * failed, never inserted unlabelled.
 */

const aiLabel = z.object({
  task: z.string(),
  promptVersion: z.number(),
  provider: z.string(),
  model: z.string(),
  generatedAt: z.string(),
  disclaimer: z.string(),
});

const REQUIREMENTS = [
  'provide-omitted',
  'explain-discrepancy',
  'correct',
] as const satisfies readonly Requirement[];

const draftItem = z.object({
  sectionKey: z.string().nullish(),
  personKey: z.string().nullish(),
  itemId: z.string().nullish(),
  requirement: z.enum(REQUIREMENTS),
  text: z.string(),
});

const copilotDraft = z.object({
  id: z.string(),
  status: z.enum(['pending', 'ready', 'failed']),
  jobId: z.string().nullable(),
  label: z.unknown(),
  opening: z.string().nullable(),
  items: z.array(draftItem),
  failureReason: z.string().nullable(),
});

/** A drafted item, in review.yaml's `ClarificationItemInput` shape. */
export type DraftedItem = z.infer<typeof draftItem>;

/** What Draft with AI got back. */
export type AiDraft =
  | { status: 'pending'; id: string }
  | {
      status: 'ready';
      id: string;
      /** The drafting job, kept with each inserted item so it stays labelled (ADR-007). */
      jobId: string | null;
      label: AiLabelDetails;
      opening: string | null;
      items: DraftedItem[];
    }
  | { status: 'failed'; id: string; reason: string };

/** Reads a `CopilotDraft`; a ready one without a label or items reads as failed validation. */
export function readDraft(body: unknown): AiDraft | null {
  const parsed = copilotDraft.safeParse(body);
  if (!parsed.success) return null;
  const draft = parsed.data;
  if (draft.status === 'pending') return { status: 'pending', id: draft.id };
  if (draft.status === 'failed') {
    return { status: 'failed', id: draft.id, reason: draft.failureReason ?? 'unknown' };
  }
  const label = aiLabel.safeParse(draft.label);
  if (!label.success || draft.items.length === 0) {
    return { status: 'failed', id: draft.id, reason: 'validation' };
  }
  const { task, promptVersion, provider, model, generatedAt, disclaimer } = label.data;
  return {
    status: 'ready',
    id: draft.id,
    jobId: draft.jobId,
    label: { task, promptVersion, provider, model, generatedAt, disclaimer },
    opening: draft.opening?.trim() ? draft.opening : null,
    items: draft.items,
  };
}

function read(result: ServiceResult<unknown>): ServiceResult<AiDraft> {
  if (!result.ok) return result;
  const draft = readDraft(result.data);
  return draft
    ? { ok: true, data: draft }
    : { ok: false, error: { kind: 'unavailable', detail: 'Unreadable draft' } };
}

/**
 * `POST /v1/review/cases/{caseId}/copilot/drafts` (assignee): waits up to 10 s for the draft,
 * else answers it pending. `key` is the Idempotency-Key: a retry with it answers the same draft.
 */
export async function requestDraft(
  client: ReviewClient,
  caseId: string,
  input: CopilotDraftInput,
  key: string,
): Promise<ServiceResult<AiDraft>> {
  return read(
    await callService(() =>
      client.POST('/v1/review/cases/{caseId}/copilot/drafts', {
        params: { path: { caseId }, header: { 'Idempotency-Key': key } },
        body: input,
      }),
    ),
  );
}

/** `GET /v1/review/copilot/drafts/{draftId}`: a pending draft, polled by whoever asked for it. */
export async function pollDraft(
  client: ReviewClient,
  draftId: string,
): Promise<ServiceResult<AiDraft>> {
  return read(
    await callService(() =>
      client.GET('/v1/review/copilot/drafts/{draftId}', { params: { path: { draftId } } }),
    ),
  );
}
