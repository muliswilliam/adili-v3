import type { LadderStepStatus } from '@adili/ui';

import type {
  ActionStep,
  AdministrativeAction,
  Ladder,
  LadderQuery,
} from '../server/actions.server';

/**
 * The enforcement ladder as the Actions screens read it (spec 08 FE-5): where each of the four
 * steps stands, what the ladder is about, and who may decide a drafted step. Pure.
 */

export const LADDER_STEPS: readonly ActionStep[] = [
  'notice-to-comply',
  'warning',
  'salary-stoppage',
  'disciplinary-referral',
];

export interface LadderStepView {
  step: ActionStep;
  status: LadderStepStatus;
  /** The step's latest action (a restarted step's new draft), or null when not reached. */
  action: AdministrativeAction | null;
}

/** Where one action stands; `passed` when a later step has been reached. */
export function stepStatusOf(
  action: AdministrativeAction,
  passed: boolean,
  ladderStatus: Ladder['status'],
): LadderStepStatus {
  switch (action.status) {
    case 'proposed':
    case 'approved':
    case 'approved-pending-payroll':
      return ladderStatus === 'active' ? 'awaiting' : 'skipped';
    case 'issued':
    case 'responded':
      if (passed) return 'done';
      return action.step === 'salary-stoppage' ? 'stopped' : 'current';
    case 'declined':
      return 'declined';
    case 'complied':
      return 'complied';
    case 'reinstated':
      return 'reinstated';
    case 'cancelled':
      return 'skipped';
  }
}

/** The four steps of the ladder, each with its latest action and status. */
export function ladderSteps(ladder: Ladder): LadderStepView[] {
  const latest = new Map<ActionStep, AdministrativeAction>();
  for (const action of ladder.steps) {
    const known = latest.get(action.step);
    if (!known || known.proposedAt <= action.proposedAt) latest.set(action.step, action);
  }
  const reached = LADDER_STEPS.map((step) => latest.has(step));
  return LADDER_STEPS.map((step, index) => {
    const action = latest.get(step) ?? null;
    if (!action) {
      return { step, status: ladder.status === 'active' ? 'upcoming' : 'skipped', action };
    }
    const passed = reached.slice(index + 1).some(Boolean);
    return { step, status: stepStatusOf(action, passed, ladder.status), action };
  });
}

/** The step waiting for a decision, or null. */
export function pendingStep(ladder: Ladder): AdministrativeAction | null {
  if (ladder.status !== 'active') return null;
  return ladder.steps.findLast((action) => action.status === 'proposed') ?? null;
}

/** The ladder's current action: the latest one. */
export function currentAction(ladder: Ladder): AdministrativeAction | null {
  return (
    ladderSteps(ladder)
      .map((view) => view.action)
      .findLast((action) => action !== null) ?? null
  );
}

/**
 * Whether the viewer's role lets them decide a drafted step: a notice or warning by any review
 * staff, the salary stoppage and the disciplinary referral by a supervisor (spec 08 access
 * table). The service applies the separation-of-duties rule on top.
 */
export function canDecideAs(step: ActionStep, supervisor: boolean): boolean {
  return supervisor || step === 'notice-to-comply' || step === 'warning';
}

export interface LadderSubject {
  /** "Biennial declaration 2026", or the clarification's reference. */
  title: string;
  /** The title is a reference (set in mono). */
  reference: boolean;
  /** Why the ladder started. */
  cause: string;
}

const DECLARATION_KINDS: Record<string, string> = {
  initial: 'Initial declaration',
  biennial: 'Biennial declaration',
  final: 'Final declaration',
};

/** What the ladder is about: an overdue declaration (by its cycle key) or a clarification. */
export function subjectOf(ladder: Ladder): LadderSubject {
  if (ladder.subjectKind === 'clarification') {
    return { title: ladder.subjectReference, reference: true, cause: 'Clarification unanswered' };
  }
  const [kind = '', when = ''] = ladder.subjectReference.split(':');
  const name = DECLARATION_KINDS[kind];
  const title = !name
    ? ladder.subjectReference
    : kind === 'biennial' && /^\d{4}$/.test(when)
      ? `${name} ${when}`
      : name;
  return { title, reference: false, cause: 'Declaration overdue' };
}

/** The list's filters, by the current step's status. */
export const LADDER_FILTERS = [
  'all',
  'awaiting',
  'running',
  'responded',
  'complied',
  'declined',
] as const;
export type LadderFilter = (typeof LADDER_FILTERS)[number];

const FILTER_STATUS: Record<Exclude<LadderFilter, 'all'>, NonNullable<LadderQuery['status']>> = {
  awaiting: 'proposed',
  running: 'issued',
  responded: 'responded',
  complied: 'complied',
  declined: 'declined',
};

export function filterQuery(filter: LadderFilter): Pick<LadderQuery, 'status'> {
  return filter === 'all' ? {} : { status: FILTER_STATUS[filter] };
}
