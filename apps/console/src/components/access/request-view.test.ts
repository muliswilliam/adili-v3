import { describe, expect, it } from 'vitest';

import type { OfficerRequestView } from '../../server/access/types';
import { filtersFor, hasQueueFilters, queueSearchSchema, queueServiceQuery } from './queue-query';
import { actionFailure, requestStep, timelineOf, verifyNoteError } from './request-view';

function view(over: Partial<OfficerRequestView>): OfficerRequestView {
  return {
    status: 'submitted',
    resolvedRosterRecordId: null,
    windowEndsAt: null,
    timeline: [],
    decision: null,
    ...over,
  } as OfficerRequestView;
}

describe('the queue filters', () => {
  it('reads them from the URL, dropping what it does not know', () => {
    expect(queueSearchSchema.parse({ filter: 'late', search: ' Kamau ' })).toEqual({
      filter: 'late',
      search: 'Kamau',
    });
    expect(queueSearchSchema.parse({ filter: 'all', search: '', cursor: 7 })).toEqual({});
    expect(queueSearchSchema.parse({ filter: 'nonsense' })).toEqual({});
    expect(queueSearchSchema.parse({ search: 20113458 })).toEqual({ search: '20113458' });
    expect(queueSearchSchema.parse({ kind: 'lea' })).toEqual({ kind: 'lea' });
    expect(queueSearchSchema.parse({ kind: 'all' })).toEqual({});
    expect(queueSearchSchema.parse({ kind: 'copies' })).toEqual({});
  });

  it("asks for every kind by default, or the tab's kind (S11: law enforcement requests in the queue)", () => {
    expect(queueServiceQuery({ kind: 'lea' })).toEqual({ kind: 'lea', limit: 20 });
    expect(queueServiceQuery({ kind: 'form-k', filter: 'decided' })).toEqual({
      kind: 'form-k',
      status: 'granted,partially-granted,denied',
      limit: 20,
    });
    expect(filtersFor('lea')).not.toContain('window');
    expect(filtersFor('all')).toContain('window');
  });

  it("maps each filter to the service's query", () => {
    expect(queueServiceQuery({})).toEqual({ limit: 20 });
    expect(queueServiceQuery({ filter: 'action' })).toMatchObject({
      status:
        'submitted,pending-applicant-verification,officer-unresolved,under-decision,received,verified',
    });
    expect(queueServiceQuery({ filter: 'window' })).toMatchObject({
      status: 'awaiting-representations',
    });
    expect(queueServiceQuery({ filter: 'late', search: 'x', cursor: 'c' })).toEqual({
      late: 'true',
      search: 'x',
      cursor: 'c',
      limit: 20,
    });
    expect(queueServiceQuery({ filter: 'decided' }).status).toBe(
      'granted,partially-granted,denied',
    );
    expect(queueServiceQuery({ filter: 'closed' }).status).toBe('cannot-identify,withdrawn');
  });

  it('tells no matches from an empty queue', () => {
    expect(hasQueueFilters({})).toBe(false);
    expect(hasQueueFilters({ cursor: 'c' })).toBe(false);
    expect(hasQueueFilters({ filter: 'late' })).toBe(true);
    expect(hasQueueFilters({ search: 'x' })).toBe(true);
  });
});

describe('requestStep', () => {
  it('gives the access officer the step to take', () => {
    expect(requestStep(view({ status: 'pending-applicant-verification' }), false).kind).toBe(
      'verify',
    );
    expect(requestStep(view({ status: 'submitted' }), false).kind).toBe('identify');
    expect(requestStep(view({ status: 'officer-unresolved' }), false).kind).toBe('identify');
    expect(requestStep(view({ status: 'under-decision' }), false).kind).toBe('decide');
  });

  it('shows the supervisor where it stands instead (read only)', () => {
    expect(requestStep(view({ status: 'pending-applicant-verification' }), true)).toMatchObject({
      kind: 'waiting',
    });
    expect(requestStep(view({ status: 'officer-unresolved' }), true)).toMatchObject({
      kind: 'waiting',
    });
  });

  it('waits for the workflow once the officer is identified', () => {
    const resolved = view({ resolvedRosterRecordId: 'a11d0000-0000-4000-8000-000000000001' });
    expect(requestStep(resolved, false).kind).toBe('notifying');
    expect(requestStep(resolved, true).kind).toBe('notifying');
  });

  it('holds the decision while the window is open, and closes', () => {
    const at = '2026-10-09T09:00:00.000Z';
    expect(
      requestStep(view({ status: 'awaiting-representations', windowEndsAt: at }), false),
    ).toEqual({
      kind: 'window',
      windowEndsAt: at,
    });
    expect(requestStep(view({ status: 'granted' }), false).kind).toBe('decided');
    expect(requestStep(view({ status: 'cannot-identify' }), false).kind).toBe('cannot-identify');
    expect(requestStep(view({ status: 'withdrawn' }), true).kind).toBe('withdrawn');
  });
});

describe('timelineOf', () => {
  it("names each actor's part and tints a decision by its outcome", () => {
    const entry = (kind: string, actor: string | null) => ({
      id: kind,
      kind,
      at: '2026-10-01T09:00:00.000Z',
      actor,
      summary: kind,
      reference: 'ARQ',
    });
    const entries = timelineOf(
      view({
        timeline: [
          entry('received', 'Mercy'),
          entry('notified', null),
          entry('representations', 'Anne'),
          entry('decided', 'Lucy'),
        ] as OfficerRequestView['timeline'],
        decision: { outcome: 'deny' } as OfficerRequestView['decision'],
      }),
    );
    expect(entries.map((each) => [each.actor, each.outcome])).toEqual([
      ['Mercy (applicant)', undefined],
      [null, undefined],
      ['Anne (declarant)', undefined],
      ['Lucy', 'deny'],
    ]);
  });
});

describe('actionFailure', () => {
  const problem = (status: number, extra: Record<string, unknown> = {}) => ({
    kind: 'problem' as const,
    problem: { type: 'about:blank', title: 'x', status, ...extra },
  });

  it('says why the page is out of date and reloads it on 403, 404 and 409', () => {
    expect(actionFailure(problem(409, { code: 'officer-resolved' }))).toEqual({
      message: 'The officer is already identified. The page shows it now.',
      stale: true,
      signIn: false,
    });
    expect(actionFailure(problem(409)).stale).toBe(true);
    expect(actionFailure(problem(403)).message).toBe('Only the access officer can do this.');
  });

  it('keeps the dialog open to retry or choose again', () => {
    expect(
      actionFailure(problem(400, { errors: [{ path: 'rosterRecordId', message: 'x' }] })),
    ).toMatchObject({ stale: false, message: expect.stringContaining('not onboarded') as unknown });
    expect(
      actionFailure({ kind: 'unavailable', detail: null, problemType: 'directory-unavailable' }),
    ).toMatchObject({ stale: false, message: expect.stringContaining('roster') as unknown });
    expect(actionFailure({ kind: 'unauthenticated' }).signIn).toBe(true);
  });
});

describe('verifyNoteError', () => {
  it('needs a note of 1 to 1,000 characters', () => {
    expect(verifyNoteError('  ')).toBe('Say how you checked the particulars.');
    expect(verifyNoteError('x'.repeat(1001))).toBe('Keep the note to 1,000 characters.');
    expect(verifyNoteError('Copy seen by email')).toBeNull();
  });
});
