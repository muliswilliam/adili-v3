import { useEffect, useState } from 'react';

import { getSummaryHints } from '../../server/assistant';
import type { CompletenessHints, CompletenessIssue } from '../../server/declarations/types';

/**
 * The AI-assisted hints for the summary's residuals (spec 11 S5), read after the summary shows:
 * the service may wait up to 10 s for the ai-gateway, and the deterministic text never waits for
 * it. While the gateway is still writing (`pending`) it is asked again a few times; without AI
 * (or when the hints cannot be read) there are none and the summary is as it was.
 */
export type SummaryHints =
  | { status: 'loading' }
  | {
      status: 'ready';
      label: NonNullable<CompletenessHints['label']>;
      byResidual: Map<string, string>;
    }
  | { status: 'none' };

/** How long to wait before asking again while hints are `pending`, and how many times. */
export const PENDING_RETRY_MS = 3_000;
export const PENDING_RETRIES = 4;

/** Joins a hint to its residual: the summary's issues have no id. */
export function residualKey(issue: Pick<CompletenessIssue, 'sectionKey' | 'path' | 'code'>) {
  return `${issue.sectionKey}|${issue.path}|${issue.code}`;
}

export function useSummaryHints(
  declarationId: string,
  blocking: readonly CompletenessIssue[],
): SummaryHints {
  // A new residual set (an edit elsewhere, a 400 from submit) asks again; the same one does not.
  const key = blocking.map(residualKey).join('\n');
  const [found, setFound] = useState<{ key: string; hints: SummaryHints } | null>(null);

  useEffect(() => {
    if (key === '') return;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (hints: SummaryHints) => {
      if (current) setFound({ key, hints });
    };
    const ask = (retriesLeft: number) => {
      getSummaryHints({ data: { declarationId, language: 'en' } })
        .then((result) => {
          if (!current) return;
          if (result.status !== 'ok') {
            settle({ status: 'none' });
            return;
          }
          const { hints } = result;
          if (hints.status === 'pending' && retriesLeft > 0) {
            timer = setTimeout(() => {
              ask(retriesLeft - 1);
            }, PENDING_RETRY_MS);
            return;
          }
          const byResidual = new Map(
            hints.residuals.flatMap((residual) =>
              residual.hint ? [[residualKey(residual), residual.hint] as const] : [],
            ),
          );
          settle(
            hints.status === 'ready' && hints.label && byResidual.size > 0
              ? { status: 'ready', label: hints.label, byResidual }
              : { status: 'none' },
          );
        })
        .catch(() => {
          settle({ status: 'none' });
        });
    };
    ask(PENDING_RETRIES);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [declarationId, key]);

  if (key === '') return { status: 'none' };
  return found?.key === key ? found.hints : { status: 'loading' };
}
