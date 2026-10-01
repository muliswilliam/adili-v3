/**
 * What a scorer returns for one case. A hard scorer guards a safety property and must score 1 on
 * every case; a soft scorer is averaged over a task's cases and compared with a threshold.
 */
export interface Score {
  scorer: string;
  hard: boolean;
  /** 0 to 1. */
  score: number;
  /** Why the score is below 1, quoting the offending text so a reviewer can find it. */
  failures: string[];
}

/** A score from the checks a scorer made: the share that passed, and the ones that did not. */
export function fromChecks(
  scorer: string,
  hard: boolean,
  checks: readonly { ok: boolean; failure: string }[],
): Score {
  const failures = checks.filter((check) => !check.ok).map((check) => check.failure);
  // Nothing to check passes: a summary of a first declaration has no changes to cover.
  const score = checks.length === 0 ? 1 : (checks.length - failures.length) / checks.length;
  return { scorer, hard, score, failures };
}

export interface CaseResult {
  caseName: string;
  scores: Score[];
}

export interface SoftResult {
  scorer: string;
  mean: number;
  threshold: number;
  passed: boolean;
}

/** Mean of each soft scorer over the cases, against its threshold; a missing threshold is 1. */
export function softResults(
  results: readonly CaseResult[],
  thresholds: Readonly<Record<string, number>>,
): SoftResult[] {
  const byScorer = new Map<string, number[]>();
  for (const { scores } of results) {
    for (const score of scores.filter((each) => !each.hard)) {
      byScorer.set(score.scorer, [...(byScorer.get(score.scorer) ?? []), score.score]);
    }
  }
  return [...byScorer].map(([scorer, values]) => {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const threshold = thresholds[scorer] ?? 1;
    return { scorer, mean, threshold, passed: mean >= threshold };
  });
}
