import { describe, expect, it } from 'vitest';

import type { Acknowledgement } from '../../server/declarations/types';
import {
  cooldownLeft,
  initialSlipState,
  REISSUE_COOLDOWN_SECONDS,
  sentTo,
  SLIP_POLL_INTERVAL_MS,
  SLIP_POLL_LIMIT,
  SLIP_POLL_WINDOW_MS,
  slipAnnouncement,
  type SlipEvent,
  slipReducer,
  type SlipState,
  verifyUrl,
} from './slip';

const NOW = Date.parse('2026-09-30T07:42:00Z');

const pending: Acknowledgement = {
  status: 'pending',
  documentId: null,
  verificationId: null,
  issuedAt: null,
  verifiedCount: 0,
  downloadUrl: null,
};
const issued: Acknowledgement = {
  status: 'issued',
  documentId: '9d7c1a52-0f3e-4b8a-9c6d-2e1f0a3b4c5d',
  verificationId: 'ADL-7K3M-Q9TX-4HWD-2PBN-8RFE-V6ZC-J5',
  issuedAt: '2026-09-30T07:42:04Z',
  verifiedCount: 0,
  downloadUrl: 'https://s3.test/issued/slip.pdf?signature=x',
};
const failed: Acknowledgement = { ...pending, status: 'failed' };

function run(state: SlipState, ...events: SlipEvent[]): SlipState {
  return events.reduce(slipReducer, state);
}

const read = (acknowledgement: Acknowledgement | null): SlipEvent => ({
  type: 'read',
  acknowledgement,
});

describe('where the slip card starts', () => {
  it('prepares a pending slip, shows an issued one and offers a failed one again', () => {
    expect(initialSlipState(pending)).toEqual({ step: 'preparing', reads: 0, cooldownUntil: null });
    expect(initialSlipState(issued)).toEqual({ step: 'issued', acknowledgement: issued });
    expect(initialSlipState(failed)).toEqual({
      step: 'failed',
      cooldownUntil: null,
      requesting: false,
      problem: null,
    });
  });
});

describe('polling while the slip is prepared (S19)', () => {
  it('reads every two seconds for up to a minute', () => {
    expect(SLIP_POLL_INTERVAL_MS).toBe(2000);
    expect(SLIP_POLL_WINDOW_MS).toBe(60_000);
    expect(SLIP_POLL_LIMIT * SLIP_POLL_INTERVAL_MS).toBe(SLIP_POLL_WINDOW_MS);
  });

  it('keeps preparing through the reads of the window', () => {
    const reads = Array.from({ length: SLIP_POLL_LIMIT - 1 }, () => read(pending));

    expect(run(initialSlipState(pending), ...reads)).toEqual({
      step: 'preparing',
      reads: SLIP_POLL_LIMIT - 1,
      cooldownUntil: null,
    });
  });

  it('stops after a minute still pending and says it is taking longer', () => {
    const reads = Array.from({ length: SLIP_POLL_LIMIT }, () => read(pending));

    const state = run(initialSlipState(pending), ...reads);

    expect(state).toEqual({ step: 'slow', cooldownUntil: null });
    expect(slipAnnouncement(state)).toBe(
      'It is taking longer than usual. We will email you when it is ready.',
    );
  });

  it('counts a read that failed as still pending', () => {
    const reads = Array.from({ length: SLIP_POLL_LIMIT }, () => read(null));

    expect(run(initialSlipState(pending), ...reads).step).toBe('slow');
  });

  it('starts a new window on "Check again"', () => {
    const slow = run(
      initialSlipState(pending),
      ...Array.from({ length: SLIP_POLL_LIMIT }, () => read(pending)),
    );

    expect(slipReducer(slow, { type: 'check-again' })).toEqual({
      step: 'preparing',
      reads: 0,
      cooldownUntil: null,
    });
  });

  it('ignores reads once it stopped', () => {
    const slow: SlipState = { step: 'slow', cooldownUntil: null };

    expect(slipReducer(slow, read(issued))).toBe(slow);
  });

  it('shows the slip as soon as it is issued', () => {
    expect(run(initialSlipState(pending), read(pending), read(issued))).toEqual({
      step: 'issued',
      acknowledgement: issued,
    });
  });

  it('offers to ask again when issuance failed', () => {
    expect(run(initialSlipState(pending), read(failed))).toEqual({
      step: 'failed',
      cooldownUntil: null,
      requesting: false,
      problem: null,
    });
  });

  it('takes a fresher verified count on an issued slip, but not a regression', () => {
    const state = initialSlipState(issued);

    expect(slipReducer(state, read({ ...issued, verifiedCount: 3 }))).toEqual({
      step: 'issued',
      acknowledgement: { ...issued, verifiedCount: 3 },
    });
    expect(slipReducer(state, read(pending))).toBe(state);
    expect(slipReducer(state, read(null))).toBe(state);
  });
});

