import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { hasValidCheckCharacter } from '@adili/numbering';
import { APPLICANT, DECLARANT } from '@adili/roles';
import { sql } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { accessRegister, accessRequests, numberingCounters } from '../../src/db/schema.js';
import { type AccessApi, type Caller, startAccessApi } from '../support/access-api.js';
import { contractErrors, okResponse } from '../support/contract.js';

const fixtures = createRequire(import.meta.url);
const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(fixtures.resolve(`@adili/schemas/forms/fixtures/form-k.v1/${name}`), 'utf8'),
  );

const COMPLETE = fixture('valid/complete.json') as Record<string, unknown>;
const MISSING_REASON = fixture('invalid/missing-part-iii-reason.json') as {
  errors: string[];
  document: Record<string, unknown>;
};

const NOW = '2027-03-04T09:00:00.000Z';

describe('Form K submission (S2)', () => {
  let api: AccessApi;
  const applicant: Caller = {
    sub: 'applicant-mercy',
    roles: [APPLICANT],
    personId: randomUUID(),
    name: 'Mercy Wanjiku Kamau',
  };

  beforeAll(async () => {
    api = await startAccessApi();
    return () => api.close();
  });

  afterEach(() => api.reset());

  function submit(body: unknown, caller: Caller = applicant, key: string = randomUUID()) {
    return api.send('POST', '/v1/access/requests', caller, body, { 'idempotency-key': key });
  }

  function given(): void {
    api.directory.givenCommission('psc', 'Public Service Commission');
    api.clock.set(NOW);
  }

  it('S2: a verified applicant files Form K and gets an ARQ reference, a receipt in the register and an event', async () => {
    given();

    const response = await submit(COMPLETE);

    expect(response.statusCode).toBe(201);
    const body = response.json<Record<string, unknown>>();
    expect(contractErrors(okResponse('/v1/access/requests', 'post', 201), body)).toEqual([]);
    expect(body).toMatchObject({
      reference: expect.stringMatching(/^ARQ-PSC-2027-0000001-[0-9A-Z]$/) as unknown,
      commission: { slug: 'psc', name: 'Public Service Commission' },
      status: 'submitted',
      submittedAt: NOW,
      // Thirty days to decide (Act s.36).
      decisionDeadlineAt: '2027-04-03T09:00:00.000Z',
      decision: null,
      package: null,
      timeline: [
        { kind: 'received', at: NOW, actor: 'Mercy Wanjiku Kamau', summary: 'Request received' },
      ],
    });
    const reference = body.reference as string;
    expect(hasValidCheckCharacter(reference)).toBe(true);
    // The document as submitted, its meta filled by the service (not the applicant's own).
    expect(body.formK).toEqual({ ...COMPLETE, meta: { reference, submittedAt: NOW } });

    const [row] = await api.asPlatform((tx) => tx.select().from(accessRequests));
    expect(row).toMatchObject({
      tenant: 'psc',
      reference,
      applicantPersonId: applicant.personId,
      applicantSubject: 'applicant-mercy',
      applicantName: 'Mercy Wanjiku Kamau',
      applicantIdentityStatus: 'verified',
      officerSought: {
        name: 'Anne Njeri Mutua',
        entity: 'Ministry of Lands and Physical Planning',
        workStation: 'Ardhi House, Nairobi',
        personnelFileNumber: 'PF-2011-004512',
      },
      scope: COMPLETE.scope,
      status: 'submitted',
    });
    // The applicant's particulars and the Form K text are stored encrypted under the
    // Commission's key, bound to the request.
    expect(row?.formKCiphertext).not.toContain('Mercy');
    expect(row?.formKEnvelope.tenant).toBe('psc');
    expect(api.cipher.calls).toContainEqual({
      operation: 'encrypt',
      tenant: 'psc',
      recordId: `access-request:${String(body.id)}`,
    });

    const entries = await api.asPlatform((tx) => tx.select().from(accessRegister));
    expect(entries).toEqual([
      expect.objectContaining({
        tenant: 'psc',
        subjectKind: 'access-request',
        subjectId: body.id,
        reference,
        personId: null,
        kind: 'received',
        actor: 'applicant-mercy',
        legalBasis: 'act-s36-1',
      }),
    ]);

    const events = await api.events('access.request.received.v1');
    expect(events).toEqual([
      expect.objectContaining({
        tenant: 'psc',
        subject: body.id,
        data: {
          registerEntryId: entries[0]?.id,
          subjectKind: 'access-request',
          subjectId: body.id,
          reference,
          tenant: 'psc',
          kind: 'received',
          legalBasis: 'act-s36-1',
          personId: null,
          actor: 'applicant-mercy',
          at: NOW,
          decisionDeadlineAt: '2027-04-03T09:00:00.000Z',
        },
      }),
    ]);
    // Identifiers only: nothing the applicant wrote reaches the event.
    expect(JSON.stringify(events)).not.toMatch(/Mercy|Njeri|journalist|land allocations/);
  });

  it('S2: references run on per Commission and year', async () => {
    given();
    api.directory.givenCommission('tsc', 'Teachers Service Commission');

    const first = await submit(COMPLETE);
    const second = await submit(COMPLETE);
    const other = await submit({ ...COMPLETE, responsibleCommission: 'tsc' });

    expect(first.json<{ reference: string }>().reference).toMatch(/^ARQ-PSC-2027-0000001-/);
    expect(second.json<{ reference: string }>().reference).toMatch(/^ARQ-PSC-2027-0000002-/);
    expect(other.json<{ reference: string }>().reference).toMatch(/^ARQ-TSC-2027-0000001-/);
  });

  it('S2: an invalid document is 400 with the paths at fault, and nothing is stored', async () => {
    given();

    const response = await submit(MISSING_REASON.document);

    expect(response.statusCode).toBe(400);
    const problem = response.json<{ errors: { path: string; message: string }[] }>();
    expect(problem.errors.map((error) => error.path)).toEqual(MISSING_REASON.errors);
    await expectNothingStored();
  });

  it('S2: a document that is not an object is 400', async () => {
    given();

    const response = await submit([COMPLETE]);

    expect(response.statusCode).toBe(400);
    await expectNothingStored();
  });

  it('S2: Form K addressed to no Responsible Commission is 400 at responsibleCommission', async () => {
    given();

    for (const responsibleCommission of ['ghost', 'platform']) {
      const response = await submit({ ...COMPLETE, responsibleCommission });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        errors: [{ path: 'responsibleCommission', message: 'is not a Responsible Commission' }],
      });
    }
    await expectNothingStored();
  });

  it('a retry with the same Idempotency-Key gets the same request, filed once', async () => {
    given();
    const key = randomUUID();

    const first = await submit(COMPLETE, applicant, key);
    const retry = await submit(COMPLETE, applicant, key);

    expect(retry.statusCode).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.json()).toEqual(first.json());
    expect(await api.asPlatform((tx) => tx.select().from(accessRequests))).toHaveLength(1);
  });

  it('without an Idempotency-Key the submission is refused', async () => {
    given();

    const response = await api.send('POST', '/v1/access/requests', applicant, COMPLETE);

    expect(response.statusCode).toBe(400);
    await expectNothingStored();
  });

  it('only applicants file Form K: a declarant gets 403', async () => {
    given();

    const response = await submit(COMPLETE, {
      sub: 'declarant-1',
      roles: [DECLARANT],
      personId: randomUUID(),
    });

    expect(response.statusCode).toBe(403);
    await expectNothingStored();
  });

  it('an applicant account without a person record gets 403 no-applicant-record', async () => {
    given();

    const response = await submit(COMPLETE, { sub: 'applicant-new', roles: [APPLICANT] });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'no-applicant-record' });
    await expectNothingStored();
  });

  it('the directory down is 503 and nothing is stored', async () => {
    given();
    api.directory.failCalls(1);

    const response = await submit(COMPLETE);

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ type: 'directory-unavailable' });
    await expectNothingStored();
  });

  it('the key service down is 503 and nothing is stored', async () => {
    given();
    api.cipher.unavailable = true;

    const response = await submit(COMPLETE);

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ type: 'key-service-unavailable' });
    await expectNothingStored();
  });

  it('the request, its register entry, its event and its reference commit together or not at all', async () => {
    given();
    // A failing outbox write, the last write of the transaction.
    const trigger = `${api.pgSchema}.access_test_refuse_outbox`;
    await api.db.execute(
      sql.raw(`create function ${trigger}() returns trigger language plpgsql as $$
        begin raise exception 'outbox refused'; end; $$`),
    );
    await api.db.execute(
      sql.raw(`create trigger refuse_outbox before insert on ${api.pgSchema}.outbox
        for each row execute function ${trigger}()`),
    );
    try {
      const response = await submit(COMPLETE);

      expect(response.statusCode).toBe(500);
      await expectNothingStored();
    } finally {
      await api.db.execute(sql.raw(`drop trigger refuse_outbox on ${api.pgSchema}.outbox`));
      await api.db.execute(sql.raw(`drop function ${trigger}()`));
    }

    // The number was not used up: the next request still gets the first one.
    const next = await submit(COMPLETE);
    expect(next.json<{ reference: string }>().reference).toMatch(/^ARQ-PSC-2027-0000001-/);
  });

  async function expectNothingStored(): Promise<void> {
    await api.asPlatform(async (tx) => {
      expect(await tx.select().from(accessRequests)).toEqual([]);
      expect(await tx.select().from(accessRegister)).toEqual([]);
      expect(await tx.select().from(numberingCounters)).toEqual([]);
    });
    expect(await api.events()).toEqual([]);
  }
});
