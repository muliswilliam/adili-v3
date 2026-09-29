import { ApplicationFailure } from '@temporalio/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { ACTION_LETTER_REFUSED } from '../../src/enforcement/contract.js';
import { LETTER_REFUSED } from '../../src/clarifications/contract.js';
import { DECISION_LETTER_REFUSED } from '../../src/determinations/contract.js';
import { DocumentsUnavailable } from '../../src/documents/documents-client.js';
import { issueLetter, type LetterRequest } from '../../src/documents/letters.js';
import { FakeDirectory } from '../support/fake-directory.js';
import { FakeDocuments } from '../support/fake-documents.js';

/**
 * The one way the review service issues a Restricted letter (clarification, decision and ladder
 * letters): as the Commission, with the verify page's public fields; a letter documents refuses
 * fails without retry, under the letter's own failure type; an outage propagates for a retry.
 */
describe('issueLetter', () => {
  let directory: FakeDirectory;
  let documents: FakeDocuments;

  const ISSUED_AT = new Date('2027-12-20T08:00:00.000Z');

  const letters: [string, LetterRequest][] = [
    [
      'clarification',
      {
        type: 'clarification-letter',
        payload: { clarificationId: '0199d000-0000-7000-8000-0000000000a1' },
        tenant: 'psc',
        templateVersion: 1,
        subjectRef: 'clarification:0199d000-0000-7000-8000-0000000000a1',
        subjectPersonId: '0199d000-0000-7000-8000-0000000000f1',
        reference: 'CLR-PSC-2027-0000001-K',
        issuedAt: ISSUED_AT,
        refused: LETTER_REFUSED,
      },
    ],
    [
      'decision',
      {
        type: 'decision-letter',
        payload: { determinationId: '0199d000-0000-7000-8000-0000000000a2' },
        tenant: 'psc',
        templateVersion: 1,
        subjectRef: 'determination:0199d000-0000-7000-8000-0000000000a2',
        subjectPersonId: '0199d000-0000-7000-8000-0000000000f1',
        reference: 'CMP-PSC-2027-0000001-K',
        issuedAt: ISSUED_AT,
        refused: DECISION_LETTER_REFUSED,
      },
    ],
    [
      'ladder step',
      {
        type: 'warning',
        payload: { actionId: '0199d000-0000-7000-8000-0000000000a3' },
        tenant: 'psc',
        templateVersion: 1,
        subjectRef: 'action:0199d000-0000-7000-8000-0000000000a3',
        subjectPersonId: null,
        reference: 'ADM-PSC-2027-0000001-K',
        issuedAt: ISSUED_AT,
        refused: ACTION_LETTER_REFUSED,
      },
    ],
  ];

  beforeEach(() => {
    directory = new FakeDirectory();
    directory.givenCommission('psc');
    documents = new FakeDocuments();
    documents.payloadSource = () => Promise.resolve({ status: 200, body: {} });
  });

  it.each(letters)('issues the %s letter as the Commission, Restricted', async (_, request) => {
    const issued = await issueLetter({ directory, documents }, request);

    expect(documents.issued.map((letter) => letter.document)).toEqual([issued]);
    expect(documents.issued[0]?.request).toEqual({
      type: request.type,
      payload: request.payload,
      templateVersion: 1,
      disclosureLevel: 'restricted',
      issuerTenant: 'psc',
      subjectRef: request.subjectRef,
      subjectPersonId: request.subjectPersonId,
      publicPayload: {
        reference: request.reference,
        type: request.type,
        issuer: 'Public Service Commission',
        issuedAt: '2027-12-20T08:00:00.000Z',
      },
    });
  });

  it.each(letters)(
    'a %s letter documents refuses fails without retry, under its own type',
    async (_, request) => {
      documents.refuseIssues(1);

      const failed = await issueLetter({ directory, documents }, request).catch(
        (error: unknown) => error,
      );

      expect(failed).toBeInstanceOf(ApplicationFailure);
      expect(failed).toMatchObject({ type: request.refused, nonRetryable: true });
      expect(documents.issued).toEqual([]);
    },
  );

  it('an unreachable documents service propagates, so the activity is retried', async () => {
    documents.failCalls(1);

    const [, request] = letters[0] ?? [];
    if (!request) throw new Error('no letter');

    await expect(issueLetter({ directory, documents }, request)).rejects.toBeInstanceOf(
      DocumentsUnavailable,
    );
  });
});
