import {
  VERIFICATION_CHECKED,
  VERIFICATION_OUTCOMES,
  type VerificationCheckedData,
} from '@adili/events/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { issued, issuedData, newVerificationId, revoked, superseded } from '../support/events.js';
import { startVerificationApi, type VerificationApi } from '../support/verification-api.js';

describe('S20 every lookup is recorded as verification.checked.v1, identifiers only', () => {
  let api: VerificationApi;

  beforeAll(async () => {
    api = await startVerificationApi();
  });

  afterAll(async () => {
    await api.close();
  });

  it('records one event per lookup with the id and outcome', async () => {
    const valid = issuedData();
    const old = issuedData();
    const cancelled = issuedData();
    const unknown = newVerificationId();
    for (const data of [valid, old, cancelled]) await api.consumers.issued(issued(data));
    await api.consumers.superseded(superseded(old, valid));
    await api.consumers.revoked(revoked(cancelled, 'withdrawn'));

    await api.get(`/v1/verify/${valid.verificationId}`);
    await api.get(`/v1/verify/${valid.verificationId.toLowerCase()}`);
    await api.get(`/v1/verify/${old.verificationId}`);
    await api.get(`/v1/verify/${cancelled.verificationId}`);
    await api.get(`/v1/verify/${unknown}`);
    // A malformed code names no document: no check to record.
    await api.get('/v1/verify/ADL-NOPE');

    const events = await api.outbox();
    expect(events.map((event) => [event.type, event.data])).toEqual([
      [VERIFICATION_CHECKED, { verificationId: valid.verificationId, outcome: 'valid' }],
      [VERIFICATION_CHECKED, { verificationId: valid.verificationId, outcome: 'valid' }],
      [VERIFICATION_CHECKED, { verificationId: old.verificationId, outcome: 'superseded' }],
      [VERIFICATION_CHECKED, { verificationId: cancelled.verificationId, outcome: 'revoked' }],
      [VERIFICATION_CHECKED, { verificationId: unknown, outcome: 'not-found' }],
    ]);
    for (const event of events) {
      const data = event.data as VerificationCheckedData;
      expect(Object.keys(data).sort()).toEqual(['outcome', 'verificationId']);
      expect(VERIFICATION_OUTCOMES).toContain(data.outcome);
      expect(event.source).toBe('adili/verification-api');
      expect(event.subject).toBe(data.verificationId);
      // Nothing about who checked, and no tenant: the service holds none.
      expect(event.tenant).toBeUndefined();
      expect(JSON.stringify(event)).not.toMatch(/203\.0\.|ip|origin/i);
    }
  });
});
