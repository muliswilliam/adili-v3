import { DEMO_ACCOUNTS } from '@adili/demo-auth';
import { describe, expect, it } from 'vitest';

import { PERSONAS, TIMED_OFFICERS } from './data/personas.js';
import { PSC_REVIEWERS, REFERRAL_OFFICER } from './data/review.js';
import { syntheticDemoKey } from './steps/onboarding.js';
import { signInAppOf } from './tokens.js';

describe('signInAppOf', () => {
  it("signs every switcher account in through its own app, so the audit trail's channel is right", () => {
    for (const account of DEMO_ACCOUNTS) {
      expect(signInAppOf(account.demoKey), account.demoKey).toBe(account.app);
    }
  });

  it('signs the officers the seed onboards in through the portal', () => {
    const declarants = [
      ...PERSONAS.map((persona) => persona.demoKey),
      ...TIMED_OFFICERS.map((officer) => officer.demoKey),
      REFERRAL_OFFICER.demoKey,
      syntheticDemoKey('29000001'),
    ];
    for (const demoKey of declarants) expect(signInAppOf(demoKey), demoKey).toBe('portal');
  });

  it('signs the staff the seed adds in through the console', () => {
    for (const demoKey of [
      ...PSC_REVIEWERS,
      'jsc-reviewer',
      'eacc-hr-supervisor',
      'npsc-supervisor',
    ]) {
      expect(signInAppOf(demoKey), demoKey).toBe('console');
    }
  });
});
