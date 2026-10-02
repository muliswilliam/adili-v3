import type { Scope } from '@adili/ui';
import { describe, expect, it } from 'vitest';

import {
  canNarrow,
  type DecisionDraft,
  decisionErrors,
  decisionFailure,
  decisionInput,
  emptyDraft,
  isWholeScope,
} from './decision-rules';

const requested: Scope = {
  years: [2025, 2026],
  includeSpouses: true,
  includeChildren: true,
  sections: ['income', 'liabilities'],
};
const narrower: Scope = { ...requested, years: [2026], includeChildren: false };

const draft = (more: Partial<DecisionDraft>): DecisionDraft => ({
  ...emptyDraft(),
  reasons: 'Because.',
  ...more,
});

describe('decisionErrors (as the access service decisionOf, S6)', () => {
  it('asks for an outcome first', () => {
    expect(decisionErrors(emptyDraft(), requested)).toEqual({ outcome: 'Choose an outcome.' });
  });

  it('a grant needs only reasons', () => {
    expect(decisionErrors(draft({ outcome: 'grant' }), requested)).toEqual({});
    expect(decisionErrors(draft({ outcome: 'grant', reasons: '  ' }), requested)).toEqual({
      reasons: 'Enter the reasons.',
    });
    expect(
      decisionErrors(draft({ outcome: 'grant', reasons: 'x'.repeat(4001) }), requested).reasons,
    ).toBe('Keep the reasons to 4,000 characters.');
  });

  it('a partial grant needs years, sections, a narrower scope and grounds', () => {
    expect(decisionErrors(draft({ outcome: 'partial-grant' }), requested)).toEqual({
      years: 'Choose at least one year.',
      sections: 'Choose at least one section.',
      grounds: 'Choose at least one ground for a partial grant or a denial.',
    });
    expect(
      decisionErrors(
        draft({ outcome: 'partial-grant', scope: requested, grounds: ['public-interest'] }),
        requested,
      ),
    ).toEqual({ scope: 'This is the full requested scope. Choose Grant instead.' });
    expect(
      decisionErrors(
        draft({ outcome: 'partial-grant', scope: narrower, grounds: ['public-interest'] }),
        requested,
      ),
    ).toEqual({});
  });

  it('never lets a partial grant reach beyond the request', () => {
    const wider = { ...narrower, sections: ['assets' as const] };
    expect(
      decisionErrors(
        draft({ outcome: 'partial-grant', scope: wider, grounds: ['public-interest'] }),
        requested,
      ).scope,
    ).toBe('The granted scope asks for more than the request did. Narrow it.');
  });

  it('a denial needs grounds', () => {
    expect(decisionErrors(draft({ outcome: 'deny' }), requested)).toEqual({
      grounds: 'Choose at least one ground for a partial grant or a denial.',
    });
  });

  it('knows when nothing can be left out of a request', () => {
    const minimal: Scope = {
      years: [2026],
      includeSpouses: false,
      includeChildren: false,
      sections: ['assets'],
    };
    expect(canNarrow(requested)).toBe(true);
    expect(canNarrow({ ...minimal, includeSpouses: true })).toBe(true);
    expect(canNarrow(minimal)).toBe(false);
  });

  it('flags a partial grant of the whole request as it is chosen', () => {
    expect(isWholeScope(draft({ outcome: 'partial-grant', scope: requested }), requested)).toBe(
      true,
    );
    expect(isWholeScope(draft({ outcome: 'partial-grant', scope: narrower }), requested)).toBe(
      false,
    );
  });
});

describe('decisionInput', () => {
  it('sends a grant without scope or grounds', () => {
    expect(
      decisionInput({
        ...draft({ grounds: ['public-interest'] }),
        outcome: 'grant',
        reasons: ' Yes. ',
      }),
    ).toEqual({ outcome: 'grant', reasons: 'Yes.' });
  });

  it('sends a partial grant with its scope and grounds', () => {
    const input = decisionInput({
      ...draft({ scope: narrower, grounds: ['public-interest'] }),
      outcome: 'partial-grant',
    });
    expect(input).toEqual({
      outcome: 'partial-grant',
      grantedScope: narrower,
      grounds: ['public-interest'],
      reasons: 'Because.',
    });
  });

  it('sends a denial with grounds and no scope', () => {
    expect(
      decisionInput({
        ...draft({ scope: narrower, grounds: ['not-objectives'] }),
        outcome: 'deny',
      }),
    ).toEqual({ outcome: 'deny', grounds: ['not-objectives'], reasons: 'Because.' });
  });
});

const problem = (status: number, more: object = {}) => ({
  kind: 'problem' as const,
  problem: { type: 'about:blank', title: 'x', status, ...more },
});

describe('decisionFailure (the server 400 and 409 messages)', () => {
  it('maps a 400 to the fields at fault', () => {
    expect(
      decisionFailure(
        problem(400, { code: 'grounds-required', errors: [{ path: 'grounds', message: 'x' }] }),
      ),
    ).toMatchObject({
      message: 'A partial grant or a denial needs at least one Regulation 24 ground.',
      errors: { grounds: 'Choose at least one ground for a partial grant or a denial.' },
      stale: false,
    });
    expect(
      decisionFailure(
        problem(400, {
          code: 'scope-exceeds-request',
          errors: [{ path: 'grantedScope', message: 'x' }],
        }),
      ).errors,
    ).toEqual({ scope: 'The granted scope asks for more than the request did. Narrow it.' });
    expect(
      decisionFailure(
        problem(400, {
          errors: [
            { path: 'grantedScope', message: 'is the whole requested scope: decide a grant' },
          ],
        }),
      ),
    ).toMatchObject({
      message: 'The granted scope is the whole requested scope. Choose Grant instead.',
      errors: { scope: 'This is the full requested scope. Choose Grant instead.' },
    });
  });

  it('a 409 offers the request instead of a retry', () => {
    expect(decisionFailure(problem(409, { code: 'request-decided' }))).toMatchObject({
      title: 'Already decided',
      stale: true,
    });
    expect(decisionFailure(problem(409, { code: 'request-closed' }))).toMatchObject({
      title: 'The request is closed',
      stale: true,
    });
    expect(decisionFailure(problem(409, { code: 'not-under-decision' }))).toMatchObject({
      title: 'Not ready to decide',
      stale: true,
    });
  });

  it('a 403, an outage and an ended session', () => {
    expect(decisionFailure(problem(403)).message).toBe(
      'Only the access officer decides. Nothing was recorded.',
    );
    expect(decisionFailure({ kind: 'unavailable', detail: null })).toMatchObject({
      message: 'The access service did not answer. Nothing was recorded. Try again.',
      stale: false,
    });
    expect(decisionFailure({ kind: 'unauthenticated' }).signIn).toBe(true);
  });
});
