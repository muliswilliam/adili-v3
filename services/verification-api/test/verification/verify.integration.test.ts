import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DocumentIssuedData, PublicPayload } from '@adili/events/contracts';
import { verificationProjection } from '../../src/db/schema.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { issued, issuedData, newVerificationId, revoked, superseded } from '../support/events.js';
import { startVerificationApi, type VerificationApi } from '../support/verification-api.js';

const VERIFY = '/v1/verify/{verificationId}';

describe('S14 public verification of issued documents', () => {
  let api: VerificationApi;

  beforeAll(async () => {
    api = await startVerificationApi();
  });

  afterAll(async () => {
    await api.close();
  });

  it('answers valid with the restricted fields and hash once the issued event is in', async () => {
    const slip = issuedData();
    await api.consumers.issued(issued(slip));

    const response = await api.get(`/v1/verify/${slip.verificationId}`);

    expect(response.statusCode).toBe(200);
    const body = response.json<Record<string, unknown>>();
    expect(contractErrors(okResponse(VERIFY, 'get'), body)).toEqual([]);
    expect(body).toEqual({
      verificationId: slip.verificationId,
      status: 'valid',
      disclosureLevel: 'restricted',
      document: {
        type: 'acknowledgement-slip',
        issuerName: 'Teachers Service Commission',
        issuerCode: 'TSC',
        issuedAt: slip.issuedAt,
        reference: 'DCB-TSC-2027-0000001-B',
        version: 1,
      },
      sha256: slip.sha256,
      supersededBy: null,
      revokedReason: null,
      checkedAt: expect.any(String) as string,
    });
    expect(response.headers['ratelimit-limit']).toBe('30');
  });

  it('answers superseded with the newer id, and nothing of the newer document', async () => {
    const v1 = issuedData();
    const v2 = issuedData();
    v2.publicPayload = { ...slipPayload(v2), version: 2 };
    await api.consumers.issued(issued(v1));
    await api.consumers.issued(issued(v2));
    await api.consumers.superseded(superseded(v1, v2));

    const old = await api.get(`/v1/verify/${v1.verificationId}`);
    const current = await api.get(`/v1/verify/${v2.verificationId}`);

    expect(old.statusCode).toBe(200);
    expect(old.json()).toMatchObject({
      status: 'superseded',
      supersededBy: v2.verificationId,
      sha256: v1.sha256,
      document: { version: 1, reference: 'DCB-TSC-2027-0000001-B' },
    });
    expect(current.json()).toMatchObject({ status: 'valid', supersededBy: null });
  });

  it('answers revoked with the reason category', async () => {
    const slip = issuedData();
    await api.consumers.issued(issued(slip));
    await api.consumers.revoked(revoked(slip, 'issued-in-error'));

    const response = await api.get(`/v1/verify/${slip.verificationId}`);

    expect(response.json()).toMatchObject({
      status: 'revoked',
      revokedReason: 'issued-in-error',
      document: { issuerCode: 'TSC' },
    });
  });

  it('shows validity only for a confidential document', async () => {
    const older = issuedData({ disclosureLevel: 'confidential', publicPayload: null });
    const newer = issuedData({ disclosureLevel: 'confidential', publicPayload: null });
    await api.consumers.issued(issued(older));
    await api.consumers.issued(issued(newer));
    await api.consumers.superseded(superseded(older, newer));

    const response = await api.get(`/v1/verify/${older.verificationId}`);

    expect(response.statusCode).toBe(200);
    const body = response.json<Record<string, unknown>>();
    expect(contractErrors(okResponse(VERIFY, 'get'), body)).toEqual([]);
    expect(body).toMatchObject({
      status: 'superseded',
      disclosureLevel: 'confidential',
      document: null,
      sha256: null,
      supersededBy: null,
      revokedReason: null,
    });
  });

  it('answers an unknown code 404 not-found in the same shape', async () => {
    const unknown = newVerificationId();

    const response = await api.get(`/v1/verify/${unknown}`);

    expect(response.statusCode).toBe(404);
    const body = response.json<Record<string, unknown>>();
    expect(contractErrors(okResponse(VERIFY, 'get', 404), body)).toEqual([]);
    expect(body).toEqual({
      verificationId: unknown,
      status: 'not-found',
      disclosureLevel: null,
      document: null,
      sha256: null,
      supersededBy: null,
      revokedReason: null,
      checkedAt: expect.any(String) as string,
    });
  });

  it.each([
    ['too short', 'ADL-7Q4K-M2XR'],
    ['a letter outside the alphabet', 'ADL-7Q4K-M2XR-9HTC-2B7F-Q3ZD-9U'],
    ['punctuation', 'ADL-7Q4K-M2XR-9HTC-2B7F-Q3ZD-9%3B'],
    ['longer than 40 characters', `ADL-7Q4K-M2XR-9HTC-2B7F-Q3ZD-9K${'-'.repeat(10)}`],
  ])('rejects a malformed code (%s) with 400', async (_, code) => {
    const response = await api.get(`/v1/verify/${code}`);

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({ status: 400, type: 'malformed-verification-id' });
  });

  it('reads the code in any spelling a person may type', async () => {
    const slip = issuedData();
    await api.consumers.issued(issued(slip));
    const body = slip.verificationId.slice(4).replaceAll('-', '');
    const spellings = [
      slip.verificationId.toLowerCase(),
      body,
      encodeURIComponent(`adl ${body.slice(0, 13)} ${body.slice(13)}`),
      // Crockford look-alikes: O for 0, I and L for 1.
      slip.verificationId.replaceAll('0', 'O').replaceAll('1', 'l'),
    ];

    for (const spelling of spellings) {
      const response = await api.get(`/v1/verify/${spelling}`);
      expect(response.statusCode, spelling).toBe(200);
      expect(response.json(), spelling).toMatchObject({
        verificationId: slip.verificationId,
        status: 'valid',
      });
    }
  });
});

