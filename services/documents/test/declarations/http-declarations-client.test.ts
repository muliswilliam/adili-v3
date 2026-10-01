import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  DeclarationsUnavailable,
  VersionNotFound,
} from '../../src/declarations/declarations-client.js';
import { HttpDeclarationsClient } from '../../src/declarations/http-declarations-client.js';

/**
 * The declarations client against answers that conform to the declarations contract (checked
 * here): the acknowledgement payload of a version, pulled acting for the Commission, and the
 * refusals the acknowledgement consumer acts on.
 */
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
const contract = createRequire(import.meta.url).resolve(
  '@adili/schemas/internal/declarations.yaml',
);
ajv.addSchema(parse(readFileSync(contract, 'utf8')) as object, 'declarations.yaml');

function conforming(schema: string, body: unknown): unknown {
  const validate = ajv.getSchema(`declarations.yaml#/components/schemas/${schema}`);
  if (!validate) throw new Error(`no ${schema}`);
  expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
  return body;
}

const DECLARATION_ID = '0192f1a0-5a11-7000-8000-000000000001';

const PAYLOAD = {
  declarantPersonId: '7d3f9b2a-4c1e-4a8b-9f60-2e5d8c1b0a47',
  slip: {
    declarantName: 'Achieng Wambui Otieno',
    commissionName: 'Public Service Commission',
    issuerCode: 'PSC',
    declarationType: 'biennial',
    statementDate: '2027-11-01',
    dueDate: '2027-12-31',
    reference: 'DCB-PSC-2027-0000001-1',
    version: 1,
    submittedAt: '2027-11-15T09:00:00.000Z',
    late: false,
    statementCount: 1,
    itemCount: 3,
  },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function clientAnswering(respond: () => Response) {
  const requests: { path: string; actingTenant: string | null; authorization: string | null }[] =
    [];
  const client = new HttpDeclarationsClient({
    declarationsUrl: 'http://declarations.test/',
    tokens: { token: () => Promise.resolve('token'), invalidate: () => undefined },
    fetch: (input: string | URL | Request) => {
      const request = input as Request;
      requests.push({
        path: new URL(request.url).pathname,
        actingTenant: request.headers.get('x-acting-tenant'),
        authorization: request.headers.get('authorization'),
      });
      return Promise.resolve(respond());
    },
  });
  return { client, requests };
}

describe('HttpDeclarationsClient', () => {
  it("pulls the version's acknowledgement payload for the Commission", async () => {
    const { client, requests } = clientAnswering(() =>
      json(conforming('AcknowledgementPayload', PAYLOAD)),
    );

    await expect(client.acknowledgementPayload('psc', DECLARATION_ID, 2)).resolves.toEqual(PAYLOAD);
    expect(requests).toEqual([
      {
        path: `/internal/v1/declarations/${DECLARATION_ID}/versions/2/acknowledgement-payload`,
        actingTenant: 'psc',
        authorization: 'Bearer token',
      },
    ]);
  });

  it('maps 404 to VersionNotFound', async () => {
    const { client } = clientAnswering(() => json({ type: 'about:blank', status: 404 }, 404));

    await expect(client.acknowledgementPayload('psc', DECLARATION_ID, 1)).rejects.toBeInstanceOf(
      VersionNotFound,
    );
  });

  it('refuses a payload the slip template would not take, or anything else, as unavailable', async () => {
    for (const answer of [
      json({ ...PAYLOAD, slip: { ...PAYLOAD.slip, reference: 'not a reference' } }),
      json({ ...PAYLOAD, slip: { ...PAYLOAD.slip, itemCount: undefined } }),
      json({ type: 'about:blank', status: 500 }, 500),
    ]) {
      const { client } = clientAnswering(() => answer);
      await expect(client.acknowledgementPayload('psc', DECLARATION_ID, 1)).rejects.toBeInstanceOf(
        DeclarationsUnavailable,
      );
    }
  });
});
