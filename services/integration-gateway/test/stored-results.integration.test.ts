import { randomUUID } from 'node:crypto';

import { asc, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { outbox, verificationResults } from '../src/db/schema.js';

import { SEED, StubRegistries } from './support/stub-registries.js';
import { createTestApp, type TestApp } from './support/test-app.js';

/** A matcher typed `unknown`, so it sits in typed objects. */
const isoDateTime = (): unknown => expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/);

/** The stored result read: decrypted for the lookup's own tenant, 404 for any other, audited. */
describe('GET /internal/v1/verification-results/{resultId}', () => {
  let registries: StubRegistries;
  let t: TestApp;
  let token: string;

  const headers = (tenant = 'psc') => ({
    authorization: `Bearer ${token}`,
    'x-acting-tenant': tenant,
  });

  beforeAll(async () => {
    registries = await StubRegistries.start();
    t = await createTestApp({ registryUrls: registries.urls });
    t.app.useLogger(false);
    token = await t.token({ clientId: 'review', scope: 'registry' });
    return async () => {
      await t.close();
      await registries.close();
    };
  });

  beforeEach(async () => {
    registries.reset();
    t.cipher.unavailable = false;
    await t.clearCache();
    await t.db.delete(verificationResults);
    await t.db.delete(outbox);
  });

  const lookup = async (path: string, nationalId: string) =>
    (
      await t.app.inject({
        method: 'POST',
        url: `/internal/v1/${path}`,
        headers: { ...headers(), 'x-legal-basis': 'regs-r20-1-b', 'x-case-ref': 'case-0001' },
        payload: { nationalId },
      })
    ).json<{ resultId: string } & Record<string, unknown>>();

  const read = (resultId: string, tenant = 'psc') =>
    t.app.inject({
      method: 'GET',
      url: `/internal/v1/verification-results/${resultId}`,
      headers: headers(tenant),
    });

  const audits = async () =>
    (
      await t.db
        .select()
        .from(outbox)
        .where(eq(outbox.eventType, 'audit.read.v1'))
        .orderBy(asc(outbox.id))
    ).map(({ envelope }) => envelope);

  it('returns the decrypted records for a service of the same tenant', async () => {
    const result = await lookup('ntsa/vehicle-lookups', SEED.wanjiku);

    const response = await read(result.resultId);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      resultId: result.resultId,
      system: 'ntsa',
      outcome: 'found',
      checkedAt: isoDateTime(),
      legalBasis: 'regs-r20-1-b',
      caseRef: 'case-0001',
      payload: { vehicles: result.vehicles },
    });
  });

  it('returns a lookup that found nothing without a payload', async () => {
    const result = await lookup('kra/taxpayer-lookups', SEED.imani);

    const response = await read(result.resultId);

    expect(response.json()).toMatchObject({ outcome: 'not-found', payload: null });
  });

  it('answers 404 for another tenant, an unknown id, or a lookup for no tenant', async () => {
    const result = await lookup('kra/taxpayer-lookups', SEED.wanjiku);
    await t.db
      .update(verificationResults)
      .set({ tenant: null })
      .where(eq(verificationResults.id, result.resultId));
    const own = await lookup('brs/directorship-lookups', SEED.wanjiku);

    expect((await read(own.resultId, 'jsc')).statusCode).toBe(404);
    expect((await read(randomUUID())).statusCode).toBe(404);
    expect((await read(result.resultId)).statusCode).toBe(404);
    expect(await audits()).toEqual([]);
  });

  it('audits each read under the tenant, naming the result and the service', async () => {
    const result = await lookup('ardhisasa/parcel-lookups', SEED.wanjiku);

    await read(result.resultId);

    const [audit, ...more] = await audits();
    expect(more).toEqual([]);
    expect(audit).toMatchObject({
      type: 'audit.read.v1',
      tenant: 'psc',
      data: {
        action: 'verification-result.read',
        resource: { type: 'verification-result', params: { resultId: result.resultId } },
        actor: { clientId: 'review' },
        outcome: 'success',
      },
    });
    expect(JSON.stringify(audit)).not.toContain('KAJIADO');
  });

  it('answers 503 when the payload cannot be decrypted now', async () => {
    const result = await lookup('ntsa/vehicle-lookups', SEED.wanjiku);
    t.cipher.unavailable = true;

    const response = await read(result.resultId);

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ type: 'upstream-unavailable' });
  });

  it('requires the registry scope and a uuid', async () => {
    const result = await lookup('ntsa/vehicle-lookups', SEED.wanjiku);
    const other = await t.token({ clientId: 'directory', scope: 'iprs' });

    const refused = await t.app.inject({
      method: 'GET',
      url: `/internal/v1/verification-results/${result.resultId}`,
      headers: { authorization: `Bearer ${other}`, 'x-acting-tenant': 'psc' },
    });

    expect(refused.statusCode).toBe(403);
    expect((await read('not-a-uuid')).statusCode).toBe(400);
  });
});
