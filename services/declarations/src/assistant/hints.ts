import { createHash } from 'node:crypto';

import type { DeclarationIssue } from '@adili/forms';

import type { AnswerInput, AnswerOutput } from '../ai-gateway/ai-gateway-client.js';
import type { AssistantLanguage } from './schema.js';
import { type AnswerContext, asResidual, MAX_RESIDUALS, type Residual } from './context.js';

/**
 * Summary hints (spec 11 S5), pure: what the ai-gateway's hints mode is asked for a draft's
 * blocking issues, and how its answer maps back onto them. The request holds the declaration
 * type, the household as counts and the residuals (rule ids and field paths) only; no statement
 * date, no passages, and every person key replaced by its place among the residuals (the first
 * spouse or child named is `...0001`), so two declarants with the same things left to complete
 * send the same request and share its hints (`HintsPlan.hash`).
 */

/** The prompt version hints are written with; part of the cache key, so a bump writes them anew. */
export const HINTS_PROMPT_VERSION = 1;

export interface HintsPlan {
  /** The hints mode input, with persons by their place. */
  input: AnswerInput;
  /** Per blocking issue, in order, the index of its residual in `input`; null without one. */
  residualOf: (number | null)[];
  /** What the hints are cached by, with the language and prompt version: a SHA-256, hex. */
  hash: string;
}

const PERSON_KEY = /^statement:(spouse|child):[0-9a-f-]{36}$/;

/** The person in their place: `spouse:00000000-0000-4000-8000-000000000001`. */
function placeholder(kind: string, place: number): string {
  return `statement:${kind}:00000000-0000-4000-8000-${place.toString(16).padStart(12, '0')}`;
}

export function planHints(
  issues: readonly DeclarationIssue[],
  context: Pick<AnswerContext, 'declarationType' | 'householdCounts'>,
  language: AssistantLanguage,
): HintsPlan {
  const places = new Map<string, string>();
  const residuals: Residual[] = [];
  const residualOf = issues.map((issue) => {
    if (residuals.length >= MAX_RESIDUALS) return null;
    const residual = asResidual(issue);
    if (!residual) return null;
    const kind = PERSON_KEY.exec(residual.sectionKey)?.[1];
    if (kind) {
      const place = places.get(residual.sectionKey) ?? placeholder(kind, places.size + 1);
      places.set(residual.sectionKey, place);
      residual.sectionKey = place;
    }
    residuals.push(residual);
    return residuals.length - 1;
  });
  const hashed = {
    declarationType: context.declarationType,
    householdCounts: context.householdCounts,
    residuals,
  };
  return {
    input: {
      kind: 'answer-declarant-question',
      mode: 'hints',
      language,
      question: null,
      context: { ...hashed, statementDate: null, sectionKey: null },
      passages: [],
      history: [],
    },
    residualOf,
    hash: createHash('sha256').update(JSON.stringify(hashed)).digest('hex'),
  };
}

/**
 * The hints of an output, one per residual in order, each linked to its own residual (the
 * gateway checks this too; the service stores only what it checked). Null for anything else.
 */
export function hintsOf(output: AnswerOutput, input: AnswerInput): string[] | null {
  const { residuals } = input.context;
  if (output.declined || output.blocks.length !== residuals.length) return null;
  const hints = output.blocks.map((block, index) => {
    const residual = residuals[index];
    const link = block.sectionLink;
    const text = block.text.trim();
    return residual &&
      link?.sectionKey === residual.sectionKey &&
      link.fieldPath === residual.fieldPath &&
      text.length > 0
      ? text
      : null;
  });
  return hints.every((hint): hint is string => hint !== null) ? hints : null;
}

/**
 * The Idempotency-Key of a draft's hints job: the same for every load of the same request within
 * the hour, so a load while the job runs waits on it rather than starting another, and a job
 * that failed is tried again the next hour. A UUID (version 8) from a SHA-256.
 */
export function hintsJobKey(declarationId: string, plan: HintsPlan, at: Date): string {
  const hour = Math.floor(at.getTime() / 3_600_000);
  const hex = createHash('sha256')
    .update(
      [declarationId, plan.hash, plan.input.language, HINTS_PROMPT_VERSION, hour].join('\u0000'),
    )
    .digest('hex');
  const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
