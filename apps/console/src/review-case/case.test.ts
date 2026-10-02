import { describe, expect, it } from 'vitest';

import type { Assignee } from '../server/review/types';
import { assignableOfficers, caseActions, noteError, versionLine, windowLine } from './case';

const ME: Assignee = { subject: 'me', name: 'Faith Achieng' };
const PETER: Assignee = { subject: 'peter', name: 'Peter Mwangi' };
const MERCY: Assignee = { subject: 'mercy', name: 'Mercy Wambui' };
const NOW = Date.parse('2026-10-02T09:00:00Z');

describe('caseActions (S8)', () => {
  it('lets a reviewer claim an unassigned case, and nothing else', () => {
    expect(caseActions({ assignee: null }, ME.subject, false)).toEqual({
      mine: false,
      claim: true,
      release: false,
      reassign: null,
      unassign: false,
      reviewFlags: false,
      heldBy: null,
    });
  });

  it('lets the holder release the case and mark its flags reviewed', () => {
    expect(caseActions({ assignee: ME }, ME.subject, false)).toMatchObject({
      mine: true,
      claim: false,
      release: true,
      reassign: null,
      reviewFlags: true,
      heldBy: null,
    });
  });

  it('shows another reviewer’s case read-only', () => {
    expect(caseActions({ assignee: PETER }, ME.subject, false)).toMatchObject({
      claim: false,
      release: false,
      reviewFlags: false,
      heldBy: PETER,
    });
  });

  it('lets a supervisor reassign or unassign any case, and assign an unassigned one', () => {
    expect(caseActions({ assignee: PETER }, ME.subject, true)).toMatchObject({
      reassign: 'reassign',
      unassign: true,
      release: false,
      heldBy: null,
    });
    expect(caseActions({ assignee: null }, ME.subject, true)).toMatchObject({
      claim: true,
      reassign: 'assign',
      unassign: false,
    });
  });
});

describe('windowLine', () => {
  it('counts the days left, and warns in the last three weeks', () => {
    expect(windowLine('2026-10-18T09:00:00Z', NOW)).toEqual({
      open: true,
      text: 'Window closes 18 Oct 2026 · 16 days left',
      soon: true,
    });
    expect(windowLine('2027-01-21T09:00:00Z', NOW)).toMatchObject({ soon: false });
  });

  it('says when it closed', () => {
    expect(windowLine('2026-09-02T09:00:00Z', NOW)).toEqual({
      open: false,
      text: 'Window closed 2 Sep 2026',
      soon: false,
    });
  });
});

describe('versionLine', () => {
  const version = (n: number, amendment: boolean) => ({
    versionId: `v${String(n)}`,
    version: n,
    submittedAt: `2026-0${String(n)}-01T09:00:00Z`,
    late: false,
    amendment,
  });

  it('names the version and when an amendment came', () => {
    expect(
      versionLine({
        case: { currentVersion: 2 } as never,
        versions: [version(1, false), version(2, true)],
      }),
    ).toEqual({ text: 'Version 2 of 2', amendedAt: '2026-02-01T09:00:00Z' });
    expect(
      versionLine({ case: { currentVersion: 1 } as never, versions: [version(1, false)] }),
    ).toEqual({ text: 'Version 1 of 1', amendedAt: null });
  });
});

describe('assignableOfficers', () => {
  it('offers the reviewers of record and the supervisor, never the holder', () => {
    expect(
      assignableOfficers(
        { case: { assignee: PETER } as never, reviewerHistory: [MERCY, PETER, MERCY] },
        ME,
      ),
    ).toEqual([MERCY, ME]);
  });
});

describe('noteError', () => {
  it('needs 1 to 2,000 characters', () => {
    expect(noteError(' ')).toBe('Write a note first.');
    expect(noteError('x'.repeat(2001))).toBe('Notes can be up to 2,000 characters.');
    expect(noteError('Checked the title deed.')).toBeNull();
  });
});
