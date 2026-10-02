import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { ADM, CLR, CMP, format, RFL } from '@adili/numbering/references';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { noticeToComplyV1 } from '../../src/issuance/templates/action-letters.v1.js';
import { clarificationLetterPayload } from '../../src/issuance/templates/clarification-letter.v1.js';
import { decisionLetterPayload } from '../../src/issuance/templates/decision-letter.v1.js';
import { referralPackagePayload } from '../../src/issuance/templates/referral-package.v1.js';
import { HttpReviewClient } from '../../src/review/http-review-client.js';
import {
  type ReviewRecord,
  ReviewRecordNotFound,
  ReviewUnavailable,
} from '../../src/review/review-client.js';

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

const RECORD_ID = '0192f1a0-5a11-7000-8000-000000000002';
const COMMISSION = { name: 'Public Service Commission', issuerCode: 'PSC' };

const DETERMINATION_PAYLOAD = {
  declarantPersonId: '0192f1a0-5a11-7000-8000-0000000000d1',
  declarantName: 'Achieng Wambui Otieno',
  commission: COMMISSION,
  declarationReference: 'DCB-PSC-2027-0000001-1',
  determinationReference: format(CMP, { issuer: 'PSC', period: 2027, sequence: 1 }),
  outcome: 'non-compliant',
  outcomeLabel: 'Non-compliant',
  reasons: 'The declared value of the plot does not match the sale agreement.',
  decidedAt: '2027-12-20T08:00:00.000Z',
  portalUrl: `http://localhost:3010/decisions/${RECORD_ID}`,
};

const ACTION_PAYLOAD = {
  declarantPersonId: null,
  declarantName: 'Achieng Wambui Otieno',
  personnelFileNumber: 'PSC/2019/0042',
  commission: COMMISSION,
  reference: format(ADM, { issuer: 'PSC', period: 2027, sequence: 1 }),
  step: 'notice-to-comply',
  stepLabel: 'Notice to comply',
  subjectKind: 'obligation',
  subjectReference: 'biennial:2027',
  whatToDo: 'file-declaration',
  issuedAt: '2028-01-05T08:00:00.000Z',
  actBy: '2028-01-19T08:00:00.000Z',
  salaryStoppedFrom: null,
  respondUrl: `http://localhost:3010/notices/${RECORD_ID}`,
};

const REFERRAL_PAYLOAD = {
  reference: format(RFL, { issuer: 'PSC', period: 2028, sequence: 1 }),
  grounds: 'two-missed-cycles',
  groundsLabel: 'Two consecutive declarations not filed',
  cycleYear: 2027,
  commission: COMMISSION,
  declarant: { name: 'Achieng Wambui Otieno', personnelFileNumber: 'PSC/2019/0042' },
  narrative: 'Proposed by the system: two consecutive biennial declarations not filed.',
  proposedBy: 'Adili (system proposal)',
  proposedAt: '2028-02-01T07:00:00.000Z',
  approvedBy: 'Lucy Wambui',
  approvedAt: '2028-02-02T07:00:00.000Z',
  manifest: [
    { kind: 'obligation', reference: 'biennial:2027', sha256: 'a'.repeat(64), documentId: null },
  ],
  versions: [],
  flags: [],
  clarifications: [],
  obligations: [
    {
      cycleKey: 'biennial:2027',
      type: 'biennial',
      status: 'overdue',
      dueDate: '2027-12-31',
      filedAt: null,
    },
  ],
  letters: [],
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

    const payload = await client.payload('clarification', 'psc', CLARIFICATION_ID);

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

  it.each([
    [
      'determination',
      'DeterminationLetterPayload',
      DETERMINATION_PAYLOAD,
      'determinations',
      'letter-payload',
      decisionLetterPayload,
    ],
    [
      'action',
      'ActionLetterPayload',
      ACTION_PAYLOAD,
      'actions',
      'letter-payload',
      noticeToComplyV1.payload,
    ],
    [
      'referral',
      'ReferralPackagePayload',
      REFERRAL_PAYLOAD,
      'referrals',
      'package-payload',
      referralPackagePayload,
    ],
  ] as const)(
    "pulls a %s's payload (%s) for the Commission, which the template takes",
    async (record, schema, body, collection, endpoint, template) => {
      const { client, requests } = clientAnswering(() => json(conforming(schema, body)));

      expect(await client.payload(record, 'psc', RECORD_ID)).toEqual(body);
      expect(requests).toEqual([
        {
          path: `/internal/v1/review/${collection}/${RECORD_ID}/${endpoint}`,
          actingTenant: 'psc',
          authorization: 'Bearer token',
        },
      ]);
      // Issuance takes the declarant's person id off before the template checks the fields.
      const fields: Record<string, unknown> = { ...body };
      delete fields.declarantPersonId;
      expect(template.safeParse(fields).error).toBeUndefined();
    },
  );

  it.each(['clarification', 'determination', 'action', 'referral'] as ReviewRecord[])(
    'maps 404 on a %s to ReviewRecordNotFound',
    async (record) => {
      const { client } = clientAnswering(() => json({ type: 'about:blank', status: 404 }, 404));

      await expect(client.payload(record, 'psc', CLARIFICATION_ID)).rejects.toEqual(
        new ReviewRecordNotFound(record, CLARIFICATION_ID),
      );
    },
  );

  it('refuses anything but a JSON object, or another status, as unavailable', async () => {
    for (const answer of [
      json(['not', 'an', 'object']),
      json({ type: 'about:blank', status: 500 }, 500),
      json({ type: 'about:blank', status: 403 }, 403),
    ]) {
      const { client } = clientAnswering(() => answer);
      await expect(client.payload('clarification', 'psc', CLARIFICATION_ID)).rejects.toBeInstanceOf(
        ReviewUnavailable,
      );
    }
  });
});
