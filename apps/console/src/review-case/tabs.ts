import { z } from 'zod';

import type { CaseData } from '../server/review-case.server';
import { isOpen } from './flags';

/**
 * The review tabs beside the declaration (spec 07a FE-3: Flags · Clarifications · Notes ·
 * Timeline), in order, with the count each shows. The open tab is in the address
 * (`?tab=notes`), so a link opens it and Back returns to the previous one. A tab added later
 * (spec 07b's Registry, after Flags) is one more entry here and one more panel in the case view.
 */
export const CASE_TABS = ['flags', 'clarifications', 'notes', 'timeline'] as const;

export type CaseTab = (typeof CASE_TABS)[number];

export const CASE_TAB_LABELS: Record<CaseTab, string> = {
  flags: 'Flags',
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
    case 'timeline':
      return null;
  }
}
