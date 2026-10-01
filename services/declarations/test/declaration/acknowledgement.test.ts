import { describe, expect, it } from 'vitest';

import {
  ACKNOWLEDGEMENT_DEADLINE_MS,
  type AcknowledgementState,
  acknowledgementStatus,
  reissueDecision,
} from '../../src/declaration/acknowledgement.js';

const SUBMITTED = new Date('2027-11-15T09:00:00.000Z');
const at = (ms: number) => new Date(SUBMITTED.getTime() + ms);

const pending: AcknowledgementState = {
  ackStatus: 'pending',
  submittedAt: SUBMITTED,
  ackRequestedAt: null,
};

describe('acknowledgementStatus', () => {
  it('is pending until the deadline after submission, then failed', () => {
    expect(acknowledgementStatus(pending, at(0))).toBe('pending');
    expect(acknowledgementStatus(pending, at(ACKNOWLEDGEMENT_DEADLINE_MS))).toBe('pending');
    expect(acknowledgementStatus(pending, at(ACKNOWLEDGEMENT_DEADLINE_MS + 1))).toBe('failed');
  });

  it('is pending again for the deadline after an ask again', () => {
    const asked = { ...pending, ackRequestedAt: at(10 * 60_000) };
    expect(acknowledgementStatus(asked, at(11 * 60_000))).toBe('pending');
    expect(acknowledgementStatus(asked, at(10 * 60_000 + ACKNOWLEDGEMENT_DEADLINE_MS + 1))).toBe(
      'failed',
    );
  });

  it('is issued once issued, whatever the time', () => {
    expect(acknowledgementStatus({ ...pending, ackStatus: 'issued' }, at(3_600_000))).toBe(
      'issued',
    );
  });
});

describe('reissueDecision', () => {
  it('refuses an issued slip and one still being prepared', () => {
    expect(reissueDecision({ ...pending, ackStatus: 'issued' }, at(0))).toEqual({
      kind: 'refused',
      code: 'acknowledgement-issued',
    });
    expect(reissueDecision(pending, at(60_000))).toEqual({
      kind: 'refused',
      code: 'acknowledgement-in-progress',
    });
  });

  it('asks again once failed', () => {
    expect(reissueDecision(pending, at(ACKNOWLEDGEMENT_DEADLINE_MS + 1))).toEqual({
      kind: 'reissue',
    });
  });

  it('makes a second ask wait out the first one', () => {
    const asked = { ...pending, ackRequestedAt: at(10 * 60_000) };
    expect(reissueDecision(asked, at(10 * 60_000 + 30_000))).toEqual({
      kind: 'cooldown',
      retryAfterSeconds: ACKNOWLEDGEMENT_DEADLINE_MS / 1000 - 30,
    });
    expect(reissueDecision(asked, at(10 * 60_000 + ACKNOWLEDGEMENT_DEADLINE_MS + 1))).toEqual({
      kind: 'reissue',
    });
  });
});
