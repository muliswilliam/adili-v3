import { describe, expect, it } from 'vitest';

import { DirectoryUnavailable } from '../../src/directory/directory-client.js';
import { HttpDirectoryClient } from '../../src/directory/http-directory-client.js';

const PERSON = '7d3f9b2a-4c1e-4a8b-9f60-2e5d8c1b0a47';
const KEY = '4b0f3c8e-5d6a-5e7f-8a9b-0c1d2e3f4a5b';

const APPLICANT = {
  personId: PERSON,
  fullName: 'Daniel Otieno',
  identityDocument: { kind: 'passport', number: 'AK123456', country: 'UG' },
  identityStatus: 'pending-verification',
  contacts: { email: 'd.otieno@example.org', phone: '+256772123456' },
  identityVerifiedAt: null,
  identityVerifiedBy: null,
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

interface Sent {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
}

/** A client against a directory answering `answer`, recording what it was sent. */
function clientAnswering(answer: () => Response) {
  const sent: Sent[] = [];
  const client = new HttpDirectoryClient({
    directoryUrl: 'http://directory.test',
    tokens: { token: () => Promise.resolve('reference-token'), invalidate: () => undefined },
    applicantTokens: {
      token: () => Promise.resolve('applicants-token'),
      invalidate: () => undefined,
    },
    fetch: async (input: Request | string | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      sent.push({
        url: request.url,
        method: request.method,
        headers: request.headers,
        body: request.body === null ? null : await request.text(),
      });
      return answer();
    },
  });
  return { client, sent };
}

describe('HttpDirectoryClient: applicants', () => {
  it("reads an applicant's identity status for the Commission, with the applicants token", async () => {
    const { client, sent } = clientAnswering(() => json(APPLICANT, 200));

    await expect(client.applicant(PERSON, 'psc')).resolves.toEqual({
      personId: PERSON,
      identityStatus: 'pending-verification',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.method).toBe('GET');
    expect(sent[0]?.url).toBe(`http://directory.test/internal/v1/applicants/${PERSON}`);
    expect(sent[0]?.headers.get('x-acting-tenant')).toBe('psc');
    expect(sent[0]?.headers.get('authorization')).toBe('Bearer applicants-token');
  });

  it('an unknown applicant is null', async () => {
    const { client } = clientAnswering(() => json({ status: 404 }, 404));

    await expect(client.applicant(PERSON, 'psc')).resolves.toBeNull();
  });

  it('records a verification with the officer, the Commission and the key', async () => {
    const { client, sent } = clientAnswering(() =>
      json({ ...APPLICANT, identityStatus: 'verified' }, 200),
    );

    await expect(
      client.verifyApplicantIdentity({
        personId: PERSON,
        tenant: 'psc',
        verifiedBy: 'officer-psc',
        idempotencyKey: KEY,
      }),
    ).resolves.toEqual({ personId: PERSON, identityStatus: 'verified' });
    expect(sent[0]?.method).toBe('POST');
    expect(sent[0]?.url).toBe(
      `http://directory.test/internal/v1/applicants/${PERSON}/identity-verification`,
    );
    expect(sent[0]?.headers.get('x-acting-tenant')).toBe('psc');
    expect(sent[0]?.headers.get('idempotency-key')).toBe(KEY);
    expect(sent[0]?.headers.get('authorization')).toBe('Bearer applicants-token');
    expect(JSON.parse(sent[0]?.body ?? '')).toEqual({ verifiedBy: 'officer-psc' });
  });

  it('the account not changed (502 identity-unavailable) is an outage the caller retries', async () => {
    const { client } = clientAnswering(() =>
      json({ code: 'identity-unavailable', status: 502 }, 502),
    );

    await expect(
      client.verifyApplicantIdentity({
        personId: PERSON,
        tenant: 'psc',
        verifiedBy: 'officer-psc',
        idempotencyKey: KEY,
      }),
    ).rejects.toBeInstanceOf(DirectoryUnavailable);
  });

  it('reference data still goes with the reference token', async () => {
    const { client, sent } = clientAnswering(() =>
      json({ slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' }, 200),
    );

    await client.findCommission('psc');

    expect(sent[0]?.headers.get('authorization')).toBe('Bearer reference-token');
  });
});

describe('HttpDirectoryClient: roster search', () => {
  const RECORD = {
    id: '0199c000-0000-7000-8000-0000000000a1',
    tenant: 'psc',
    personnelFileNumber: 'PSC/0101',
    fullName: 'Anne Njeri Mutua',
    designation: 'Senior Officer',
    jobGroup: 'L',
    reportingEntity: { id: '0199c000-0000-7000-8000-0000000000e1', name: 'State Department' },
    state: 'onboarded',
    appointmentDate: null,
    exitDate: null,
    personId: PERSON,
    ofr: null,
    onboardedAt: '2027-01-04T09:00:00.000Z',
    updatedAt: '2027-01-04T09:00:00.000Z',
  };

  it("searches the Commission's roster with the reference token, at most 20 records", async () => {
    const { client, sent } = clientAnswering(() =>
      json(
        {
          items: [RECORD, { ...RECORD, personId: null, reportingEntity: null }],
          nextCursor: null,
        },
        200,
      ),
    );

    await expect(client.searchRoster('psc', 'Anne Njeri')).resolves.toEqual([
      {
        id: RECORD.id,
        personnelFileNumber: 'PSC/0101',
        fullName: 'Anne Njeri Mutua',
        personId: PERSON,
        designation: 'Senior Officer',
        reportingEntityName: 'State Department',
        state: 'onboarded',
      },
      expect.objectContaining({ personId: null, reportingEntityName: null }),
    ]);
    const url = new URL(sent[0]?.url ?? '');
    expect(url.pathname).toBe('/internal/v1/commissions/psc/roster/records');
    expect(url.searchParams.get('search')).toBe('Anne Njeri');
    expect(url.searchParams.get('limit')).toBe('20');
    expect(sent[0]?.headers.get('x-acting-tenant')).toBe('psc');
    expect(sent[0]?.headers.get('authorization')).toBe('Bearer reference-token');
  });

  it('is unavailable when the directory fails', async () => {
    const { client } = clientAnswering(() => json({}, 503));

    await expect(client.searchRoster('psc', 'Anne')).rejects.toBeInstanceOf(DirectoryUnavailable);
  });
});

describe('HttpDirectoryClient: staff by role', () => {
  it("lists the Commission's access officers, acting for it", async () => {
    const officer = { subject: 'officer-1', email: 'access.officer@psc.go.ke' };
    const { client, sent } = clientAnswering(() => json({ items: [officer] }, 200));

    await expect(client.staffWithRole('psc', 'access-officer')).resolves.toEqual([officer]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.method).toBe('GET');
    expect(sent[0]?.url).toBe(
      'http://directory.test/internal/v1/commissions/psc/staff?role=access-officer',
    );
    expect(sent[0]?.headers.get('x-acting-tenant')).toBe('psc');
    expect(sent[0]?.headers.get('authorization')).toBe('Bearer reference-token');
  });
});

describe('HttpDirectoryClient: Commission list', () => {
  it('reads every Commission with its status and earliest obligations start, acting for none', async () => {
    const psc = {
      slug: 'psc',
      issuerCode: 'PSC',
      name: 'Public Service Commission',
      status: 'active',
      obligationsStartDate: '2025-07-01',
    };
    const { client, sent } = clientAnswering(() => json({ items: [psc] }, 200));

    await expect(client.listCommissions()).resolves.toEqual([psc]);
    expect(sent[0]?.url).toBe('http://directory.test/internal/v1/commissions');
    expect(sent[0]?.headers.get('x-acting-tenant')).toBeNull();
    expect(sent[0]?.headers.get('authorization')).toBe('Bearer reference-token');
  });

  it('an answer outside the contract is an outage the caller retries', async () => {
    const { client } = clientAnswering(() =>
      json({ items: [{ slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' }] }, 200),
    );

    await expect(client.listCommissions()).rejects.toBeInstanceOf(DirectoryUnavailable);
  });
});

describe('HttpDirectoryClient: law enforcement officers', () => {
  const OFFICER = {
    personId: PERSON,
    keycloakUserId: 'kc-peter',
    name: 'Peter Mwangi',
    agency: {
      code: 'DCI',
      name: 'Directorate of Criminal Investigations',
      legalBasis: 'National Police Service Act, 2011, s.35',
    },
    state: 'activated',
    activatedAt: '2027-01-04T07:00:00.000Z',
    revokedAt: null,
  };

  it("reads an officer's account and agency for the Commission addressed, with the reference token", async () => {
    const { client, sent } = clientAnswering(() => json(OFFICER, 200));

    await expect(client.leaOfficer(PERSON, 'psc')).resolves.toEqual({
      personId: PERSON,
      keycloakUserId: 'kc-peter',
      name: 'Peter Mwangi',
      agency: OFFICER.agency,
      state: 'activated',
      activatedAt: new Date('2027-01-04T07:00:00.000Z'),
    });
    expect(sent[0]?.url).toBe(
      `http://directory.test/internal/v1/law-enforcement/officers/${PERSON}`,
    );
    expect(sent[0]?.headers.get('x-acting-tenant')).toBe('psc');
    expect(sent[0]?.headers.get('authorization')).toBe('Bearer reference-token');
  });

  it('an unknown officer is null; an answer outside the contract is an outage', async () => {
    const unknown = clientAnswering(() => json({ status: 404 }, 404));
    const broken = clientAnswering(() => json({ ...OFFICER, state: 'lost' }, 200));

    await expect(unknown.client.leaOfficer(PERSON, 'psc')).resolves.toBeNull();
    await expect(broken.client.leaOfficer(PERSON, 'psc')).rejects.toBeInstanceOf(
      DirectoryUnavailable,
    );
  });
});
