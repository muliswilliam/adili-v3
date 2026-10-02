import {
  ACCESS_REQUEST_CANNOT_IDENTIFY,
  ACCESS_REQUEST_DECIDED,
  ACCESS_REQUEST_RECEIVED,
} from '@adili/events/contracts';
import {
  accessRequestCannotIdentifyDataSchema,
  accessRequestDecidedDataSchema,
  accessRequestReceivedDataSchema,
} from '@adili/events/contracts/schemas';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { type AccessApi, startAccessApi } from '../support/access-api.js';
import {
  callers,
  decide,
  givenCommissions,
  resolve,
  submitRequest,
  underDecisionRequest,
} from '../support/requests.js';

const NOW = '2027-03-04T09:00:00.000Z';
const REASONS = 'The officer’s liabilities are not needed for the stated purpose.';
const NARROWED = {
  years: [2026],
  includeSpouses: false,
  includeChildren: false,
  sections: ['income', 'assets'],
};

/**
 * Access facts for Form M section 5 (S14): the reporting service counts requests received and
 * decided (granted, or declined with their reasons) from the access events alone, so `received`
 * carries the legal basis and deadline, `decided` the outcome with its Regulation 24 grounds, and
 * `cannot-identify` the decline reason `other`. Asserted on the outbox payloads against the
 * shared event schemas; identifiers, outcomes and grounds only.
 */
describe('Access events for Form M section 5 (S14)', () => {
  let api: AccessApi;

  beforeAll(async () => {
    api = await startAccessApi();
    return () => api.close();
  });

  afterEach(() => api.reset());

  async function dataOf(type: string) {
    const events = await api.events(type);
    for (const event of events) {
      // Never the applicant's particulars, the Form K text or the reasons given.
      const json = JSON.stringify(event);
      expect(json).not.toContain('Mercy');
      expect(json).not.toContain(REASONS);
    }
    return events;
  }

  it('S14: received carries the request, its Commission, legal basis and decision deadline', async () => {
    givenCommissions(api, NOW);

    const { id, reference } = await submitRequest(api);

    const [event] = await dataOf(ACCESS_REQUEST_RECEIVED);
    expect(event).toMatchObject({ tenant: 'psc', subject: id });
    expect(accessRequestReceivedDataSchema.parse(event?.data)).toEqual({
      registerEntryId: expect.any(String) as unknown,
      subjectKind: 'access-request',
      subjectId: id,
      reference,
      tenant: 'psc',
      kind: 'received',
      legalBasis: 'act-s36-1',
      personId: null,
      actor: callers.mercy.sub,
      at: NOW,
      decisionDeadlineAt: '2027-04-03T09:00:00.000Z',
    });
  });

  it('S14: decided carries the outcome with the Regulation 24 grounds: none for a grant, those given for a partial grant or a denial', async () => {
    const { anne } = givenCommissions(api, NOW);
    const granted = await underDecisionRequest(api, anne);
    const partial = await underDecisionRequest(api, anne);
    const denied = await underDecisionRequest(api, anne);

    for (const [id, body] of [
      [granted.id, { outcome: 'grant', reasons: REASONS }],
      [
        partial.id,
        {
          outcome: 'partial-grant',
          grantedScope: NARROWED,
          grounds: ['not-objectives'],
          reasons: REASONS,
        },
      ],
      [
        denied.id,
        { outcome: 'deny', grounds: ['frivolous-vexatious', 'public-interest'], reasons: REASONS },
      ],
    ] as const) {
      const response = await decide(api, id, body);
      expect(response.statusCode, response.body).toBe(200);
    }

    const events = await dataOf(ACCESS_REQUEST_DECIDED);
    const decided = new Map(
      events.map((event) => {
        const data = accessRequestDecidedDataSchema.parse(event.data);
        expect(data).toMatchObject({
          tenant: 'psc',
          legalBasis: 'act-s36-1',
          personId: anne.personId,
          actor: callers.officer.sub,
        });
        return [data.subjectId, { outcome: data.outcome, grounds: data.grounds }];
      }),
    );
    expect(Object.fromEntries(decided)).toEqual({
      [granted.id]: { outcome: 'grant', grounds: [] },
      [partial.id]: { outcome: 'partial-grant', grounds: ['not-objectives'] },
      [denied.id]: { outcome: 'deny', grounds: ['frivolous-vexatious', 'public-interest'] },
    });
  });

  it('S14: a request whose officer cannot be identified counts declined for reason other', async () => {
    givenCommissions(api, NOW);
    const { id } = await submitRequest(api);

    const response = await resolve(api, id, null);

    expect(response.statusCode, response.body).toBe(200);
    const [event] = await dataOf(ACCESS_REQUEST_CANNOT_IDENTIFY);
    expect(accessRequestCannotIdentifyDataSchema.parse(event?.data)).toMatchObject({
      subjectId: id,
      kind: 'cannot-identify',
      legalBasis: 'act-s36-1',
      declineReason: 'other',
    });
  });
});
