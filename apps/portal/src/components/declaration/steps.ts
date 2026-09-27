import type { SectionStatus } from '@adili/ui';

import type { DeclarationSection, SectionKey } from '../../server/declarations/types';

/**
 * The workspace's step machine: which screens exist for a draft, in First Schedule order, where
 * Continue goes, and what the back and next buttons say. Pure, so the routes, the section
 * navigation and the overview all agree.
 */

/**
 * A workspace screen: `overview`, a section key (`bio`, `household`, `statement:<person>`,
 * `other`) or `summary`. Section keys are plain strings in the contract.
 */
export type Step = SectionKey;

export type SectionKind = 'bio' | 'household' | 'statement' | 'other';

export function sectionKind(key: SectionKey): SectionKind {
  if (key === 'bio' || key === 'household' || key === 'other') return key;
  return 'statement';
}

/** `statement:spouse:<uuid>` -> `spouse:<uuid>`; null for other sections. */
export function personKeyOf(key: SectionKey): string | null {
  return key.startsWith('statement:') ? key.slice('statement:'.length) : null;
}

/** Sections the declarant works on: everything except archived statements. */
export function liveSections(sections: DeclarationSection[]): DeclarationSection[] {
  return sections.filter((section) => section.completeness !== 'archived');
}

/** Every screen in order: overview, the live sections, summary. */
export function workspaceSteps(sections: DeclarationSection[]): Step[] {
  return ['overview', ...liveSections(sections).map((section) => section.key), 'summary'];
}

/** S19: Continue opens the first live section that is not complete, else the summary. */
export function continueTarget(sections: DeclarationSection[]): Step {
  return (
    liveSections(sections).find((section) => section.completeness !== 'complete')?.key ?? 'summary'
  );
}

export interface Progress {
  percent: number;
  complete: number;
  total: number;
  /** Live sections not yet complete. */
  remaining: number;
}

export function progress(sections: DeclarationSection[]): Progress {
  const live = liveSections(sections);
  const complete = live.filter((section) => section.completeness === 'complete').length;
  const total = live.length;
  return {
    percent: total === 0 ? 0 : Math.round((complete / total) * 100),
    complete,
    total,
    remaining: total - complete,
  };
}

/** The overview's main button: Start on a fresh draft, Go to summary when all is complete. */
export function continueLabel(sections: DeclarationSection[]): string {
  const live = liveSections(sections);
  if (live.every((section) => section.completeness === 'not-started')) return 'Start';
  return continueTarget(sections) === 'summary' ? 'Go to summary' : 'Continue';
}

/** Where a step lives, as TanStack Router `to` and `params`. */
export type StepLink =
  | { to: '/declarations/$id'; params: { id: string } }
  | { to: '/declarations/$id/bio'; params: { id: string } }
  | { to: '/declarations/$id/household'; params: { id: string } }
  | { to: '/declarations/$id/other'; params: { id: string } }
  | { to: '/declarations/$id/summary'; params: { id: string } }
  | { to: '/declarations/$id/statements/$personKey'; params: { id: string; personKey: string } };

export function stepLink(declarationId: string, step: Step): StepLink {
  const params = { id: declarationId };
  switch (step) {
    case 'overview':
      return { to: '/declarations/$id', params };
    case 'summary':
      return { to: '/declarations/$id/summary', params };
    case 'bio':
      return { to: '/declarations/$id/bio', params };
    case 'household':
      return { to: '/declarations/$id/household', params };
    case 'other':
      return { to: '/declarations/$id/other', params };
    default:
      return {
        to: '/declarations/$id/statements/$personKey',
        params: { ...params, personKey: personKeyOf(step) ?? 'officer' },
      };
  }
}

/** The step a workspace URL shows, or null outside the workspace. */
export function stepFromPath(pathname: string): Step | null {
  const match = /^\/declarations\/[^/]+(?:\/(.*?))?\/?$/.exec(pathname);
  if (!match) return null;
  const rest = match[1] ? decodeURIComponent(match[1]) : '';
  if (rest === '') return 'overview';
  if (['bio', 'household', 'other', 'summary'].includes(rest)) return rest;
  const person = /^statements\/(.+)$/.exec(rest)?.[1];
  return person ? `statement:${person}` : null;
}

function section(sections: DeclarationSection[], key: SectionKey) {
  return sections.find((candidate) => candidate.key === key);
}

function firstName(fullName: string | null | undefined) {
  return fullName?.trim().split(/\s+/)[0] ?? '';
}

