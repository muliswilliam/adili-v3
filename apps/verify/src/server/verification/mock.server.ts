/**
 * In-memory stand-in for verification-api (verification-api.yaml), used when VERIFICATION_MOCK
 * is set until the service implements spec 06 (#146). One fixture per state of the #145
 * prototype (its codes, lengthened to the real 26 characters):
 *
 * | Code                                 | Answer                                               |
 * |--------------------------------------|------------------------------------------------------|
 * | ADL-7Q4K-M2XR-9HTC-W3NB-5FJD-K6RT-8P | valid, restricted (version 2); hash of MOCK_SLIP_PDF |
 * | ADL-3MZC-8K1V-QD4T-7HWA-2RNE-G9XB-6J | superseded by the code above (linked)                |
 * | ADL-5SPK-2DHW-8QNC-4TXM-7BRV-Y2KD-3F | superseded, no link (level does not allow it)        |
 * | ADL-9TXB-4KMC-1VRD-6QPE-3HZW-N7CM-5A | revoked, issued in error                             |
 * | ADL-6FHW-2NQD-8KXT-5BMR-1CVE-P4WS-7G | expired compliance certificate                       |
 * | ADL-4RDM-7XHQ-2WCP-9KTB-6NJF-H8QZ-3E | valid, confidential (validity only)                  |
 * | ADL-RATE-0000-0000-0000-0000-0000-00 | 429, retry after 42 seconds                          |
 * | ADL-D0WN-0000-0000-0000-0000-0000-00 | 503                                                  |
 * | any other well-formed code           | 404 not-found                                        |
 * | anything else                        | 400                                                  |
 *
 * Like the service, it normalises the code (case, hyphens, look-alikes) before looking it up.
 */
import { createHash } from 'node:crypto';

import { normalizeVerificationId } from '@adili/events/contracts';

import type { VerificationResult } from './types';

/**
 * A small PDF standing in for the issued version 2 slip: the valid fixture's `sha256` is its
 * hash, so the hash check says "identical" for exactly these bytes and "does not match" for any
 * edit (tests, and the demo: save it as a .pdf and drop it on the page).
 */
export const MOCK_SLIP_PDF = new TextEncoder().encode(
  [
    '%PDF-1.7',
    '% Adili Online acknowledgement slip (verify mock)',
    '1 0 obj << /Type /Catalog >> endobj',
    '% Reference DCI-TSC-2026-0012345-8 version 2',
    '% Verification ADL-7Q4K-M2XR-9HTC-W3NB-5FJD-K6RT-8P',
    '%%EOF',
    '',
  ].join('\n'),
);

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const OTHER_SHA256 = sha256(new TextEncoder().encode('another issued document'));

export const MOCK_CODES = {
  valid: 'ADL-7Q4K-M2XR-9HTC-W3NB-5FJD-K6RT-8P',
  superseded: 'ADL-3MZC-8K1V-QD4T-7HWA-2RNE-G9XB-6J',
  supersededUnlinked: 'ADL-5SPK-2DHW-8QNC-4TXM-7BRV-Y2KD-3F',
  revoked: 'ADL-9TXB-4KMC-1VRD-6QPE-3HZW-N7CM-5A',
  expired: 'ADL-6FHW-2NQD-8KXT-5BMR-1CVE-P4WS-7G',
  confidential: 'ADL-4RDM-7XHQ-2WCP-9KTB-6NJF-H8QZ-3E',
  rateLimited: 'ADL-RATE-0000-0000-0000-0000-0000-00',
  unavailable: 'ADL-D0WN-0000-0000-0000-0000-0000-00',
  notFound: 'ADL-2222-3333-4444-5555-6666-7777-88',
} as const;

type Fixture = Omit<VerificationResult, 'verificationId' | 'checkedAt'>;

const SLIP = {
  type: 'acknowledgement-slip',
  issuerName: 'Teachers Service Commission',
  issuerCode: 'TSC',
  reference: 'DCI-TSC-2026-0012345-8',
};

const NONE = { supersededBy: null, revokedReason: null } as const;

const FIXTURES: Record<string, Fixture> = {
  [MOCK_CODES.valid]: {
    status: 'valid',
    disclosureLevel: 'restricted',
    document: { ...SLIP, issuedAt: '2026-09-26T07:43:00Z', version: 2 },
    sha256: sha256(MOCK_SLIP_PDF),
    ...NONE,
  },
  [MOCK_CODES.superseded]: {
    status: 'superseded',
    disclosureLevel: 'restricted',
    document: { ...SLIP, issuedAt: '2026-09-21T13:05:00Z', version: 1 },
    sha256: OTHER_SHA256,
    ...NONE,
    supersededBy: MOCK_CODES.valid,
  },
  [MOCK_CODES.supersededUnlinked]: {
    status: 'superseded',
    disclosureLevel: 'restricted',
    document: {
      ...SLIP,
      reference: 'DCI-TSC-2026-0012388-L',
      issuedAt: '2026-09-18T08:30:00Z',
      version: 1,
    },
    sha256: OTHER_SHA256,
    ...NONE,
  },
  [MOCK_CODES.revoked]: {
    status: 'revoked',
    disclosureLevel: 'restricted',
    document: {
      ...SLIP,
      issuerName: 'Public Service Commission',
      issuerCode: 'PSC',
      reference: 'DCI-PSC-2026-0000481-3',
      issuedAt: '2026-09-14T06:12:00Z',
      version: 1,
    },
    sha256: OTHER_SHA256,
    ...NONE,
    revokedReason: 'issued-in-error',
  },
  [MOCK_CODES.expired]: {
    status: 'expired',
    disclosureLevel: 'restricted',
    document: {
      type: 'compliance-certificate',
      issuerName: 'Public Service Commission',
      issuerCode: 'PSC',
      reference: null,
      issuedAt: '2025-03-03T08:20:00Z',
      version: null,
    },
    sha256: OTHER_SHA256,
    ...NONE,
  },
  [MOCK_CODES.confidential]: {
    status: 'valid',
    disclosureLevel: 'confidential',
    document: null,
    sha256: OTHER_SHA256,
    ...NONE,
  },
};

export function mockVerificationFetch(request: Request): Promise<Response> {
  return Promise.resolve(route(request));
}

function route(request: Request): Response {
  const match = /^\/v1\/verify\/([^/]+)$/.exec(new URL(request.url).pathname);
  if (request.method !== 'GET' || !match?.[1]) return problem(404, 'Not found');

  const verificationId = normalizeVerificationId(decodeURIComponent(match[1]));
  if (!verificationId)
    return problem(400, 'Malformed verification id', 'malformed-verification-id');
  if (verificationId === MOCK_CODES.rateLimited) {
    return json(
      429,
      { type: 'about:blank', title: 'Too many requests', status: 429, code: 'rate-limit-exceeded' },
      { 'retry-after': '42' },
    );
  }
  if (verificationId === MOCK_CODES.unavailable) return problem(503, 'Service unavailable');

  const checkedAt = new Date().toISOString();
  const fixture = FIXTURES[verificationId];
  if (!fixture) {
    const notFound: VerificationResult = {
      verificationId,
      status: 'not-found',
      disclosureLevel: null,
      document: null,
      sha256: null,
      ...NONE,
      checkedAt,
    };
    return json(404, notFound);
  }
  return json(200, { verificationId, ...fixture, checkedAt } satisfies VerificationResult);
}

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  const type = status >= 400 && status !== 404 ? 'application/problem+json' : 'application/json';
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': type, ...headers },
  });
}

function problem(status: number, title: string, type = 'about:blank') {
  return json(status, { type, title, status });
}
