import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { CLR, format } from '@adili/numbering/references';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { clarificationLetterPayload } from '../../src/issuance/templates/clarification-letter.v1.js';
import { HttpReviewClient } from '../../src/review/http-review-client.js';
import { ClarificationNotFound, ReviewUnavailable } from '../../src/review/review-client.js';

/**
 * The review client against answers that conform to the review contract (checked here): a
 * clarification's letter payload, pulled acting for the Commission, and the refusals issuance
 * acts on.
 */
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
const contract = createRequire(import.meta.url).resolve('@adili/schemas/internal/review.yaml');
ajv.addSchema(parse(readFileSync(contract, 'utf8')) as object, 'review.yaml');

function conforming(schema: string, body: unknown): unknown {
  const validate = ajv.getSchema(`review.yaml#/components/schemas/${schema}`);
  if (!validate) throw new Error(`no ${schema}`);
  expect(validate(body), JSON.stringify(validate.errors)).toBe(true);
  return body;
}

const CLARIFICATION_ID = '0192f1a0-5a11-7000-8000-000000000001';

const PAYLOAD = {
  declarantPersonId: '0192f1a0-5a11-7000-8000-0000000000d1',
  declarantName: 'Achieng Wambui Otieno',
  commission: { name: 'Public Service Commission', issuerCode: 'PSC' },
  declarationReference: 'DCB-PSC-2027-0000001-1',
  clarificationReference: format(CLR, { issuer: 'PSC', period: 2028, sequence: 451 }),
  language: 'en',
  opening: null,
  aiAssisted: false,
  items: [
    {
      label: 'Assets · Plot KSM/123 · Achieng Wambui Otieno',
      requirementLabel: 'Explain the discrepancy or inconsistency',
      text: 'Please explain the value declared.',
      aiAssisted: false,
    },
  ],
  issuedAt: '2028-02-01T07:00:00.000Z',
  dueAt: '2028-03-02T07:00:00.000Z',
  portalUrl: `http://localhost:3010/clarifications/${CLARIFICATION_ID}`,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function clientAnswering(respond: () => Response) {
  const requests: { path: string; actingTenant: string | null; authorization: string | null }[] =
    [];
  const client = new HttpReviewClient({
    reviewUrl: 'http://review.test/',
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

describe('HttpReviewClient', () => {
  it("pulls the clarification's letter payload for the Commission, which the template takes", async () => {
    const { client, requests } = clientAnswering(() =>
      json(conforming('ClarificationLetterPayload', PAYLOAD)),
    );

    const payload = await client.clarificationLetterPayload('psc', CLARIFICATION_ID);

    expect(payload).toEqual(PAYLOAD);
    expect(clarificationLetterPayload.safeParse(payload).error).toBeUndefined();
    expect(requests).toEqual([
      {
        path: `/internal/v1/review/clarifications/${CLARIFICATION_ID}/letter-payload`,
        actingTenant: 'psc',
        authorization: 'Bearer token',
      },
    ]);
  });

  it('maps 404 to ClarificationNotFound', async () => {
    const { client } = clientAnswering(() => json({ type: 'about:blank', status: 404 }, 404));

    await expect(client.clarificationLetterPayload('psc', CLARIFICATION_ID)).rejects.toBeInstanceOf(
      ClarificationNotFound,
    );
  });

  it('refuses anything but a JSON object, or another status, as unavailable', async () => {
    for (const answer of [
      json(['not', 'an', 'object']),
      json({ type: 'about:blank', status: 500 }, 500),
      json({ type: 'about:blank', status: 403 }, 403),
    ]) {
      const { client } = clientAnswering(() => answer);
      await expect(
        client.clarificationLetterPayload('psc', CLARIFICATION_ID),
      ).rejects.toBeInstanceOf(ReviewUnavailable);
    }
  });
});
