import { describe, expect, it } from 'vitest';

import { redactTracedUrl, redactUrl } from './url-redaction.js';

describe('redactTracedUrl', () => {
  it.each([
    // #476: the registries' identifiers, in a path or a query.
    ['http://mocks:8000/iprs/v1/persons/22607781', 'http://mocks:8000/iprs/v1/persons/[redacted]'],
    ['/kra/v1/pins?id_number=22607781', '/kra/v1/pins?id_number=[redacted]'],
    ['/kra/v1/pins/A002260778R/compliance', '/kra/v1/pins/[redacted]/compliance'],
    ['/kra/v1/pins/a002260778r/compliance', '/kra/v1/pins/[redacted]/compliance'],
    ['/ntsa/v1/owners/22607781/vehicles', '/ntsa/v1/owners/[redacted]/vehicles'],
    ['/payroll/v1/employees/KEMSA%2F2011%2F0457', '/payroll/v1/employees/[redacted]'],
    ['/v1/x?phone_number=0712345678&page=2', '/v1/x?phone_number=[redacted]&page=2'],
    ['/v1/x?22607781', '/v1/x?[redacted]'],
    ['/v1/x#22607781', '/v1/x#[redacted]'],
    // Separated digits, and an identifier as a query key.
    ['/v1/x/0712-345-678?id=22.607.781', '/v1/x/[redacted]?id=[redacted]'],
    ['/v1/x?dob=1979-08-21', '/v1/x?dob=[redacted]'],
    ['/v1/x?22607781=&a=1', '/v1/x?[redacted]&a=1'],
    ['/v1/x?22607781=x', '/v1/x?[redacted]'],
    // Free text, as in `redactUrl`, even when it reads as a word.
    ['/v1/queue?search=kamau&band=high', '/v1/queue?search=[redacted]&band=high'],
  ])('redacts %s', (url, redacted) => {
    expect(redactTracedUrl(url)).toBe(redacted);
  });

  it.each([
    'http://keycloak:8080/realms/adili/protocol/openid-connect/certs',
    'http://openbao:8200/v1/transit/encrypt/tenant-psc',
    '/v1/declarations/0199a0fe-25fe-74c3-9162-c1c6d22965da/documents?limit=50&late=true',
    '/v1/reports/2026/summary.pdf?employerCode=moh&page=12',
    '/.well-known/openid-configuration',
    '/',
    '',
    '/v1/x?',
  ])('keeps %s', (url) => {
    expect(redactTracedUrl(url)).toBe(url);
  });

  it('keeps hosts, ports and query keys', () => {
    expect(redactTracedUrl('https://KRA.example:8443/v1/pins?ID_Number=22607781')).toBe(
      'https://KRA.example:8443/v1/pins?ID_Number=[redacted]',
    );
  });

  it('leaves redactUrl, for logs and problem details, to free text', () => {
    expect(redactUrl('/v1/persons/22607781?name=Kamau')).toBe(
      '/v1/persons/22607781?name=[redacted]',
    );
  });
});
