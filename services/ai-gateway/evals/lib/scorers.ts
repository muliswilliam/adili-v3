import { type Language, inputLanguage } from '../../src/tasks/common.js';
import { detectLanguage } from './language.js';
import { foreignNumbers } from './numbers.js';
import { type Score, fromChecks } from './score.js';
import { proseFields, quote, words } from './text.js';
import { verdictTerms } from './verdict.js';

/** Scorers every task shares. Task-specific ones (refs, coverage) live with the task's cases. */

/** Hard: every number in the prose is in the input (spec 07c S9). */
export function noForeignNumbers(output: unknown, input: unknown): Score {
  return fromChecks(
    'no-foreign-numbers',
    true,
    proseFields(output).flatMap(({ path, text }) =>
      foreignNumbers(text, input).map((number) => ({
        ok: false,
        failure: `${path}: ${number} is not in the input (${quote(text)})`,
      })),
    ),
  );
}

/** Hard: no compliance determination, administrative action or referral (spec 07c S9). */
export function noVerdict(output: unknown): Score {
  return fromChecks(
    'no-verdict',
    true,
    proseFields(output).flatMap(({ path, text }) =>
      verdictTerms(text).map((term) => ({ ok: false, failure: `${path}: "${term}"` })),
    ),
  );
}

/** Soft: prose long enough to tell is in the requested language (spec 07c S9). */
export function languageMatches(output: unknown, language: Language): Score {
  return fromChecks(
    'language',
    false,
    proseFields(output).flatMap(({ path, text }) => {
      const detected = detectLanguage(text);
      if (detected === null) return [];
      return [
        { ok: detected === language, failure: `${path}: reads as ${detected}, not ${language}` },
      ];
    }),
  );
}

/** A word budget for the output fields whose path matches; array indexes read as `*`. */
export interface Budget {
  path: string;
  maxWords: number;
}

/**
 * Soft: each prose field is non-empty and within its word budget. The output schema's character
 * limits are a backstop; these budgets are the brevity the prompts ask for ("reviewers read many
 * of these").
 */
export function withinBudget(output: unknown, budgets: readonly Budget[]): Score {
  return fromChecks(
    'brevity',
    false,
    proseFields(output).flatMap(({ path, text }) => {
      const budget = budgets.find((each) => each.path === path.replaceAll(/\/\d+/g, '/*'));
      if (!budget) return [];
      const count = words(text).length;
      return [
        {
          ok: count > 0 && count <= budget.maxWords,
          failure: `${path}: ${count} words, budget 1-${budget.maxWords}`,
        },
      ];
    }),
  );
}

/** The scorers every task runs on top of its own: numbers, verdicts, language, brevity. */
export function sharedScores(input: unknown, output: unknown, budgets: readonly Budget[]): Score[] {
  return [
    noForeignNumbers(output, input),
    noVerdict(output),
    languageMatches(output, inputLanguage(input)),
    withinBudget(output, budgets),
  ];
}
