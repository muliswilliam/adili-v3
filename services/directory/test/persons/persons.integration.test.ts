import { checkCharacter } from '@adili/numbering';
import { asc, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { outbox } from '../../src/db/schema.js';
import type { DeclarantProfile, PersonSummary } from '../../src/persons/representation.js';
import { contractErrors, okResponse } from '../support/contract.js';
import { type Caller, type DirectoryApi, startDirectoryApi } from '../support/directory-api.js';
import { givenCommissions } from '../support/fixtures.js';
import { givenOnboardedPerson, givenRoster, type OnboardedPerson } from '../support/onboarding.js';
import type { Problem } from '../support/reporting-officers.js';

/**
 * Spec 03 S18 over HTTP: a declarant reads their own profile (`GET /v1/me/declarant`) by the
 * subject of their token; and the helpdesk looks a person up by officer reference
 * (`GET /v1/persons?ofr=`), account metadata only. Persons are arranged as confirm leaves them.
 */

const NOW = new Date('2026-10-01T09:00:00Z');
const PROFILE = '/v1/me/declarant';
const lookup = (ofr: string) => `/v1/persons?ofr=${encodeURIComponent(ofr)}`;

const HELPDESK: Caller = { sub: 'helpdesk-1', tenant: 'platform', roles: ['helpdesk'] };
const PLATFORM_ADMIN: Caller = { sub: 'admin-1', tenant: 'platform', roles: ['platform-admin'] };
const TSC_OFFICER: Caller = { sub: 'officer-tsc', tenant: 'tsc', roles: ['reporting-officer'] };
const EACC_ANALYST: Caller = { sub: 'analyst-1', tenant: 'eacc', roles: ['eacc-analyst'] };

let api: DirectoryApi;
let wanjiru: OnboardedPerson;
let ids: { tsc: Map<string, string>; psc: Map<string, string> };

const declarant = (person: OnboardedPerson): Caller => ({
  sub: person.keycloakUserId,
  tenant: 'tsc',
  roles: ['declarant'],
  azp: 'portal',
});

beforeAll(async () => {
  api = await startDirectoryApi();
  return () => api.close();
});

beforeEach(async () => {
  await api.reset();
  api.clock.set(NOW);
  await givenCommissions(api.db, [
    { slug: 'tsc', name: 'Teachers Service Commission' },
    { slug: 'psc', name: 'Public Service Commission' },
  ]);
  ids = {
    tsc: await givenRoster(api, 'tsc', [
      {
        personnelFileNumber: 'TSC/100200',
        fullName: 'Wanjiru Kamau',
        nationalId: '34567890',
        designation: 'Teacher',
        reportingEntity: 'Alliance Girls High School',
        email: 'wanjiru.kamau@example.go.ke',
        phone: '+254712345678',
      },
      { personnelFileNumber: 'TSC/100201', fullName: 'Otieno James', nationalId: '56789012' },
    ]),
    psc: await givenRoster(api, 'psc', [
      { personnelFileNumber: 'PSC/2019/0001', fullName: 'Daudi Kiprop', nationalId: '44556677' },
    ]),
  };
  wanjiru = await givenOnboardedPerson(api, {
    recordIds: [ids.tsc.get('TSC/100200') ?? ''],
    email: 'wanjiru.kamau@example.go.ke',
    phone: '+254712345678',
  });
});

describe('GET /v1/me/declarant (S18)', () => {
  it("returns the token subject's person: Commission, OFR, roster record summary, onboarded at, verified contacts", async () => {
    const response = await api.get(PROFILE, declarant(wanjiru));

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<DeclarantProfile>();
    expect(contractErrors(okResponse(PROFILE, 'get'), body)).toEqual([]);
    expect(body).toEqual({
      personId: wanjiru.personId,
      ofr: wanjiru.ofr,
      fullName: 'Wanjiru Kamau',
      contacts: { email: 'wanjiru.kamau@example.go.ke', phone: '+254712345678' },
      commissions: [
        {
          slug: 'tsc',
          name: 'Teachers Service Commission',
          personnelFileNumber: 'TSC/100200',
          rosterRecordId: ids.tsc.get('TSC/100200'),
          state: 'onboarded',
          onboardedAt: NOW.toISOString(),
        },
      ],
    });
    expect(body.ofr).toMatch(/^OFR-\d{7}-[0-9A-Z]$/);
  });

  it('lists every Commission the person is linked to, by name', async () => {
    await api.reset();
    await givenCommissions(api.db, [
      { slug: 'tsc', name: 'Teachers Service Commission' },
      { slug: 'psc', name: 'Public Service Commission' },
    ]);
    const tsc = await givenRoster(api, 'tsc', [
      { personnelFileNumber: 'TSC/9', fullName: 'Achieng Otieno', nationalId: '11223344' },
    ]);
    const psc = await givenRoster(api, 'psc', [
      { personnelFileNumber: 'PSC/9', fullName: 'Achieng Otieno', nationalId: '11223344' },
    ]);
    const person = await givenOnboardedPerson(api, {
      recordIds: [tsc.get('TSC/9') ?? '', psc.get('PSC/9') ?? ''],
    });

    const response = await api.get(PROFILE, declarant(person));

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<DeclarantProfile>();
    expect(body.commissions.map((commission) => commission.slug)).toEqual(['psc', 'tsc']);
    expect(body.contacts).toEqual({ email: null, phone: null });
  });

  it('is 404 for a declarant account without an onboarded person', async () => {
    const response = await api.get(PROFILE, {
      sub: 'someone-else',
      tenant: 'tsc',
      roles: ['declarant'],
    });

    expect(response.statusCode, response.body).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
  });

  it('is 403 for a caller without the declarant role, even as the person', async () => {
    for (const caller of [
      TSC_OFFICER,
      HELPDESK,
      // The person's own account, were it to lose the declarant role.
      { ...declarant(wanjiru), roles: ['reviewer'] },
    ]) {
      const response = await api.get(PROFILE, caller);
      expect(response.statusCode, response.body).toBe(403);
      expect(response.headers['content-type']).toContain('application/problem+json');
    }
  });

  it('is 401 without a token', async () => {
    const response = await api.anonymous({ url: PROFILE });
    expect(response.statusCode).toBe(401);
  });
});

describe('GET /v1/persons?ofr=', () => {
  it('gives the helpdesk and platform admins account metadata, no roster contents, audited', async () => {
    // Another person, who must not show up.
    const daudi = await givenOnboardedPerson(api, {
      recordIds: [ids.psc.get('PSC/2019/0001') ?? ''],
    });
    for (const caller of [HELPDESK, PLATFORM_ADMIN]) {
      const response = await api.get(lookup(wanjiru.ofr), caller);

      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<PersonSummary>();
      expect(contractErrors(okResponse('/v1/persons', 'get'), body)).toEqual([]);
      expect(body).toEqual({
        personId: wanjiru.personId,
        ofr: wanjiru.ofr,
        fullName: 'Wanjiru Kamau',
        commissions: ['tsc'],
        contactsOnFile: { email: true, phone: true },
        createdAt: NOW.toISOString(),
      });
      // No roster contents: file numbers, national IDs, contacts, designations.
      expect(response.body).not.toMatch(
        /TSC\/100200|34567890|example\.go\.ke|254712345678|Teacher/,
      );
    }
    expect(daudi.ofr).not.toBe(wanjiru.ofr);

    const audited = await api.db
      .select({ envelope: outbox.envelope })
      .from(outbox)
      .where(eq(outbox.eventType, 'audit.read.v1'))
      // In the order recorded: without one, rows come back in any order (the outbox relay
      // updating a row moves it).
      .orderBy(asc(outbox.id));
    expect(audited.map(({ envelope }) => envelope.data)).toMatchObject([
      {
        action: 'person.looked-up',
        resource: { type: 'person' },
        actor: { subject: 'helpdesk-1' },
      },
      { action: 'person.looked-up', resource: { type: 'person' }, actor: { subject: 'admin-1' } },
    ]);
  });

  it('lists each Commission a person is linked to once', async () => {
    await api.reset();
    await givenCommissions(api.db, [
      { slug: 'tsc', name: 'Teachers Service Commission' },
      { slug: 'psc', name: 'Public Service Commission' },
    ]);
    const tsc = await givenRoster(api, 'tsc', [
      { personnelFileNumber: 'TSC/9', fullName: 'Achieng Otieno', nationalId: '11223344' },
    ]);
    const psc = await givenRoster(api, 'psc', [
      { personnelFileNumber: 'PSC/9', fullName: 'Achieng Otieno', nationalId: '11223344' },
    ]);
    const person = await givenOnboardedPerson(api, {
      recordIds: [tsc.get('TSC/9') ?? '', psc.get('PSC/9') ?? ''],
    });

    const response = await api.get(lookup(person.ofr), HELPDESK);

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<PersonSummary>().commissions).toEqual(['psc', 'tsc']);
    // Roster rows without contacts leave none verified on file.
    expect(response.json<PersonSummary>().contactsOnFile).toEqual({ email: false, phone: false });
  });

  it('is 404 for a well-formed OFR no person has', async () => {
    const sequence = '9999999';
    const unknown = `OFR-${sequence}-${checkCharacter(`OFR-${sequence}`)}`;

    const response = await api.get(lookup(unknown), HELPDESK);

    expect(response.statusCode, response.body).toBe(404);
  });

  it('is 400 for a wrong check character or shape, before any lookup', async () => {
    const wrongCheck = wanjiru.ofr.slice(0, -1) + (wanjiru.ofr.endsWith('A') ? 'B' : 'A');
    for (const ofr of [wrongCheck, 'OFR-123-A', 'ofr-0000001-x', '']) {
      const response = await api.get(lookup(ofr), HELPDESK);
      expect(response.statusCode, `${ofr}: ${response.body}`).toBe(400);
      expect(response.json<Problem>().errors).toEqual([expect.objectContaining({ path: 'ofr' })]);
    }
    const missing = await api.get('/v1/persons', HELPDESK);
    expect(missing.statusCode).toBe(400);
  });

  it('is 403 for everyone else, declarants included', async () => {
    for (const caller of [TSC_OFFICER, EACC_ANALYST, declarant(wanjiru)]) {
      const response = await api.get(lookup(wanjiru.ofr), caller);
      expect(response.statusCode, response.body).toBe(403);
    }
  });
});
