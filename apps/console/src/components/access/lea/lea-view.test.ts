import { describe, expect, it } from 'vitest';

import type { LeaRequest } from '../../../server/access/types';
import { isBreached, leaActionFailure, leaNoteError, leaStep, leaTimelineOf } from './lea-view';

const NOW = '2026-10-02T09:00:00.000Z';

function request(over: Partial<LeaRequest>): LeaRequest {
  return {
    status: 'received',
    breachedAt: null,
    deadlineAt: '2026-10-10T07:00:00.000Z',
    caseReference: 'DCI/ECU/142/2026',
    agency: { code: 'DCI', name: 'Directorate of Criminal Investigations' },
    officer: { subject: 's', name: 'Suleiman Ali' },
    resolvedName: null,
    decision: null,
    timeline: [],
    ...over,
  } as LeaRequest;
}

describe('leaStep', () => {
  it('gives the access officer verify, then decide; the supervisor waits', () => {
    expect(leaStep({ status: 'received' }, false).kind).toBe('verify');
    expect(leaStep({ status: 'received' }, true)).toEqual({
      kind: 'waiting',
      text: 'Waiting for the access officer to verify.',
    });
    expect(leaStep({ status: 'verified' }, false).kind).toBe('decide');
    expect(leaStep({ status: 'granted' }, true).kind).toBe('decided');
    expect(leaStep({ status: 'denied' }, false).kind).toBe('decided');
  });
});

describe('isBreached (S11: breach flag at day 14)', () => {
  it('is set by the flag or the clock while undecided, never once decided', () => {
    expect(isBreached(request({}), NOW)).toBe(false);
    expect(isBreached(request({ deadlineAt: '2026-10-01T07:00:00.000Z' }), NOW)).toBe(true);
    expect(isBreached(request({ breachedAt: '2026-10-01T07:00:00.000Z' }), NOW)).toBe(true);
    expect(
      isBreached(request({ status: 'denied', breachedAt: '2026-10-01T07:00:00.000Z' }), NOW),
    ).toBe(false);
  });
});

describe('leaTimelineOf', () => {
  it('names the officer with their agency, and the declarant notice after the grant', () => {
    const entries = leaTimelineOf(
      request({
        resolvedName: 'Grace Nyambura Kamau',
        decision: { outcome: 'deny' } as LeaRequest['decision'],
        timeline: [
          {
            id: '1',
            kind: 'received',
            at: NOW,
            actor: 'Suleiman Ali',
            summary: '',
            reference: 'x',
          },
          { id: '2', kind: 'verified', at: NOW, actor: 'Lucy Wambui', summary: '', reference: 'x' },
          { id: '3', kind: 'decided', at: NOW, actor: 'Lucy Wambui', summary: '', reference: 'x' },
          { id: '4', kind: 'notified', at: NOW, actor: null, summary: '', reference: 'x' },
        ],
      }),
    );
    expect(entries[0]).toMatchObject({
      actor: 'Suleiman Ali (DCI)',
      summary: 'Case DCI/ECU/142/2026. Declarant not told yet.',
    });
    expect(entries[1]).toMatchObject({
      title: 'Request verified',
      summary: 'Officer identified: Grace Nyambura Kamau.',
    });
    expect(entries[2]).toMatchObject({ outcome: 'deny', summary: 'DCI told with reasons.' });
    expect(entries[3]).toMatchObject({ title: 'Declarant notified after grant' });
  });
});

describe('leaActionFailure', () => {
  it('reads a verification the service refused', () => {
    expect(leaActionFailure({ kind: 'unauthenticated' })).toMatchObject({ signIn: true });
    expect(
      leaActionFailure({ kind: 'unavailable', detail: null, problemType: 'directory-unavailable' })
        .message,
    ).toMatch(/directory cannot be reached/);
    const problem = (status: number, extra: object = {}) =>
      leaActionFailure({
        kind: 'problem',
        problem: { type: 'about:blank', title: 't', status, ...extra },
      });
    expect(problem(403)).toMatchObject({ stale: true });
    expect(problem(409, { code: 'officer-resolved' })).toMatchObject({ stale: true });
    // The account it came from was revoked since: deny instead, nothing to reload.
    expect(problem(409, { code: 'lea-account-inactive' })).toMatchObject({
      stale: false,
      message: expect.stringContaining('deny the request instead') as unknown,
    });
    expect(problem(400, { errors: [{ path: 'rosterRecordId', message: 'm' }] })).toMatchObject({
      record: true,
    });
  });

  it('needs a note of 1 to 1,000 characters', () => {
    expect(leaNoteError('  ')).toBe('Say what you checked.');
    expect(leaNoteError('x'.repeat(1001))).toBe('Keep the note to 1,000 characters.');
    expect(leaNoteError('Checked.')).toBeNull();
  });
});
