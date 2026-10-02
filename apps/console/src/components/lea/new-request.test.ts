import { describe, expect, it } from 'vitest';

import type { LeaRequest } from '../../server/access/types';
import {
  emptyLeaDraft,
  type LeaDraft,
  leaDraftErrors,
  leaInput,
  leaSubmitFailure,
} from './new-request';
import { packageState } from './package';

const DRAFT: LeaDraft = {
  ...emptyLeaDraft(),
  commission: 'psc',
  name: ' Grace Nyambura Kamau ',
  entity: '',
  personnelFileNumber: '20107725',
  reason: 'Investigation into housing tenders.',
  caseReference: ' DCI/ECU/150/2026 ',
  scope: {
    years: [2026],
    includeSpouses: true,
    includeChildren: false,
    sections: ['assets'],
    includeClarifications: false,
  },
};

describe('a new written request (S11)', () => {
  it('needs a Commission, the officer sought, a reason, a case reference and a scope', () => {
    expect(leaDraftErrors(emptyLeaDraft())).toEqual({
      commission: 'Choose the Commission.',
      name: 'Enter the name of the officer, at least 2 characters.',
      reason: 'State the reason for access.',
      caseReference: 'Enter the case reference.',
      years: 'Choose at least one year.',
      sections: 'Choose at least one section.',
    });
    expect(leaDraftErrors(DRAFT)).toEqual({});
    expect(leaDraftErrors({ ...DRAFT, reason: 'x'.repeat(4001) }).reason).toBe(
      'Keep the reason to 4,000 characters.',
    );
    expect(leaDraftErrors({ ...DRAFT, caseReference: 'x'.repeat(101) }).caseReference).toBe(
      'Keep the case reference to 100 characters.',
    );
    expect(leaDraftErrors({ ...DRAFT, personnelFileNumber: 'x'.repeat(31) })).toEqual({
      personnelFileNumber: 'Keep it to 30 characters.',
    });
  });

  it('sends it trimmed, leaving out what was not given', () => {
    expect(leaInput({ ...DRAFT, commission: 'psc' })).toEqual({
      commission: 'psc',
      officerSought: { name: 'Grace Nyambura Kamau', personnelFileNumber: '20107725' },
      reason: 'Investigation into housing tenders.',
      caseReference: 'DCI/ECU/150/2026',
      scope: DRAFT.scope,
    });
  });

  it("shows the service's refusal by field, in the form's words", () => {
    const failure = leaSubmitFailure({
      kind: 'problem',
      problem: {
        type: 'about:blank',
        title: 'Bad Request',
        status: 400,
        detail: 'A request for this case is already open with PSC.',
        errors: [
          { path: 'caseReference', message: 'One open request per case' },
          { path: 'officerSought.name', message: 'Too small' },
          { path: 'somethingElse', message: 'Odd' },
        ],
      },
    });
    expect(failure).toMatchObject({
      title: 'Request not accepted',
      text: 'A request for this case is already open with PSC.',
      fieldErrors: {
        caseReference: 'Check the case reference.',
        name: 'Enter the name of the officer, at least 2 characters.',
      },
      unmapped: ['somethingElse: Odd'],
      newKey: true,
    });
    expect(leaSubmitFailure({ kind: 'unavailable', detail: null })).toMatchObject({
      newKey: false,
      title: 'We could not send the request. Nothing was sent. Try again.',
    });
    expect(
      leaSubmitFailure({ kind: 'problem', problem: { type: 'x', title: 'x', status: 403 } }).title,
    ).toMatch(/not an active law enforcement officer account/);
  });
});

describe('the package of a request', () => {
  const NOW = Date.parse('2026-10-02T09:00:00.000Z');
  const decided = (at: string) =>
    ({
      outcome: 'grant',
      decidedAt: at,
    }) as LeaRequest['decision'];
  const pkg = (until: string) => ({
    documentId: 'd',
    verificationId: 'v',
    issuedAt: '2026-09-30T09:00:00.000Z',
    downloadExpiresAt: until,
    downloads: 1,
  });

  it('is ready to download, closed, being prepared, or missing after an hour', () => {
    expect(
      packageState(
        {
          status: 'granted',
          decision: decided('2026-09-30T08:00:00.000Z'),
          package: pkg('2026-10-14T00:00:00.000Z'),
        },
        NOW,
      ),
    ).toMatchObject({ kind: 'ready', documentId: 'd' });
    expect(
      packageState(
        {
          status: 'granted',
          decision: decided('2026-09-01T08:00:00.000Z'),
          package: pkg('2026-09-15T00:00:00.000Z'),
        },
        NOW,
      ),
    ).toMatchObject({ kind: 'closed' });
    expect(
      packageState(
        { status: 'granted', decision: decided('2026-10-02T08:59:00.000Z'), package: null },
        NOW,
      ),
    ).toEqual({ kind: 'preparing' });
    expect(
      packageState(
        { status: 'granted', decision: decided('2026-10-01T08:00:00.000Z'), package: null },
        NOW,
      ),
    ).toEqual({ kind: 'missing' });
    expect(packageState({ status: 'denied', decision: null, package: null }, NOW)).toEqual({
      kind: 'none',
    });
  });
});