describe('S14 projection from the issuance events (inbox)', () => {
  let api: VerificationApi;

  beforeAll(async () => {
    api = await startVerificationApi();
  });

  afterAll(async () => {
    await api.close();
  });

  async function statusOf(verificationId: string): Promise<unknown> {
    const response = await api.get(`/v1/verify/${verificationId}`);
    return response.json<{ status: string }>().status;
  }

  it('applies a redelivered event once', async () => {
    const slip = issuedData();
    const event = issued(slip);
    await api.consumers.issued(event);
    const newer = issuedData();
    await api.consumers.issued(issued(newer));
    await api.consumers.superseded(superseded(slip, newer));

    // The broker delivers the issued event again (same id): the inbox skips it.
    await api.consumers.issued(event);

    expect(await statusOf(slip.verificationId)).toBe('superseded');
  });

  it('keeps the later status when events arrive out of order', async () => {
    const slip = issuedData();
    const newer = issuedData();
    await api.consumers.superseded(superseded(slip, newer));
    // A re-emitted issued event (new id) that is older than the supersession.
    await api.consumers.issued(issued(slip));

    const response = await api.get(`/v1/verify/${slip.verificationId}`);
    expect(response.json()).toMatchObject({
      status: 'superseded',
      supersededBy: newer.verificationId,
    });
  });

  it('keeps only the public-safe fields of the payload', async () => {
    const slip = issuedData();
    const leaky = {
      ...slip,
      publicPayload: { ...slipPayload(slip), declarantName: 'Wanjiru Kamau' },
    };
    await api.consumers.issued(issued(leaky));

    const [row] = await api.db
      .select()
      .from(verificationProjection)
      .where(eqId(slip.verificationId));
    expect(Object.keys(row?.publicPayload ?? {}).sort()).toEqual(
      ['issuedAt', 'issuerCode', 'issuerName', 'reference', 'type', 'version'].sort(),
    );
    expect(JSON.stringify(row)).not.toContain('Wanjiru');
    expect(JSON.stringify(row)).not.toContain(slip.subjectRef);
    expect(JSON.stringify(row)).not.toContain(slip.documentId);
  });

  it('rejects an event whose data does not parse, writing nothing', async () => {
    const slip = issuedData({ verificationId: 'not-a-code' });

    await expect(api.consumers.issued(issued(slip))).rejects.toThrow();
    const rows = await api.db.select().from(verificationProjection).where(eqId('not-a-code'));
    expect(rows).toEqual([]);
  });
});

function slipPayload(data: DocumentIssuedData): PublicPayload {
  if (!data.publicPayload) throw new Error('a restricted slip has a public payload');
  return data.publicPayload;
}

function eqId(verificationId: string) {
  return eq(verificationProjection.verificationId, verificationId);
}
