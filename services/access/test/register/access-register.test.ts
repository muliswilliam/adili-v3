import {
  ACCESS_EVENT_TYPES,
  ACCESS_REGISTER_KINDS,
  ACCESS_REQUEST_EVENTS,
  LEA_REQUEST_EVENTS,
} from '@adili/events/contracts';
import { describe, expect, it } from 'vitest';

import {
  LEGAL_BASIS,
  registerEventType,
  type RegisterStep,
} from '../../src/register/access-register.js';

// The CloudEvents type rule of the outbox (packages/events).
const EVENT_TYPE = /^[a-z]+(\.[a-z-]+)+\.v\d+$/;

describe('access register events', () => {
  it('name each step of a request after its kind of request (spec 10 events)', () => {
    expect(registerEventType({ subjectKind: 'access-request', kind: 'received' })).toBe(
      'access.request.received.v1',
    );
    expect(registerEventType({ subjectKind: 'access-request', kind: 'cannot-identify' })).toBe(
      'access.request.cannot-identify.v1',
    );
    expect(registerEventType({ subjectKind: 'lea-request', kind: 'decided' })).toBe(
      'lea.request.decided.v1',
    );
    expect(registerEventType({ subjectKind: 'self-access', kind: 'self-access' })).toBe(
      'access.certified-copy.issued.v1',
    );
  });

  it('are the declared types (one constant each), valid event types, for every kind of step', () => {
    const published = [
      ...Object.keys(ACCESS_REQUEST_EVENTS).map((kind) =>
        registerEventType({ subjectKind: 'access-request', kind } as RegisterStep),
      ),
      ...Object.keys(LEA_REQUEST_EVENTS).map((kind) =>
        registerEventType({ subjectKind: 'lea-request', kind } as RegisterStep),
      ),
      registerEventType({ subjectKind: 'self-access', kind: 'self-access' }),
    ];
    expect(published).toEqual(ACCESS_EVENT_TYPES);
    for (const type of published) expect(type).toMatch(EVENT_TYPE);
    expect(new Set(published).size).toBe(published.length);
    // Every register kind is some step's event.
    expect(new Set([...Object.keys(ACCESS_REQUEST_EVENTS), 'self-access'])).toEqual(
      new Set(ACCESS_REGISTER_KINDS),
    );
    expect(LEA_REQUEST_EVENTS).toMatchObject({
      notified: 'lea.request.notified.v1',
      expired: 'lea.request.expired.v1',
      withdrawn: 'lea.request.withdrawn.v1',
    });
  });

  it('cite the law each kind of access rests on', () => {
    expect(LEGAL_BASIS).toEqual({
      'access-request': 'act-s36-1',
      'lea-request': 'act-s36-2',
      'self-access': 'self-access',
    });
  });
});
