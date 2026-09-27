import { describe, expect, it } from 'vitest';

import type { DeclarationSection } from '../../server/declarations/types';
import {
  continueLabel,
  continueTarget,
  navEntries,
  neighbours,
  progress,
  stepFromPath,
  stepLink,
  stepTitle,
} from './steps';

const SPOUSE = 'statement:spouse:5f0c2b8e-1d2a-4c3b-9e4f-5a6b7c8d9e0f';
const CHILD = 'statement:child:6a1d3c9f-2e3b-4d4c-8f5a-6b7c8d9e0f1a';
const GONE = 'statement:spouse:7b2e4d0a-3f4c-4e5d-9a6b-7c8d9e0f1a2b';

function draft(
  completeness: Partial<Record<string, DeclarationSection['completeness']>> = {},
): DeclarationSection[] {
  const names: Record<string, string> = {
    'statement:officer': 'Mwangi Njoroge Kamau',
    [SPOUSE]: 'Mary Wanjiru Kamau',
    [CHILD]: 'Tom Kamau',
    [GONE]: 'Jane Achieng',
  };
  return ['bio', 'household', 'statement:officer', SPOUSE, CHILD, GONE, 'other'].map((key) => ({
    key,
    completeness: key === GONE ? 'archived' : (completeness[key] ?? 'not-started'),
    updatedAt: null,
    personName: names[key] ?? null,
  }));
}

describe('step machine (S19)', () => {
  it('continues at the first section that is not complete, in schedule order', () => {
    expect(continueTarget(draft())).toBe('bio');
    expect(continueTarget(draft({ bio: 'complete', household: 'incomplete' }))).toBe('household');
    expect(
      continueTarget(
        draft({ bio: 'complete', household: 'complete', 'statement:officer': 'complete' }),
      ),
    ).toBe(SPOUSE);
  });

  it('skips archived statements and goes to the summary when everything is complete', () => {
    const allDone = draft({
      bio: 'complete',
      household: 'complete',
      'statement:officer': 'complete',
      [SPOUSE]: 'complete',
      [CHILD]: 'complete',
      other: 'complete',
    });
    expect(continueTarget(allDone)).toBe('summary');
    expect(continueLabel(allDone)).toBe('Go to summary');
    expect(progress(allDone)).toEqual({ percent: 100, complete: 6, total: 6, remaining: 0 });
  });

  it('labels the button Start on a fresh draft and Continue part-way', () => {
    expect(continueLabel(draft())).toBe('Start');
    expect(continueLabel(draft({ bio: 'incomplete' }))).toBe('Continue');
    expect(progress(draft({ bio: 'complete', household: 'complete' }))).toMatchObject({
      percent: 33,
      remaining: 4,
    });
  });

  it('maps steps to routes and back', () => {
    expect(stepLink('d-1', 'bio')).toEqual({ to: '/declarations/$id/bio', params: { id: 'd-1' } });
    expect(stepLink('d-1', SPOUSE)).toEqual({
      to: '/declarations/$id/statements/$personKey',
      params: { id: 'd-1', personKey: SPOUSE.slice('statement:'.length) },
    });
    expect(stepFromPath('/declarations/d-1')).toBe('overview');
    expect(stepFromPath('/declarations/d-1/')).toBe('overview');
    expect(stepFromPath('/declarations/d-1/household')).toBe('household');
    expect(stepFromPath('/declarations/d-1/statements/officer')).toBe('statement:officer');
    expect(
      stepFromPath(`/declarations/d-1/statements/${encodeURIComponent(SPOUSE.slice(10))}`),
    ).toBe(SPOUSE);
    expect(stepFromPath('/')).toBeNull();
  });

  it('names the back and next buttons after the neighbouring screens', () => {
    const sections = draft();
    expect(neighbours(sections, 'overview')).toEqual({ back: null, next: null });
    expect(neighbours(sections, 'bio')).toEqual({
      back: { step: 'overview', label: 'Overview' },
      next: { step: 'household', label: 'Next: spouses and children' },
    });
    expect(neighbours(sections, 'household').next).toEqual({
      step: 'statement:officer',
      label: 'Next: financial statements',
    });
    expect(neighbours(sections, 'statement:officer').next).toEqual({
      step: SPOUSE,
      label: "Next: Mary's statement",
    });
    expect(neighbours(sections, CHILD).next).toEqual({
      step: 'other',
      label: 'Next: other information',
    });
    expect(neighbours(sections, 'other').back).toEqual({ step: CHILD, label: "Tom's statement" });
    expect(neighbours(sections, 'summary')).toEqual({
      back: { step: 'other', label: 'Other information' },
      next: null,
    });
  });

  it('titles each screen', () => {
    const sections = draft();
    expect(stepTitle(sections, 'overview')).toBe('Your declaration');
    expect(stepTitle(sections, 'bio')).toBe('Your details');
    expect(stepTitle(sections, 'statement:officer')).toBe('Your financial statement');
    expect(stepTitle(sections, SPOUSE)).toBe("Mary's financial statement");
  });

  it('groups statements per person in the section navigation', () => {
    const entries = navEntries(draft({ bio: 'complete', 'statement:officer': 'incomplete' }));
    expect(entries.map((entry) => [entry.id, entry.status])).toEqual([
      ['bio', 'complete'],
      ['household', 'not-started'],
      ['statements', 'incomplete'],
      ['other', 'not-started'],
      ['summary', undefined],
    ]);
    expect(entries[2]?.persons).toEqual([
      { id: 'statement:officer', label: 'You', status: 'incomplete' },
      { id: SPOUSE, label: 'Mary Wanjiru Kamau', status: 'not-started' },
      { id: CHILD, label: 'Tom Kamau', status: 'not-started' },
    ]);
  });
});
