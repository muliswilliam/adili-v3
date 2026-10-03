import type { SectionStatus } from '@adili/ui';

import {
  parsePersonKey,
  parseSectionKey,
  relationOf,
  type SectionKind,
  sectionKind,
  statementSectionKey,
} from '../../declaration/section-key';
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

/** Section and screen titles; every screen, the overview and the summary use these. */
export const STEP_TITLES = {
  overview: 'Your declaration',
  bio: 'Your details',
  household: 'Spouses and children',
  other: 'Other information',
  summary: 'Summary',
} as const;

/** Paragraph 8 as a whole: the navigation group and the summary card. */
export const STATEMENTS_TITLE = 'Financial statements';

/**
 * Each kind of section in one place: its number on the overview (First Schedule order), its
 * title, and the route that shows it (`segment` is the route's last path segment).
 */
export const SECTION_KINDS = {
  bio: { number: 1, title: STEP_TITLES.bio, to: '/declarations/$id/bio', segment: 'bio' },
  household: {
    number: 2,
    title: STEP_TITLES.household,
    to: '/declarations/$id/household',
    segment: 'household',
  },
  statement: {
    number: 3,
    title: STATEMENTS_TITLE,
    to: '/declarations/$id/statements/$personKey',
    segment: 'statements',
  },
  other: { number: 4, title: STEP_TITLES.other, to: '/declarations/$id/other', segment: 'other' },
} as const satisfies Record<
  SectionKind,
  { number: number; title: string; to: StepLink['to']; segment: string }
>;

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

/**
 * What the section screens read from their address (`sectionSearch`): `errors` shows every
 * missing answer at once, `field` opens and focuses one field (a JSON pointer).
 */
export interface SectionSearch {
  errors?: boolean;
  field?: string;
}

type ScreenLink = Extract<StepLink, { to: '/declarations/$id' | '/declarations/$id/summary' }>;

export type SectionLink = (Exclude<StepLink, ScreenLink> & { search: SectionSearch }) | ScreenLink;

/**
 * A link to a step that shows its errors or opens a field there; the overview and the summary
 * read neither, so their links go without.
 */
export function sectionLink(declarationId: string, step: Step, search: SectionSearch): SectionLink {
  const link = stepLink(declarationId, step);
  return link.to === '/declarations/$id' || link.to === '/declarations/$id/summary'
    ? link
    : { ...link, search };
}

/** Where a step lives; a key that is not a section's opens the overview. */
export function stepLink(declarationId: string, step: Step): StepLink {
  const params = { id: declarationId };
  if (step === 'summary') return { to: '/declarations/$id/summary', params };
  const parsed = parseSectionKey(step);
  if (!parsed) return { to: '/declarations/$id', params };
  if (parsed.kind === 'statement') {
    return {
      to: SECTION_KINDS.statement.to,
      params: { ...params, personKey: parsed.personKey },
    };
  }
  return { to: SECTION_KINDS[parsed.kind].to, params };
}

/** The step a workspace URL shows, or null outside the workspace or for an unknown screen. */
export function stepFromPath(pathname: string): Step | null {
  const match = /^\/declarations\/[^/]+(?:\/(.*?))?\/?$/.exec(pathname);
  if (!match) return null;
  const rest = match[1] ? decodeURIComponent(match[1]) : '';
  if (rest === '') return 'overview';
  if (rest === 'summary') return 'summary';
  const [segment, person, ...more] = rest.split('/');
  if (segment === SECTION_KINDS.statement.segment) {
    const personKey = person !== undefined && more.length === 0 ? parsePersonKey(person) : null;
    return personKey ? statementSectionKey(personKey) : null;
  }
  const kind = (['bio', 'household', 'other'] as const).find(
    (candidate) => SECTION_KINDS[candidate].segment === rest,
  );
  return kind ?? null;
}

function section(sections: DeclarationSection[], key: SectionKey) {
  return sections.find((candidate) => candidate.key === key);
}

function firstName(fullName: string | null | undefined) {
  return fullName?.trim().split(/\s+/)[0] ?? '';
}

/** How the declarant is named wherever people are listed. */
export const OFFICER_LABEL = 'You';

/** How a person is named in lists: "You" for the officer, else their name or "Unnamed person". */
export function nameFor(key: SectionKey, name: string | null | undefined): string {
  if (key === 'statement:officer') return OFFICER_LABEL;
  const trimmed = name?.trim();
  if (!trimmed) return 'Unnamed person';
  return trimmed;
}

/** "You" for the officer, else the person's name from their statement section. */
export function personLabel(sections: DeclarationSection[], key: SectionKey): string {
  return nameFor(key, section(sections, key)?.personName);
}

/** The relationship shown next to a person, from their statement key. */
export function relationship(key: SectionKey): 'Spouse' | 'Child' | null {
  const relation = relationOf(key);
  if (relation === 'spouse') return 'Spouse';
  if (relation === 'child') return 'Child';
  return null;
}

/** The label next to a person: "You" for the officer, "Spouse" or "Child", else empty. */
export function relationLabel(key: SectionKey): string {
  return key === 'statement:officer' ? OFFICER_LABEL : (relationship(key) ?? '');
}

/** The screen's heading. */
export function stepTitle(sections: DeclarationSection[], step: Step): string {
  if (step in STEP_TITLES) return STEP_TITLES[step as keyof typeof STEP_TITLES];
  return statementTitle(step, firstName(section(sections, step)?.personName));
}

/** "Your financial statement", "{name}'s financial statement", or "Financial statement". */
export function statementTitle(key: SectionKey, name: string): string {
  if (key === 'statement:officer') return 'Your financial statement';
  return name ? `${name}'s financial statement` : 'Financial statement';
}

/** Short name for a back button. */
function backLabel(sections: DeclarationSection[], step: Step): string {
  if (step === 'overview') return 'Overview';
  if (step === 'statement:officer') return 'Your statement';
  if (sectionKind(step) === 'statement') {
    const name = firstName(section(sections, step)?.personName);
    return name ? `${name}'s statement` : 'Financial statement';
  }
  return STEP_TITLES[step as keyof typeof STEP_TITLES];
}

/** Label for a next button, e.g. "Next: spouses and children". */
function nextLabel(sections: DeclarationSection[], from: Step, step: Step): string {
  if (step === 'statement:officer') return 'Next: financial statements';
  if (sectionKind(step) === 'statement') {
    const name = firstName(section(sections, step)?.personName);
    return name ? `Next: ${name}'s statement` : 'Next: financial statement';
  }
  if (step === 'overview') return 'Overview';
  const title = STEP_TITLES[step as keyof typeof STEP_TITLES];
  return from === 'overview' ? title : `Next: ${title.toLowerCase()}`;
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
    label: STEP_TITLES[key],
    status: statusOf(section(sections, key)?.completeness ?? 'not-started'),
  });
  return [
    plain('bio'),
    plain('household'),
    {
      id: STATEMENTS_GROUP,
      label: STATEMENTS_TITLE,
      status: groupStatus,
      persons: statements.map((entry) => ({
        id: entry.key,
        label: personLabel(sections, entry.key),
        status: statusOf(entry.completeness),
      })),
    },
    plain('other'),
    { id: 'summary', label: STEP_TITLES.summary, hint: 'Check and submit' },
  ];
}

/** The step a navigation entry opens; the statements group opens the officer's statement. */
export function stepForNavEntry(id: string): Step {
  return id === STATEMENTS_GROUP ? 'statement:officer' : id;
}
