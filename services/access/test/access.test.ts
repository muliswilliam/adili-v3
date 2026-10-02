import type { Principal } from '@adili/api-kit';
import { ACCESS_OFFICER } from '@adili/roles';
import { describe, expect, it } from 'vitest';

import { accessOfficerName } from '../src/access.js';

const officer = (name: string | null) =>
  ({
    subject: '3f1c2a9e-7b4d-4e61-9a2f-5c8d0e1b7a63',
    tenant: 'psc',
    roles: [ACCESS_OFFICER],
    name,
  }) as unknown as Principal;

describe('accessOfficerName', () => {
  it("names the officer by the token's name", () => {
    expect(accessOfficerName(officer('Peter Access'))).toBe('Peter Access');
  });

  it('falls back to the role, never to the account id, where people read it', () => {
    expect(accessOfficerName(officer(null))).toBe('Access officer');
  });
});
