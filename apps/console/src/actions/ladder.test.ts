import { describe, expect, it } from 'vitest';

import type { AdministrativeAction, Ladder } from '../server/actions.server';
import {
  canDecideAs,
  filterQuery,
  ladderSteps,
  pendingStep,
  subjectOf,
  stepStatusOf,
} from './ladder';

function action(overrides: Partial<AdministrativeAction>): AdministrativeAction {
  return {
    id: crypto.randomUUID(),
    ladderId: 'l',
    step: 'notice-to-comply',
    status: 'proposed',
    proposerKind: 'system',
    proposer: null,
    proposedAt: '2026-09-01T09:00:00Z',
    approver: null,
    approvedAt: null,
    declinedBy: null,
    declinedAt: null,
    declineNote: null,
    issuedAt: null,
    windowEndsAt: null,
    reference: null,
    letter: null,
    response: null,
    payrollStop: null,
    payrollResume: null,
    ...overrides,
  };
}

function ladder(steps: AdministrativeAction[], overrides: Partial<Ladder> = {}): Ladder {
  return {
    id: 'l',
    subjectKind: 'obligation',
    subjectId: 's',
    subjectReference: 'biennial:2026',
    declarantName: 'Nancy Wairimu Muriuki',
    personnelFileNumber: '20260318',
    status: 'active',
    closingCause: null,
    currentStep: steps.at(-1)?.step ?? null,
    steps,
    startedAt: '2026-09-01T09:00:00Z',
    endedAt: null,
    ...overrides,
  };
}

describe('ladderSteps', () => {
  it('a drafted notice awaits approval and the later steps are not started', () => {
    const steps = ladderSteps(ladder([action({})]));
    expect(steps.map((s) => [s.step, s.status])).toEqual([
      ['notice-to-comply', 'awaiting'],
      ['warning', 'upcoming'],
      ['salary-stoppage', 'upcoming'],
      ['disciplinary-referral', 'upcoming'],
    ]);
  });

  it('an issued notice runs until the warning is drafted, then reads done', () => {
    const notice = action({ status: 'issued' });
    expect(ladderSteps(ladder([notice]))[0]?.status).toBe('current');
    const responded = action({ status: 'responded' });
    expect(ladderSteps(ladder([responded]))[0]?.status).toBe('current');
    const withWarning = ladderSteps(ladder([notice, action({ step: 'warning' })]));
    expect(withWarning.map((s) => s.status)).toEqual(['done', 'awaiting', 'upcoming', 'upcoming']);
  });

  it('a declined ladder declines the step and does not need the rest', () => {
    const steps = ladderSteps(
      ladder([action({ status: 'declined' })], { status: 'declined', currentStep: null }),
    );
    expect(steps.map((s) => s.status)).toEqual(['declined', 'skipped', 'skipped', 'skipped']);
  });

  it('after a restart the step shows its latest draft', () => {
    const steps = ladderSteps(
      ladder([action({ status: 'declined' }), action({ proposedAt: '2026-09-10T09:00:00Z' })]),
    );
    expect(steps[0]?.status).toBe('awaiting');
  });

  it('a complied ladder marks the step complied; a withdrawn subject leaves it not needed', () => {
    expect(
      ladderSteps(ladder([action({ status: 'complied' })], { status: 'complied' })).map(
        (s) => s.status,
      ),
    ).toEqual(['complied', 'skipped', 'skipped', 'skipped']);
    expect(
      ladderSteps(ladder([action({ status: 'cancelled' })], { status: 'ended' }))[0]?.status,
    ).toBe('skipped');
  });

  it('a salary stoppage in force reads stopped, a reinstated one reinstated', () => {
    const notice = action({ status: 'issued' });
    const warning = action({ step: 'warning', status: 'issued' });
    expect(
      ladderSteps(
        ladder([notice, warning, action({ step: 'salary-stoppage', status: 'issued' })]),
      )[2]?.status,
    ).toBe('stopped');
    expect(
      ladderSteps(
        ladder([notice, warning, action({ step: 'salary-stoppage', status: 'reinstated' })]),
      )[2]?.status,
    ).toBe('reinstated');
    expect(stepStatusOf(action({ status: 'approved-pending-payroll' }), false, 'active')).toBe(
      'awaiting',
    );
  });
});

describe('pendingStep', () => {
  it('is the step waiting for a decision, if any', () => {
    const draft = action({ step: 'warning' });
    expect(pendingStep(ladder([action({ status: 'issued' }), draft]))?.id).toBe(draft.id);
    expect(pendingStep(ladder([action({ status: 'issued' })]))).toBeNull();
  });
});

describe('canDecideAs', () => {
  it('lets review staff decide a notice or warning, supervisors alone the later steps', () => {
    expect(canDecideAs('notice-to-comply', false)).toBe(true);
    expect(canDecideAs('warning', false)).toBe(true);
    expect(canDecideAs('salary-stoppage', false)).toBe(false);
    expect(canDecideAs('disciplinary-referral', true)).toBe(true);
  });
});

describe('subjectOf', () => {
  it('names an overdue declaration by its cycle', () => {
    expect(subjectOf(ladder([]))).toEqual({
      title: 'Biennial declaration 2026',
      reference: false,
      cause: 'Declaration overdue',
    });
    expect(subjectOf(ladder([], { subjectReference: 'initial:2026-09-07' })).title).toBe(
      'Initial declaration',
    );
    expect(subjectOf(ladder([], { subjectReference: 'final:2026-08-31' })).title).toBe(
      'Final declaration',
    );
  });

  it('names an unanswered clarification by its CLR reference', () => {
    expect(
      subjectOf(
        ladder([], { subjectKind: 'clarification', subjectReference: 'CLR-TSC-2026-0000318-5' }),
      ),
    ).toEqual({
      title: 'CLR-TSC-2026-0000318-5',
      reference: true,
      cause: 'Clarification unanswered',
    });
  });
});

describe('filterQuery', () => {
  it('maps each chip to the current step status it lists', () => {
    expect(filterQuery('all')).toEqual({});
    expect(filterQuery('awaiting')).toEqual({ status: 'proposed' });
    expect(filterQuery('running')).toEqual({ status: 'issued' });
    expect(filterQuery('responded')).toEqual({ status: 'responded' });
    expect(filterQuery('complied')).toEqual({ status: 'complied' });
    expect(filterQuery('declined')).toEqual({ status: 'declined' });
  });
});
