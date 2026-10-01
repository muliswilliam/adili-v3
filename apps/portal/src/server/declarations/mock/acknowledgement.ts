/**
 * The mock's acknowledgement slips (spec 06, `getAcknowledgement` and `reissueAcknowledgement`),
 * apart from the draft store, on the declarations service's rules: a submitted version's slip is
 * `pending` for a few seconds, then issued, as the documents service would answer
 * asynchronously; under `setSlipIssuance('fail')` it never comes, and a minute after the
 * submission (or the last reissue) it reads `failed`, as the service derives it. Reissue answers
 * 202 for a failed slip, 409 `acknowledgement-issued` once issued, 409
 * `acknowledgement-in-progress` within a minute of the submission, and 429 `resend-cooldown`
 * with `retryAfterSeconds` within a minute of the last reissue. The slip downloads from the
 * documents mock (`GET /v1/documents/{id}/download`), which serves `/api/mock-slips/{id}`
 * (`routes/api/mock-slips.$documentId.ts`).
 */
import { randomBytes, randomUUID } from 'node:crypto';

import { placeholderPdf } from '../../mock-pdf';
import type { Acknowledgement, DeclarationVersion } from '../types';

/** What issuance does with the slips asked for from now on (tests, and dev by editing). */
export type SlipIssuance = 'issue' | 'fail';

/** How long a slip stays `pending` after the submit or a reissue before it is issued. */
export const MOCK_SLIP_DELAY_MS = 4000;
/**
 * How long a slip may take before it reads `failed` and may be asked for again, and so how
 * long after a reissue the next one answers 429 (the service's `ACKNOWLEDGEMENT_DEADLINE_MS`).
 */
export const MOCK_ACKNOWLEDGEMENT_DEADLINE_MS = 60_000;
/** The verify app in development (`apps/verify`), where the slip's QR points. */
const MOCK_VERIFY_ORIGIN = 'http://localhost:3030';

interface SlipRequest {
  /** When the slip was last asked for: the submit, then each reissue. */
  requestedAt: number;
  issuance: SlipIssuance;
  reissuedAt: number | null;
}

let issuance: SlipIssuance = 'issue';
const requests = new Map<DeclarationVersion, SlipRequest>();
const slips = new Map<string, { reference: string; version: number; verificationId: string }>();

export function setSlipIssuance(mode: SlipIssuance) {
  issuance = mode;
}

/** Clears the slips and issues from now on (tests). */
export function resetAcknowledgementMock() {
  issuance = 'issue';
  requests.clear();
  slips.clear();
}

/**
 * The slip issued with `documentId` as a placeholder PDF naming it, for the documents mock's
 * download and the route that serves it; undefined when no such slip was issued.
 */
export function mockSlipFile(documentId: string): { fileName: string; pdf: string } | undefined {
  const issued = slips.get(documentId);
  if (!issued) return undefined;
  return {
    fileName: `${issued.reference}-v${String(issued.version)}.pdf`,
    pdf: placeholderPdf([
      `Acknowledgement slip ${issued.reference}, version ${String(issued.version)}`,
      `Verification code ${issued.verificationId}`,
      'Placeholder slip from the development mock.',
    ]),
  };
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A verification code as the documents service prints it: `ADL-` and 128 random bits. */
function verificationId(): string {
  const bytes = randomBytes(16);
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  const chars = (bits.match(/.{1,5}/g) ?? []).map(
    (chunk) => CROCKFORD[Number.parseInt(chunk.padEnd(5, '0'), 2)],
  );
  const groups = chars.join('').match(/.{1,4}/g) ?? [];
  return `ADL-${groups.join('-')}`;
}

function requestOf(version: DeclarationVersion): SlipRequest {
  let request = requests.get(version);
  if (!request) {
    request = { requestedAt: Date.parse(version.submittedAt), issuance, reissuedAt: null };
    requests.set(version, request);
  }
  return request;
}

/** Records the issuance mode a newly submitted version's slip gets. */
export function slipRequested(version: DeclarationVersion) {
  requestOf(version);
}

/** Issues a pending slip once its delay went by, as the documents service would have. */
function settleAcknowledgement(version: DeclarationVersion, now: number) {
  const request = requestOf(version);
  const ack = version.acknowledgement;
  if (ack.status !== 'pending' || request.issuance !== 'issue') return;
  if (now - request.requestedAt < MOCK_SLIP_DELAY_MS) return;
  const documentId = randomUUID();
  const code = verificationId();
  slips.set(documentId, {
    reference: version.reference,
    version: version.version,
    verificationId: code,
  });
  Object.assign(ack, {
    status: 'issued',
    documentId,
    verificationId: code,
    verifyUrl: `${MOCK_VERIFY_ORIGIN}/v/${code}`,
    issuedAt: new Date(request.requestedAt + MOCK_SLIP_DELAY_MS).toISOString(),
  } satisfies Partial<Acknowledgement>);
}

/**
 * The acknowledgement as the service reports it: a slip still pending a minute after it was
 * last asked for reads `failed` (stored, it stays `pending`).
 */
export function readAcknowledgement(
  version: DeclarationVersion,
  now: number = Date.now(),
): Acknowledgement {
  settleAcknowledgement(version, now);
  const ack = version.acknowledgement;
  const overdue =
    ack.status === 'pending' &&
    now - requestOf(version).requestedAt > MOCK_ACKNOWLEDGEMENT_DEADLINE_MS;
  return overdue ? { ...ack, status: 'failed' } : { ...ack };
}

export type ReissueAnswer =
  | { status: 202 }
  | { status: 409; code: 'acknowledgement-issued' | 'acknowledgement-in-progress' }
  | { status: 429; retryAfterSeconds: number };

/** `POST …/acknowledgement/reissue`, on the service's `reissueDecision`. */
export function reissueAcknowledgement(
  version: DeclarationVersion,
  now: number = Date.now(),
): ReissueAnswer {
  const status = readAcknowledgement(version, now).status;
  const request = requestOf(version);
  if (status === 'issued') return { status: 409, code: 'acknowledgement-issued' };
  if (status === 'pending') {
    if (request.reissuedAt === null) return { status: 409, code: 'acknowledgement-in-progress' };
    const left = request.reissuedAt + MOCK_ACKNOWLEDGEMENT_DEADLINE_MS - now;
    return { status: 429, retryAfterSeconds: Math.max(1, Math.ceil(left / 1000)) };
  }
  request.requestedAt = now;
  request.reissuedAt = now;
  request.issuance = issuance;
  return { status: 202 };
}
