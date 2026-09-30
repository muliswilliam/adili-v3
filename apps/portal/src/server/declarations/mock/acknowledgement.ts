/**
 * The mock's acknowledgement slips (spec 06, `getAcknowledgement` and `reissueAcknowledgement`),
 * apart from the draft store: a submitted version's slip is `pending` for a few seconds, then
 * issued (or failed, or kept pending, per `setSlipIssuance`), as the documents service would
 * answer asynchronously. A failed slip can be asked for again, at most once a minute (429 with
 * `Retry-After` meanwhile); an issued one or one in progress answers 409. The download link
 * points at `/api/mock-slips/{documentId}` (`routes/api/mock-slips.$documentId.ts`).
 */
import { randomBytes, randomUUID } from 'node:crypto';

import type { Acknowledgement, DeclarationVersion } from '../types';

/** What issuance does with the slips asked for from now on (tests, and dev by editing). */
export type SlipIssuance = 'issue' | 'fail' | 'hold';

/** How long a slip stays `pending` after the submit or a reissue. */
export const MOCK_SLIP_DELAY_MS = 4000;
/** How long after a reissue the next one answers 429. */
export const MOCK_REISSUE_COOLDOWN_MS = 60_000;

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

/** The slip issued with `documentId`, for the mock download route. */
export function mockSlip(documentId: string) {
  return slips.get(documentId);
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

/** Moves a pending slip on once its delay went by, as issuance would have. */
export function settleAcknowledgement(version: DeclarationVersion, now: number) {
  const request = requestOf(version);
  const ack = version.acknowledgement;
  if (ack.status !== 'pending' || now - request.requestedAt < MOCK_SLIP_DELAY_MS) return;
  if (request.issuance === 'fail') {
    ack.status = 'failed';
  } else if (request.issuance === 'issue') {
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
      issuedAt: new Date(request.requestedAt + MOCK_SLIP_DELAY_MS).toISOString(),
    } satisfies Partial<Acknowledgement>);
  }
}

/** `GET …/acknowledgement`: the slip's status, with a fresh download link once issued. */
export function readAcknowledgement(
  version: DeclarationVersion,
  now: number = Date.now(),
): Acknowledgement {
  settleAcknowledgement(version, now);
  const ack = version.acknowledgement;
  return {
    ...ack,
    downloadUrl:
      ack.status === 'issued' && ack.documentId ? `/api/mock-slips/${ack.documentId}` : null,
  };
}

export type ReissueAnswer =
  { status: 202 } | { status: 409 } | { status: 429; retryAfterSeconds: number };

/** `POST …/acknowledgement/reissue`: only a failed slip, at most once per cooldown. */
export function reissueAcknowledgement(
  version: DeclarationVersion,
  now: number = Date.now(),
): ReissueAnswer {
  settleAcknowledgement(version, now);
  const request = requestOf(version);
  if (version.acknowledgement.status !== 'failed') return { status: 409 };
  if (request.reissuedAt !== null && now - request.reissuedAt < MOCK_REISSUE_COOLDOWN_MS) {
    const left = MOCK_REISSUE_COOLDOWN_MS - (now - request.reissuedAt);
    return { status: 429, retryAfterSeconds: Math.ceil(left / 1000) };
  }
  version.acknowledgement.status = 'pending';
  request.requestedAt = now;
  request.reissuedAt = now;
  request.issuance = issuance;
  return { status: 202 };
}
