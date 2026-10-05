/**
 * In-memory stand-in for the directory's person lookup (`GET /v1/persons`), used when
 * HELPDESK_MOCK is set, so Account support runs without the directory. Like the directory, only
 * the helpdesk and platform admins get past the 403, a reference with a wrong check character is
 * 400 and an unknown one 404.
 */
import createClient from 'openapi-fetch';

import type { paths } from '../directory/api.gen';
import { json, mockCallerOf, problem, unsignedMockToken } from '../mock-http';
import type { PersonSummary } from './types';

const PERSONS: PersonSummary[] = [
  {
    personId: '7d3f9b2a-4c1e-4f8a-9b6d-2e5a1c3f7b90',
    ofr: 'OFR-0001042-J',
    fullName: 'Wanjiku Njoki Kamau',
    commissions: ['psc'],
    contactsOnFile: { email: true, phone: true },
    createdAt: '2026-09-28T07:41:12.000Z',
  },
  {
    personId: '1a6e0c4d-8b2f-4d71-9e35-7c0b5a2d4f18',
    ofr: 'OFR-0001043-H',
    fullName: 'Kiprono Kibet Chebet',
    commissions: ['psc'],
    contactsOnFile: { email: false, phone: true },
    createdAt: '2026-09-29T10:05:47.000Z',
  },
  {
    personId: '4f9b2e7a-0d3c-4a85-b16e-2c8f5d0a7e93',
    ofr: 'OFR-0001044-F',
    fullName: 'Amina Halima Hassan',
    commissions: ['psc', 'tsc'],
    contactsOnFile: { email: true, phone: false },
    createdAt: '2026-09-30T14:22:03.000Z',
  },
];

/** References whose shape is right but whose check character is not (`hasValidCheckCharacter`). */
const MISTYPED = /^OFR-0001042-(?!J)[0-9A-Z]$/;

export function mockSupportFetch(request: Request): Response {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.pathname !== '/v1/persons') {
    return problem(404, 'Not Found');
  }
  const roles = mockCallerOf(request).roles;
  if (!roles.includes('helpdesk') && !roles.includes('platform-admin')) {
    return problem(403, 'Forbidden');
  }
  const ofr = url.searchParams.get('ofr') ?? '';
  if (!/^OFR-[0-9]{7}-[0-9A-Z]$/.test(ofr) || MISTYPED.test(ofr)) {
    return problem(400, 'Not an officer reference: the check character does not match');
  }
  const person = PERSONS.find((candidate) => candidate.ofr === ofr);
  return person ? json(200, person) : problem(404, 'No person has this officer reference');
}

/** A client of the mock as a caller with these roles, for tests. */
export function mockSupportClient(roles: readonly string[]) {
  const token = unsignedMockToken({
    subject: 'helpdesk-1',
    name: 'Zawadi Akinyi',
    roles,
    tenant: 'platform',
  });
  return createClient<paths>({
    baseUrl: 'http://directory.mock',
    headers: { authorization: `Bearer ${token}` },
    fetch: (request: Request) => Promise.resolve(mockSupportFetch(request)),
  });
}