describe('asking for a failed slip again (S19)', () => {
  const start = initialSlipState(failed);

  it('requests once, then prepares again with a cooldown', () => {
    const requesting = slipReducer(start, { type: 'reissue-pressed', now: NOW });
    expect(requesting).toMatchObject({ step: 'failed', requesting: true });
    expect(slipReducer(requesting, { type: 'reissue-pressed', now: NOW })).toBe(requesting);

    const state = slipReducer(requesting, {
      type: 'reissue-answered',
      answer: { status: 'requested' },
      now: NOW,
    });

    expect(state).toEqual({
      step: 'preparing',
      reads: 0,
      cooldownUntil: NOW + REISSUE_COOLDOWN_SECONDS * 1000,
    });
  });

  it('holds "Request again" back until the cooldown ends, when it failed again', () => {
    const state = run(
      start,
      { type: 'reissue-pressed', now: NOW },
      { type: 'reissue-answered', answer: { status: 'requested' }, now: NOW },
      read(failed),
    );

    expect(cooldownLeft(state, NOW + 1500)).toBe(59);
    expect(slipReducer(state, { type: 'reissue-pressed', now: NOW + 1500 })).toBe(state);
    expect(cooldownLeft(state, NOW + 60_000)).toBe(0);
    expect(slipReducer(state, { type: 'reissue-pressed', now: NOW + 60_000 })).toMatchObject({
      requesting: true,
    });
  });

  it("waits as long as the service's Retry-After says, or a minute", () => {
    const pressed = slipReducer(start, { type: 'reissue-pressed', now: NOW });

    const told = slipReducer(pressed, {
      type: 'reissue-answered',
      answer: { status: 'cooldown', retryAfterSeconds: 42 },
      now: NOW,
    });
    const untold = slipReducer(pressed, {
      type: 'reissue-answered',
      answer: { status: 'cooldown', retryAfterSeconds: null },
      now: NOW,
    });

    expect(told).toMatchObject({ step: 'failed', requesting: false, problem: null });
    expect(cooldownLeft(told, NOW)).toBe(42);
    expect(cooldownLeft(untold, NOW)).toBe(60);
  });

  it('prepares again when the slip is issued or on its way meanwhile', () => {
    const state = run(
      start,
      { type: 'reissue-pressed', now: NOW },
      { type: 'reissue-answered', answer: { status: 'in-progress' }, now: NOW },
    );

    expect(state).toEqual({ step: 'preparing', reads: 0, cooldownUntil: null });
  });

  it('says so when the request did not go through, and lets the declarant try again', () => {
    for (const answer of [
      { status: 'unavailable' },
      { status: 'not-found' },
      { status: 'unauthenticated' },
    ] as const) {
      const state = run(
        start,
        { type: 'reissue-pressed', now: NOW },
        { type: 'reissue-answered', answer, now: NOW },
      );

      expect(state).toEqual({
        step: 'failed',
        cooldownUntil: null,
        requesting: false,
        problem: 'error',
      });
      expect(slipAnnouncement(state)).toBe('We could not ask for it again. Try again in a moment.');
    }
  });

  it('ignores an answer it did not ask for', () => {
    expect(
      slipReducer(start, {
        type: 'reissue-answered',
        answer: { status: 'requested' },
        now: NOW,
      }),
    ).toBe(start);
  });
});

describe('the slip card copy', () => {
  it('names the contacts the slip went to', () => {
    const email = { kind: 'email', value: 'm***@tsc.go.ke' };
    const phone = { kind: 'phone', value: '07** *** 789' };
    expect(sentTo('m***@tsc.go.ke', '07** *** 789')).toEqual([email, phone]);
    expect(sentTo('m***@tsc.go.ke', null)).toEqual([email]);
    expect(sentTo(null, '07** *** 789')).toEqual([phone]);
    expect(sentTo(null, null)).toEqual([]);
  });

  it('announces each state once, not each read', () => {
    const preparing = initialSlipState(pending);

    expect(slipAnnouncement(slipReducer(preparing, read(pending)))).toBe(
      slipAnnouncement(preparing),
    );
    expect(slipAnnouncement(initialSlipState(issued))).toBe('Your acknowledgement slip is ready.');
    expect(slipAnnouncement(initialSlipState(failed))).toBe('The slip could not be prepared.');
  });

  it('links the QR to the verify page of the code', () => {
    expect(verifyUrl('http://localhost:3030', 'ADL-7K3M-Q9TX-4HWD-2PBN-8RFE-V6ZC-J5')).toBe(
      'http://localhost:3030/v/ADL-7K3M-Q9TX-4HWD-2PBN-8RFE-V6ZC-J5',
    );
    expect(verifyUrl('https://verify.adili.test/', 'ADL-1')).toBe(
      'https://verify.adili.test/v/ADL-1',
    );
  });
});
