import { describe, expect, it } from 'vitest';

import { setTenantBudgetInput } from './ai-policy';
import { clarificationItemInput } from './clarifications';

// The server functions' validators bound what reaches the services as the contracts do (N2).
describe('server function inputs', () => {
  it('bounds a budget as the ai-gateway contract does', () => {
    const budget = { tenant: 'tsc', monthlyTokens: 1_000_000, perMinute: 60 };
    expect(setTenantBudgetInput.safeParse(budget).success).toBe(true);
    expect(setTenantBudgetInput.safeParse({ ...budget, perMinute: 2_147_483_648 }).success).toBe(
      false,
    );
    expect(
      setTenantBudgetInput.safeParse({ ...budget, monthlyTokens: Number.MAX_SAFE_INTEGER + 2 })
        .success,
    ).toBe(false);
  });

  it("bounds a clarification item's section and person keys", () => {
    const item = {
      sectionKey: 'statement:officer',
      personKey: 'officer',
      itemId: null,
      requirement: 'correct',
      text: 'Please correct the value.',
      aiJobId: null,
    };
    expect(clarificationItemInput.safeParse(item).success).toBe(true);
    expect(clarificationItemInput.safeParse({ ...item, sectionKey: 'x'.repeat(101) }).success).toBe(
      false,
    );
    expect(clarificationItemInput.safeParse({ ...item, personKey: 'x'.repeat(81) }).success).toBe(
      false,
    );
  });
});
