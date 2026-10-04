import type { DeclarationIssue, DeclarationSectionKey } from '@adili/forms';

import type { AnswerInput } from '../ai-gateway/ai-gateway-client.js';
import type { SectionMetadata } from '../drafts/schema.js';
import { sectionKind } from '../drafts/sections.js';
import type { CorpusTag } from '../help/corpus.js';

/**
 * What Ask Adili tells the ai-gateway about where the declarant is (spec 11 S1), pure: the
 * declaration's type and statement date, the household as counts, the section the declarant is
 * on, and what the completeness check still reports as rule ids and field paths. Nothing here can
 * carry an amount, a name, an identifier or a description: counts are numbers, rule ids and paths
 * are checked against the gateway's own patterns (schema keywords and field names, kebab-case
 * codes, indexes), and anything that does not match is left out rather than sent.
 */

export type AnswerContext = AnswerInput['context'];
export type Residual = AnswerContext['residuals'][number];

/** The most residuals a request carries (ai-gateway.yaml `residuals.maxItems`). */
export const MAX_RESIDUALS = 20;

/** ai-gateway.yaml `ruleId`: a completeness rule's code or a schema keyword. */
const RULE_ID = /^[a-z][A-Za-z0-9]*(-[a-z0-9]+)*$/;

/** ai-gateway.yaml residual `fieldPath`: field names and indexes only. */
export const FIELD_PATH = /^(\/([a-z][A-Za-z0-9]*|0|[1-9][0-9]*))*$/;

/**
 * The draft's blocking issues as residuals, the current section's first (they are what the
 * declarant is most likely asking about), at most `MAX_RESIDUALS`, one per section and path.
 */
export function residualsOf(
  issues: readonly DeclarationIssue[],
  currentSection: string | null,
): Residual[] {
  const seen = new Set<string>();
  const residuals: Residual[] = [];
  for (const issue of issues) {
    if (!RULE_ID.test(issue.code) || issue.code.length > 100) continue;
    if (!FIELD_PATH.test(issue.path) || issue.path.length > 200) continue;
    const at = `${issue.sectionKey} ${issue.path}`;
    if (seen.has(at)) continue;
    seen.add(at);
    residuals.push({ sectionKey: issue.sectionKey, ruleId: issue.code, fieldPath: issue.path });
  }
  const current = residuals.filter((residual) => residual.sectionKey === currentSection);
  const others = residuals.filter((residual) => residual.sectionKey !== currentSection);
  return [...current, ...others].slice(0, MAX_RESIDUALS);
}

/** The household as counts, from the household section's clear metadata (never its contents). */
export function householdCountsOf(
  household: Pick<SectionMetadata, 'counts'> | undefined,
): AnswerContext['householdCounts'] {
  const count = (key: string) => {
    const value = household?.counts?.[key];
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
  };
  return { spouses: count('spouses'), children: count('children') };
}

/** The tags retrieval boosts: the kind of section the declarant is on, and the item type. */
export function boostTagsOf(
  sectionKey: DeclarationSectionKey | null,
  itemType: CorpusTag | null | undefined,
): CorpusTag[] {
  const tags: CorpusTag[] = [];
  if (sectionKey) tags.push(sectionKind(sectionKey) satisfies CorpusTag);
  if (itemType) tags.push(itemType);
  return tags;
}