/** "You" for the officer, else the person's name. */
export function personLabel(sections: DeclarationSection[], key: SectionKey): string {
  if (key === 'statement:officer') return 'You';
  return section(sections, key)?.personName ?? 'Unnamed person';
}

/** The relationship shown next to a person, from their statement key. */
export function relationship(key: SectionKey): 'Spouse' | 'Child' | null {
  if (key.startsWith('statement:spouse:')) return 'Spouse';
  if (key.startsWith('statement:child:')) return 'Child';
  return null;
}

const TITLES = {
  overview: 'Your declaration',
  bio: 'Your details',
  household: 'Spouses and children',
  other: 'Other information',
  summary: 'Summary',
} as const;

/** The screen's heading. */
export function stepTitle(sections: DeclarationSection[], step: Step): string {
  if (step in TITLES) return TITLES[step as keyof typeof TITLES];
  if (step === 'statement:officer') return 'Your financial statement';
  const name = firstName(section(sections, step)?.personName);
  return name ? `${name}'s financial statement` : 'Financial statement';
}

/** Short name for a back button. */
function backLabel(sections: DeclarationSection[], step: Step): string {
  if (step === 'overview') return 'Overview';
  if (step === 'statement:officer') return 'Your statement';
  if (sectionKindOf(step) === 'statement') {
    const name = firstName(section(sections, step)?.personName);
    return name ? `${name}'s statement` : 'Financial statement';
  }
  return TITLES[step as keyof typeof TITLES];
}

/** Label for a next button, e.g. "Next: spouses and children". */
function nextLabel(sections: DeclarationSection[], from: Step, step: Step): string {
  if (step === 'statement:officer') return 'Next: financial statements';
  if (sectionKindOf(step) === 'statement') {
    const name = firstName(section(sections, step)?.personName);
    return name ? `Next: ${name}'s statement` : 'Next: financial statement';
  }
  if (step === 'overview') return 'Overview';
  const title = TITLES[step as keyof typeof TITLES];
  return from === 'overview' ? title : `Next: ${title.toLowerCase()}`;
}

function sectionKindOf(step: Step): SectionKind | null {
  return step === 'overview' || step === 'summary' ? null : sectionKind(step);
}

export interface Neighbour {
  step: Step;
  label: string;
}

/** The back and next buttons under a screen. The overview has neither; the summary has no next. */
export function neighbours(
  sections: DeclarationSection[],
  current: Step,
): { back: Neighbour | null; next: Neighbour | null } {
  if (current === 'overview') return { back: null, next: null };
  const steps = workspaceSteps(sections);
  const index = steps.indexOf(current);
  if (index === -1) return { back: null, next: null };
  const before = steps[index - 1];
  const after = steps[index + 1];
  return {
    back: before ? { step: before, label: backLabel(sections, before) } : null,
    next: after ? { step: after, label: nextLabel(sections, current, after) } : null,
  };
}

/** Section navigation model: financial statements are grouped with one entry per person. */
export interface NavEntry {
  id: string;
  label: string;
  status?: SectionStatus;
  hint?: string;
  persons?: { id: SectionKey; label: string; status: SectionStatus }[];
}

function statusOf(completeness: DeclarationSection['completeness']): SectionStatus {
  return completeness === 'archived' ? 'not-started' : completeness;
}

/** The id the section navigation uses for the statements group. */
export const STATEMENTS_GROUP = 'statements';

export function navEntries(sections: DeclarationSection[]): NavEntry[] {
  const live = liveSections(sections);
  const statements = live.filter((entry) => sectionKind(entry.key) === 'statement');
  const groupStatus: SectionStatus = statements.every((entry) => entry.completeness === 'complete')
    ? 'complete'
    : statements.some((entry) => entry.completeness !== 'not-started')
      ? 'incomplete'
      : 'not-started';
  const plain = (key: 'bio' | 'household' | 'other'): NavEntry => ({
    id: key,
    label: TITLES[key],
    status: statusOf(section(sections, key)?.completeness ?? 'not-started'),
  });
  return [
    plain('bio'),
    plain('household'),
    {
      id: STATEMENTS_GROUP,
      label: 'Financial statements',
      status: groupStatus,
      persons: statements.map((entry) => ({
        id: entry.key,
        label: personLabel(sections, entry.key),
        status: statusOf(entry.completeness),
      })),
    },
    plain('other'),
    { id: 'summary', label: TITLES.summary, hint: 'Check and submit' },
  ];
}

/** The step a navigation entry opens; the statements group opens the officer's statement. */
export function stepForNavEntry(id: string): Step {
  return id === STATEMENTS_GROUP ? 'statement:officer' : id;
}
