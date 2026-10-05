import { describe, expect, it } from 'vitest';

import { findPerson } from './account-support.server';
import { mockSupportClient } from './support/mock.server';

describe("the helpdesk's person lookup", () => {
  it('finds account metadata by officer reference, with which contacts are on file', async () => {
    const result = await findPerson(mockSupportClient(['helpdesk']), 'OFR-0001043-H');
    expect(result).toMatchObject({
      ok: true,
      data: {
        fullName: 'Kiprono Kibet Chebet',
        commissions: ['psc'],
        contactsOnFile: { email: false, phone: true },
      },
    });
  });

  it('is a 404 problem for a reference no one has, and 400 for a mistyped one', async () => {
    const client = mockSupportClient(['helpdesk']);
    expect(await findPerson(client, 'OFR-0009999-0')).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 404 } },
    });
    expect(await findPerson(client, 'OFR-0001042-K')).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 400 } },
    });
  });

  it('refuses anyone but the helpdesk and platform admins', async () => {
    expect(await findPerson(mockSupportClient(['reviewer']), 'OFR-0001042-J')).toMatchObject({
      ok: false,
      error: { kind: 'problem', problem: { status: 403 } },
    });
    const admin = await findPerson(mockSupportClient(['platform-admin']), 'OFR-0001042-J');
    expect(admin.ok).toBe(true);
  });
});
