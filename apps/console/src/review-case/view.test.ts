import { describe, expect, it } from 'vitest';

import { caseData, caseItem, ME, WAFULA } from './fixtures';
import { caseSearch, tabCount } from './tabs';
import {
  assignmentActions,
  holdsCase,
  readOnlyNote,
  separationCue,
  timelineIcon,
  versionNote,
  windowLine,
} from './view';

const reviewer = { subject: ME.subject, supervisor: false };
const supervisor = { subject: ME.subject, supervisor: true };

describe('windowLine', () => {
  const now = Date.parse('2026-10-02T09:00:00Z');

  it('counts the days left, amber from three weeks', () => {
    expect(windowLine('2027-03-21T13:05:00Z', now)).toEqual({
      text: 'Clarification window closes 21 Mar 2027 · 170 days left',
      open: true,
      closing: false,
    });
    expect(windowLine('2026-10-18T13:05:00Z', now)).toMatchObject({
      text: 'Clarification window closes 18 Oct 2026 · 16 days left',
      closing: true,
    });
    expect(windowLine('2026-10-02T20:00:00Z', now).text).toBe(
      'Clarification window closes 2 Oct 2026 · today',
    );
  });

  it('says when it closed', () => {
    expect(windowLine('2026-09-30T13:05:00Z', now)).toEqual({
      text: 'Clarification window closed 30 Sep 2026',
      open: false,
      closing: false,
    });
  });
});

describe('assignmentActions', () => {
  it.each([
    ['a reviewer, nobody holds it', null, reviewer, ['claim']],
    ['a reviewer holding it', ME, reviewer, ['release']],
    ['a reviewer, another holds it', WAFULA, reviewer, []],
    ['a supervisor, nobody holds it', null, supervisor, ['claim', 'assign']],
    ['a supervisor holding it', ME, supervisor, ['release', 'reassign', 'unassign']],
    ['a supervisor, another holds it', WAFULA, supervisor, ['reassign', 'unassign']],
  ] as const)('%s', (_name, assignee, viewer, actions) => {
    expect(assignmentActions(caseItem({ assignee }), viewer)).toEqual(actions);
  });

  it('offers nothing on a determined case', () => {
    expect(assignmentActions(caseItem({ status: 'determined', assignee: ME }), supervisor)).toEqual(
      [],
    );
  });
});

describe('who may act', () => {
  it('reads only for a reviewer when someone else holds the case', () => {
    expect(readOnlyNote(caseItem({ assignee: WAFULA }), reviewer)).toBe(
      'Read-only. Wafula Barasa holds this case.',
    );
    expect(readOnlyNote(caseItem({ assignee: null }), reviewer)).toBeNull();
    expect(readOnlyNote(caseItem({ assignee: ME }), reviewer)).toBeNull();
    expect(readOnlyNote(caseItem({ assignee: WAFULA }), supervisor)).toBeNull();
    expect(holdsCase(caseItem({ assignee: ME }), reviewer)).toBe(true);
    expect(holdsCase(caseItem({ assignee: WAFULA }), supervisor)).toBe(false);
  });

  it('cues a supervisor who held the case that another must approve', () => {
    expect(separationCue({ reviewerHistory: [ME] }, supervisor)).toBe(true);
    expect(separationCue({ reviewerHistory: [ME] }, reviewer)).toBe(false);
    expect(separationCue({ reviewerHistory: [WAFULA] }, supervisor)).toBe(false);
  });
});

describe('versionNote', () => {
  it('explains an amended case, and nothing for a first version', () => {
    expect(versionNote(caseData())).toBeNull();
    const amended = caseData({
      case: caseItem({ currentVersion: 2 }),
      versions: [
        ...caseData().versions,
        {
          versionId: 'v2',
          amendment: true,
          version: 2,
          submittedAt: '2026-09-25T10:00:00Z',
          late: false,
        },
      ],
    });
    expect(versionNote(amended)).toBe(
      'Amended 25 Sep 2026. Indicators were recomputed against version 1; reviewed indicators kept their notes.',
    );
  });
});

describe('timelineIcon', () => {
  it('tints known events and gives a plain mark to one this console does not know', () => {
    expect(timelineIcon('flag-reviewed').tone).toBe('success');
    expect(timelineIcon('clarification-overdue').tone).toBe('destructive');
    expect(timelineIcon('something-new').tone).toBe('default');
  });
});

describe('tabs', () => {
  it('reads the tab from the address, falling back to Flags', () => {
    expect(caseSearch.parse({ tab: 'notes' })).toEqual({ tab: 'notes' });
    expect(caseSearch.parse({ tab: 'nonsense' })).toEqual({ tab: undefined });
    expect(caseSearch.parse({})).toEqual({});
  });

  it('counts open flags, clarifications and notes; the timeline has no count', () => {
    const data = caseData();
    expect(tabCount('flags', data)).toBe(3);
    expect(tabCount('notes', data)).toBe(0);
    expect(tabCount('clarifications', data)).toBe(0);
    expect(tabCount('timeline', data)).toBeNull();
  });
});
