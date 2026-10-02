import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { type GrantToIssue, issueGrantDocument } from '../src/grant-documents.js';
import { FakeClock } from './support/fake-clock.js';
import { FakeDeclarations, FakeDirectory, FakeDocuments, FakeReview } from './support/fakes.js';

/** `issueGrantDocument`: what it asks review for, by the grant's legal basis. */
describe('issueGrantDocument', () => {
  function given() {
    const deps = {
      declarations: new FakeDeclarations(),
      review: new FakeReview(),
      documents: new FakeDocuments(),
      directory: new FakeDirectory(),
      clock: new FakeClock(),
      logger: new Logger('test'),
    };
    const personId = randomUUID();
    deps.declarations.givenDisclosure(personId, {
      schemaVersion: 'disclosure.v1',
      grantReference: 'ARQ-PSC-2027-0000001-X',
      personName: 'Anne Njeri Mutua',
      commission: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
      versions: [
        {
          reference: 'DCB-PSC-2026-0000001-1',
          version: 1,
          type: 'biennial',
          statementDate: '2026-12-31',
          submittedAt: '2027-01-15T08:00:00.000Z',
          content: { schemaVersion: 'declaration.v1' },
        },
      ],
    });
    const grant: GrantToIssue = {
      tenant: 'psc',
      requestId: randomUUID(),
      reference: 'ARQ-PSC-2027-0000001-X',
      legalBasis: 'act-s36-1',
      personId,
      declarantName: 'Anne Njeri Mutua',
      scope: {
        years: [2026],
        includeSpouses: false,
        includeChildren: false,
        sections: ['assets'],
        includeClarifications: true,
      },
      decidedBy: 'officer-psc',
      grantedAt: '2027-03-20T12:00:00.000Z',
      recipientSubject: 'recipient',
      recipientPersonId: randomUUID(),
      recipient: { name: 'Mercy Wanjiku Kamau', organisation: null },
      watermarkName: 'Mercy Wanjiku Kamau',
      subjectRef: 'access-request:x',
    };
    return { deps, grant };
  }

  it('asks review for the clarifications under the Form K grant’s own legal basis', async () => {
    const { deps, grant } = given();

    await issueGrantDocument(deps, grant);

    expect(deps.review.calls.map((call) => call.legalBasis)).toEqual(['act-s36-1']);
  });

  it('never asks review on a law enforcement grant, whatever its scope says', async () => {
    const { deps, grant } = given();

    const { kind } = await issueGrantDocument(deps, { ...grant, legalBasis: 'act-s36-2' });

    expect(kind).toBe('access-package');
    expect(deps.review.calls).toEqual([]);
  });
});
