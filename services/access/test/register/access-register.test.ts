import { ACCESS_REGISTER_KINDS } from '@adili/events/contracts';
import { describe, expect, it } from 'vitest';

import { LEGAL_BASIS, registerEventType } from '../../src/register/access-register.js';

// The CloudEvents type rule of the outbox (packages/events).
const EVENT_TYPE = /^[a-z]+(\.[a-z-]+)+\.v\d+$/;

describe('access register events', () => {
  it('name each step of a request after its kind of request (spec 10 events)', () => {
    expect(registerEventType('access-request', 'received')).toBe('access.request.received.v1');
    expect(registerEventType('access-request', 'cannot-identify')).toBe(
      'access.request.cannot-identify.v1',
    );
    expect(registerEventType('lea-request', 'decided')).toBe('lea.request.decided.v1');
    expect(registerEventType('self-access', 'self-access')).toBe('access.certified-copy.issued.v1');
  });

  it('are valid event types for every kind of step', () => {
    for (const kind of ACCESS_REGISTER_KINDS) {
      expect(registerEventType('access-request', kind)).toMatch(EVENT_TYPE);
      expect(registerEventType('lea-request', kind)).toMatch(EVENT_TYPE);
    }
  });

  it('cite the law each kind of access rests on', () => {
    expect(LEGAL_BASIS).toEqual({
      'access-request': 'act-s36-1',
      'lea-request': 'act-s36-2',
      'self-access': 'admin-mechanism-32',
    });
  });
});
