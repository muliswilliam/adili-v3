import { CLR, DCI, format } from '@adili/numbering/references';
import { describe, expect, it } from 'vitest';

import {
  type ClarificationLetterPayload,
  clarificationLetterV1,
} from '../../src/issuance/templates/clarification-letter.v1.js';

const payload = (dueAt: string): ClarificationLetterPayload => ({
  declarantName: 'John Kamau Otieno',
  commission: { name: 'Teachers Service Commission', issuerCode: 'TSC' },
  declarationReference: format(DCI, { issuer: 'TSC', period: 2026, sequence: 3418 }),
  clarificationReference: format(CLR, { issuer: 'TSC', period: 2026, sequence: 871 }),
  items: [
    {
      label: 'Liabilities · John Kamau Otieno',
      requirementLabel: 'Provide the omitted information',
      text: 'Please declare the loan balance.',
    },
  ],
  issuedAt: '2026-09-14T06:20:00.000Z',
  dueAt,
  portalUrl: 'http://localhost:3010/clarifications/0192f0c4-8a51-7cc2-9d1e-3b3f2a7e4c10',
});

const render = (dueAt: string) =>
  clarificationLetterV1.render(payload(dueAt), {
    verificationId: 'ADL-TEST',
    issuedAt: new Date('2026-09-14T06:20:00.000Z'),
    signerName: 'Adili Online Signing',
  });

describe('clarification-letter.v1', () => {
  it("Q9: gives the reply window the due date was set with, the Commission's policy", () => {
    expect(render('2026-10-14T06:20:00.000Z')).toContain(
      'You have 30 days from receipt of this letter to respond (section 35(3)).',
    );
    // A Commission whose policy gives 45 days.
    const longer = render('2026-10-29T06:20:00.000Z');
    expect(longer).toContain('Respond by 29 Oct 2026');
    expect(longer).toContain('You have 45 days from receipt of this letter');
    expect(longer).not.toContain('30 days');
  });
});
