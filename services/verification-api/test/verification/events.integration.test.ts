import { PLATFORM_TENANT } from '@adili/api-kit';
import {
  newVerificationId,
  VERIFICATION_AUDITED,
  VERIFICATION_CHECKED,
  VERIFICATION_OUTCOMES,
  type VerificationAuditedData,
  type VerificationCheckedData,
} from '@adili/events/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { issued, issuedData, revoked, superseded } from '../support/events.js';
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

    const events = (await api.outbox()).filter((event) => event.type === VERIFICATION_CHECKED);
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

describe('S20 every lookup is audited with its time and coarse origin, never the address', () => {
  let api: VerificationApi;

  beforeAll(async () => {
    api = await startVerificationApi();
  });

  afterAll(async () => {
    await api.close();
  });

  it('records audit.verification.v1 under the platform with the /24 or /48 network', async () => {
    const slip = issuedData();
    const unknown = newVerificationId();
    await api.consumers.issued(issued(slip));

    await api.get(`/v1/verify/${slip.verificationId}`, '198.51.100.77');
    await api.get(`/v1/verify/${unknown}`, '2001:db8:abcd:12::1');
    await api.get('/v1/verify/ADL-NOPE', '198.51.100.78');

    const audited = (await api.outbox()).filter((event) => event.type === VERIFICATION_AUDITED);
    expect(audited.map((event) => event.data)).toEqual([
      {
        verificationId: slip.verificationId,
        outcome: 'valid',
        origin: { network: '198.51.100.0/24' },
      },
      { verificationId: unknown, outcome: 'not-found', origin: { network: '2001:db8:abcd::/48' } },
    ] satisfies VerificationAuditedData[]);
    for (const event of audited) {
      expect(event.tenant).toBe(PLATFORM_TENANT);
      expect(event.source).toBe('adili/verification-api');
      expect(event.subject).toBe((event.data as VerificationAuditedData).verificationId);
      expect(Date.parse(event.time)).not.toBeNaN();
      expect(JSON.stringify(event)).not.toMatch(/198\.51\.100\.77|:12::1/);
    }
  });
});
