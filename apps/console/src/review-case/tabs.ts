import { z } from 'zod';

import type { CaseData } from '../server/review-case.server';
import { isOpen } from './flags';

/**
 * The review tabs beside the declaration (spec 07a FE-3: Flags · Clarifications · Notes ·
 * Timeline, with spec 07b's Registry after Flags), in order, with the count each shows. The open
 * tab is in the address (`?tab=notes`), so a link opens it and Back returns to the previous one.
 * A tab added later is one more entry here and one more panel in the case view.
 */
export const CASE_TABS = ['flags', 'registry', 'clarifications', 'notes', 'timeline'] as const;

export type CaseTab = (typeof CASE_TABS)[number];

export const CASE_TAB_LABELS: Record<CaseTab, string> = {
  flags: 'Flags',
  registry: 'Registry',
  clarifications: 'Clarifications',
  notes: 'Notes',
  timeline: 'Timeline',
};

/** The case view's search: an unknown tab falls back to Flags rather than failing the page. */
export const caseSearch = z.object({
  tab: z.enum(CASE_TABS).optional().catch(undefined),
});

export type CaseSearch = z.infer<typeof caseSearch>;

/** The number after a tab's label; null shows none (a zero shows none either). */
export function tabCount(
  tab: CaseTab,
  detail: Pick<CaseData, 'flags' | 'clarifications' | 'notes'>,
): number | null {
  switch (tab) {
    case 'flags':
      return detail.flags.filter(isOpen).length;
    case 'clarifications':
      return detail.clarifications.length;
    case 'notes':
      return detail.notes.length;
    // The Registry tab marks an unreachable registry instead (`registryNeedsAttention`).
    case 'registry':
    case 'timeline':
      return null;
  }
}
