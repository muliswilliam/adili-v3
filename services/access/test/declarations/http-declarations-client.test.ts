import { describe, expect, it } from 'vitest';

import { HttpDeclarationsClient } from '../../src/declarations/http-declarations-client.js';

const PERSON = '7d3f9b2a-4c1e-4a8b-9f60-2e5d8c1b0a47';
const DECLARATION = '0b9c1a7e-2f4d-4e6a-8b3c-5d7e9f1a2b4c';

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

/** A client against a declarations service answering `answer`, recording what it was sent. */
function clientAnswering(answer: () => Response) {
  const sent: Sent[] = [];
  const client = new HttpDeclarationsClient({
    declarationsUrl: 'http://declarations.test',
    tokens: { token: () => Promise.resolve('internal-token'), invalidate: () => undefined },
    disclosureTokens: {
      token: () => Promise.resolve('disclosures-token'),
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

describe('HttpDeclarationsClient: full document for a certified copy', () => {
  it('asks for the version with who asked as acting subject and the recipient in the body', async () => {
    const { client, sent } = clientAnswering(() =>
      json({ declarationId: DECLARATION, version: 2, personId: PERSON }, 200),
    );

    await expect(
      client.fullDocument({
        tenant: 'psc',
        declarationId: DECLARATION,
        version: 2,
        personId: PERSON,
        actingSubject: 'officer-1',
        recipient: 'Joseph Kiprono',
      }),
    ).resolves.toMatchObject({ declarationId: DECLARATION, version: 2 });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.method).toBe('POST');
    expect(sent[0]?.url).toBe(
      `http://declarations.test/internal/v1/declarations/${DECLARATION}/versions/2/full-document`,
    );
    expect(sent[0]?.headers.get('x-acting-tenant')).toBe('psc');
    expect(sent[0]?.headers.get('x-acting-subject')).toBe('officer-1');
    expect(sent[0]?.headers.get('authorization')).toBe('Bearer disclosures-token');
    expect(JSON.parse(sent[0]?.body ?? 'null')).toEqual({
      personId: PERSON,
      recipient: 'Joseph Kiprono',
    });
  });

  it("a version that is not the declarant's is null", async () => {
    const { client } = clientAnswering(() => json({ status: 404 }, 404));

    await expect(
      client.fullDocument({
        tenant: 'psc',
        declarationId: DECLARATION,
        version: 2,
        personId: PERSON,
        actingSubject: 'officer-1',
        recipient: `person:${PERSON}`,
      }),
    ).resolves.toBeNull();
  });
});

describe('HttpDeclarationsClient: tokens', () => {
  it("asks for a grant's disclosure with the disclosures token, the officer as acting subject", async () => {
    const { client, sent } = clientAnswering(() =>
      json(
        {
          schemaVersion: 'disclosure.v1',
          grantReference: 'ARQ-PSC-2026-0000012-H',
          versions: [{ reference: 'DCB-PSC-2027-0000001-1', version: 1 }],
        },
        200,
      ),
    );

    await client.renderDisclosure({
      personId: PERSON,
      tenant: 'psc',
      officerSubject: 'officer-1',
      grantReference: 'ARQ-PSC-2026-0000012-H',
      legalBasis: 'act-s36-1',
      recipientSubject: 'applicant-1',
      years: [2027],
      includeSpouses: false,
      includeChildren: false,
      sections: ['assets'],
    });
    expect(sent[0]?.url).toBe('http://declarations.test/internal/v1/declarations/disclosures');
    expect(sent[0]?.headers.get('x-acting-subject')).toBe('officer-1');
    expect(sent[0]?.headers.get('authorization')).toBe('Bearer disclosures-token');
  });

  it("lists a declarant's versions with the internal token, decrypting nothing", async () => {
    const { client, sent } = clientAnswering(() => json([], 200));

    await expect(client.personVersions('psc', PERSON)).resolves.toEqual([]);
    expect(sent[0]?.headers.get('authorization')).toBe('Bearer internal-token');
  });
});
