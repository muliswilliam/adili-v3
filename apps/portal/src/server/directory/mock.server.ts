/**
 * In-memory stand-in for the directory's public onboarding endpoints and `GET /v1/me/declarant`
 * (contract draft, spec 03), used when DIRECTORY_MOCK is set until the directory implements them
 * (#67).
 *
 * Demo declarants (personnel file number / national ID):
 * - TSC/100200 / 12345678 at the Teachers Service Commission: match, codes go to the roster
 *   email and phone
 * - PSC/300400 / 23456789 at the Public Service Commission: match, roster has no email or phone,
 *   so the declarant enters both
 * - TSC/999999 / 11111111 at the Teachers Service Commission: already onboarded
 * - TSC/200300 / 34567890 at the Teachers Service Commission: the national register holds a
 *   different name, so confirming ends in identity-mismatch
 * - NPSC/400500 / 45678901 at the National Police Service Commission: already has an account from
 *   another Commission, so confirming links this record to it
 * - PSC/500600 / 56789012 at the Public Service Commission: the first confirm finds the national
 *   register down (503), the second fails to create the account (502), the third succeeds
 * Anything else is `no-match`; five misses from one address in a row are rate-limited.
 * The Judicial Service Commission has no roster yet.
 *
 * `GET /v1/me/declarant` reads the bearer token's claims without checking its signature. A user
 * with the `declarant` realm role gets the profile listed under their username in
 * DECLARANT_PROFILES, or the Teachers Service Commission demo profile; anyone else gets 403, as
 * the directory answers callers without the role.
 *
 * Every code is 123456; 000000 is treated as expired. Codes follow the spec's rules otherwise:
 * five wrong codes or a fourth resend end the session, and resends wait 60 seconds. The
 * set-password email can be sent again after the same 60 seconds.
 */
import { maskContact } from '@adili/ui';

import type {
  DeclarantProfile,
  IdentifyDeclarant,
  OnboardingCommission,
  OnboardingProblem,
  OnboardingSession,
  OnboardingSessionCreated,
  OtpChannel,
} from './types';

export const ONBOARDING_COMMISSIONS: OnboardingCommission[] = [
  { slug: 'jsc', issuerCode: 'JSC', name: 'Judicial Service Commission', hasRoster: false },
  { slug: 'npsc', issuerCode: 'NPSC', name: 'National Police Service Commission', hasRoster: true },
  { slug: 'parlsc', issuerCode: 'PSCK', name: 'Parliamentary Service Commission', hasRoster: true },
  { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission', hasRoster: true },
  { slug: 'tsc', issuerCode: 'TSC', name: 'Teachers Service Commission', hasRoster: true },
];

interface RosterRecord {
  commission: string;
  fullName: string;
  designation: string | null;
  reportingEntity: string | null;
  personnelFileNumber: string;
  nationalId: string;
  email: string | null;
  phone: string | null;
  onboarded: boolean;
  /** What the national register says about this person's name. */
  iprs: 'match' | 'mismatch';
  /** Set when the person already has an account from another Commission. */
  existingOfr?: string;
  /** Failures the next confirms of a session run into, in order, before one succeeds. */
  confirmFailures?: ConfirmFailure[];
}

type ConfirmFailure = 'iprs-unavailable' | 'identity-unavailable';

const ROSTER: RosterRecord[] = [
  {
    commission: 'tsc',
    fullName: 'Wanjiru Achieng Otieno',
    designation: 'Senior Teacher',
    reportingEntity: 'Kisumu Girls High School',
    personnelFileNumber: 'TSC/100200',
    nationalId: '12345678',
    email: 'j***@tsc.go.ke',
    phone: '07** *** 123',
    onboarded: false,
    iprs: 'match',
  },
  {
    commission: 'psc',
    fullName: 'Kiprono Mutai Chebet',
    designation: 'Principal Accountant',
    reportingEntity: 'State Department for Devolution',
    personnelFileNumber: 'PSC/300400',
    nationalId: '23456789',
    email: null,
    phone: null,
    onboarded: false,
    iprs: 'match',
  },
  {
    commission: 'tsc',
    fullName: 'Mwangi Njoroge Kamau',
    designation: 'Deputy Principal',
    reportingEntity: 'Nyeri High School',
    personnelFileNumber: 'TSC/999999',
    nationalId: '11111111',
    email: 'm***@tsc.go.ke',
    phone: '07** *** 789',
    onboarded: true,
    iprs: 'match',
  },
  {
    commission: 'tsc',
    fullName: 'Brian Odhiambo Ouma',
    designation: 'Teacher',
    reportingEntity: 'Maseno School',
    personnelFileNumber: 'TSC/200300',
    nationalId: '34567890',
    email: 'b***@tsc.go.ke',
    phone: '07** *** 456',
    onboarded: false,
    iprs: 'mismatch',
  },
  {
    commission: 'npsc',
    fullName: 'Grace Wambui Njeri',
    designation: 'Inspector',
    reportingEntity: 'Kilimani Police Station',
    personnelFileNumber: 'NPSC/400500',
    nationalId: '45678901',
    email: 'g***@npsc.go.ke',
    phone: '07** *** 901',
    onboarded: false,
    iprs: 'match',
    existingOfr: 'OFR-0000417-4',
  },
  {
    commission: 'psc',
    fullName: 'Amina Hassan Abdi',
    designation: 'Human Resource Officer',
    reportingEntity: 'State Department for Public Service',
    personnelFileNumber: 'PSC/500600',
    nationalId: '56789012',
    email: 'a***@psc.go.ke',
    phone: '07** *** 012',
    onboarded: false,
    iprs: 'match',
    confirmFailures: ['iprs-unavailable', 'identity-unavailable'],
  },
];

const DEMO_DECLARANT: DeclarantProfile = {
  personId: '5b0c8f7e-3f5d-4d59-9a53-0d6c1f0b2a11',
  ofr: 'OFR-0000312-7',
  fullName: 'Mwangi Njoroge Kamau',
  contacts: { email: 'mwangi.kamau@tsc.go.ke', phone: '+254712345789' },
  commissions: [
    {
      slug: 'tsc',
      name: 'Teachers Service Commission',
      personnelFileNumber: 'TSC/999999',
      rosterRecordId: '0f8e1c52-6a7b-4c3d-8e9f-1a2b3c4d5e6f',
      state: 'onboarded',
      onboardedAt: '2026-09-26T07:42:00Z',
    },
  ],
};

/** Profiles by Keycloak username (the OFR); users with the declarant role fall back to the demo. */
export const DECLARANT_PROFILES: Record<string, DeclarantProfile> = {
  'OFR-0000417-4': {
    personId: '8d7f3a90-2b1c-4e5d-a6f7-9081a2b3c4d5',
    ofr: 'OFR-0000417-4',
    fullName: 'Grace Wambui Njeri',
    contacts: { email: 'grace.njeri@npsc.go.ke', phone: '+254712345901' },
    commissions: [
      {
        slug: 'psc',
        name: 'Public Service Commission',
        personnelFileNumber: 'PSC/2009/118204',
        rosterRecordId: '3c2b1a09-8f7e-4d6c-9b5a-4a3b2c1d0e9f',
        state: 'onboarded',
        onboardedAt: '2026-03-12T09:15:00Z',
      },
      {
        slug: 'npsc',
        name: 'National Police Service Commission',
        personnelFileNumber: 'NPSC/400500',
        rosterRecordId: '7e6d5c4b-3a29-4f18-8e07-6d5c4b3a2918',
        state: 'onboarded',
        onboardedAt: '2026-09-26T10:05:00Z',
      },
    ],
  },
};

interface TokenClaims {
  preferred_username?: string;
  realm_access?: { roles?: string[] };
}

/** The claims of a bearer token, unverified; the mock trusts whatever the BFF sends. */
function bearerClaims(request: Request): TokenClaims | null {
  const token = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  const payload = token?.split('.')[1];
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as TokenClaims;
  } catch {
    return null;
  }
}

function myDeclarantProfile(request: Request) {
  const claims = bearerClaims(request);
  if (!claims) return json(401, { type: 'about:blank', title: 'Unauthorized', status: 401 });
  if (!claims.realm_access?.roles?.includes('declarant')) {
    return json(403, {
      type: 'about:blank',
      title: 'Forbidden',
      status: 403,
      detail: 'Requires one of the roles: declarant',
    });
  }
  return json(200, DECLARANT_PROFILES[claims.preferred_username ?? ''] ?? DEMO_DECLARANT);
}

const SESSION_TTL_MS = 30 * 60 * 1000;
const STEP_EXTENSION_MS = 10 * 60 * 1000;
const SESSION_CAP_MS = 60 * 60 * 1000;
const MISSES_BEFORE_LIMIT = 5;
const LIMIT_SECONDS = 15 * 60;
const CODE_ATTEMPTS = 5;
const RESENDS = 3;
const RESEND_COOLDOWN_MS = 60_000;
const DEMO_CODE = '123456';
const EXPIRED_CODE = '000000';

interface MockSession {
  secret: string;
  session: OnboardingSession;
  record: RosterRecord;
  createdAt: number;
  confirmFailures: ConfirmFailure[];
  /** When the set-password email last went, for its cooldown. */
  passwordEmailAt?: number;
}

const sessions = new Map<string, MockSession>();
/** Answers of confirm and resend-password-email by session and Idempotency-Key, for replays. */
const idempotentAnswers = new Map<string, { status: number; body: string | null }>();
const misses = new Map<string, { count: number; blockedUntil: number }>();
/** Records onboarded through the mock, so identifying again reports already-onboarded. */
const onboarded = new Set<RosterRecord>();
const FIRST_OFR = 418;
let nextOfr = FIRST_OFR;

/** Clears sessions, rate-limit counters and onboarded records; for tests. */
export function resetOnboardingMock() {
  sessions.clear();
  idempotentAnswers.clear();
  misses.clear();
  onboarded.clear();
  nextOfr = FIRST_OFR;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': status >= 400 ? 'application/problem+json' : 'application/json',
      ...headers,
    },
  });
}

function problem(
  status: number,
  code: OnboardingProblem['code'],
  title: string,
  extra: Partial<OnboardingProblem> = {},
  headers: Record<string, string> = {},
) {
  const body: OnboardingProblem = {
    type: `https://adili.go.ke/problems/${code}`,
    title,
    status,
    code,
    ...extra,
  };
  return json(status, body, headers);
}

function createSession(record: RosterRecord, commission: OnboardingCommission) {
  const id = crypto.randomUUID();
  const secret = crypto.randomUUID();
  const hasEmail = record.email !== null;
  const now = Date.now();
  const session: OnboardingSession = {
    id,
    state: hasEmail ? 'email-pending' : 'email-contact-required',
    commission,
    contacts: {
      email: hasEmail ? { masked: record.email ?? '', source: 'roster', verified: false } : null,
      phone:
        record.phone === null ? null : { masked: record.phone, source: 'roster', verified: false },
    },
    details: null,
    otp: hasEmail ? freshOtp('email') : idleOtp(),
    outcome: null,
    ofr: null,
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
  };
  sessions.set(id, {
    secret,
    session,
    record,
    createdAt: now,
    confirmFailures: [...(record.confirmFailures ?? [])],
  });
  const created: OnboardingSessionCreated = { ...session, secret };
  return created;
}

function identify(body: IdentifyDeclarant, clientIp: string) {
  const commission = ONBOARDING_COMMISSIONS.find((entry) => entry.slug === body.commission);
  if (!commission?.hasRoster) {
    return problem(409, 'no-roster', 'This Commission has not imported its roster');
  }

  const key = `${clientIp}:${commission.slug}`;
  const counter = misses.get(key) ?? { count: 0, blockedUntil: 0 };
  const now = Date.now();
  if (counter.blockedUntil > now) {
    const retryAfterSeconds = Math.ceil((counter.blockedUntil - now) / 1000);
    return problem(
      429,
      'rate-limit-exceeded',
      'Too many attempts',
      { retryAfterSeconds },
      { 'RateLimit-Reset': String(retryAfterSeconds) },
    );
  }

  const nationalId = body.nationalId.replace(/\s/g, '');
  const record = ROSTER.find(
    (entry) =>
      entry.commission === commission.slug &&
      entry.personnelFileNumber.toLowerCase() === body.personnelFileNumber.trim().toLowerCase() &&
      entry.nationalId === nationalId,
  );
  if (!record) {
    counter.count += 1;
    if (counter.count >= MISSES_BEFORE_LIMIT) {
      counter.count = 0;
      counter.blockedUntil = now + LIMIT_SECONDS * 1000;
    }
    misses.set(key, counter);
    return problem(404, 'no-match', 'No matching roster record');
  }
  misses.delete(key);

  if (record.onboarded || onboarded.has(record)) {
    return problem(409, 'already-onboarded', 'Already onboarded', {
      links: { signIn: '/auth/login', recoverAccess: '/auth/recover' },
    });
  }
  return json(201, createSession(record, commission));
}

function freshOtp(channel: OtpChannel): OnboardingSession['otp'] {
  return {
    channel,
    resendAvailableAt: new Date(Date.now() + RESEND_COOLDOWN_MS).toISOString(),
    resendsLeft: RESENDS,
    attemptsLeft: CODE_ATTEMPTS,
  };
}

function idleOtp(): OnboardingSession['otp'] {
  return { channel: null, resendAvailableAt: null, resendsLeft: 0, attemptsLeft: 0 };
}

const notFound = () => json(404, { type: 'about:blank', title: 'Not found', status: 404 });
const sessionEnded = () => problem(410, 'session-expired', 'Session ended');
const wrongStep = () => problem(409, 'wrong-step', 'Session is not waiting for this');

/** The live session for an id and secret, or the response that refuses it. */
function liveSession(sessionId: string, secret: string | null): MockSession | Response {
  const entry = sessions.get(sessionId);
  if (!entry) return notFound();
  if (entry.secret !== secret) return notFound();
  if (Date.parse(entry.session.expiresAt) <= Date.now()) {
    sessions.delete(sessionId);
    return sessionEnded();
  }
  return entry;
}

function endSession(sessionId: string) {
  sessions.delete(sessionId);
  return sessionEnded();
}

/** Each successful step adds ten minutes, up to an hour after the session opened. */
function extend(entry: MockSession) {
  const expiresAt = Math.min(
    Date.parse(entry.session.expiresAt) + STEP_EXTENSION_MS,
    entry.createdAt + SESSION_CAP_MS,
  );
  entry.session.expiresAt = new Date(expiresAt).toISOString();
}

function getSession(sessionId: string, secret: string | null) {
  const entry = liveSession(sessionId, secret);
  return entry instanceof Response ? entry : json(200, entry.session);
}

/** Moves the session on to the phone once the email is verified. */
function afterEmail(entry: MockSession) {
  const { session } = entry;
  session.contacts.email = session.contacts.email && { ...session.contacts.email, verified: true };
  if (session.contacts.phone) {
    session.state = 'phone-pending';
    session.otp = freshOtp('phone');
  } else {
    session.state = 'phone-contact-required';
    session.otp = idleOtp();
  }
}

function afterPhone(entry: MockSession) {
  const { session, record } = entry;
  session.contacts.phone = session.contacts.phone && { ...session.contacts.phone, verified: true };
  session.state = 'phone-verified';
  session.otp = idleOtp();
  session.details = {
    fullName: record.fullName,
    personnelFileNumber: record.personnelFileNumber,
    designation: record.designation,
    reportingEntity: record.reportingEntity,
  };
}

function verify(entry: MockSession, sessionId: string, channel: OtpChannel, code: string) {
  const { session } = entry;
  if (session.state !== `${channel}-pending`) return wrongStep();
  if (code === EXPIRED_CODE) return problem(400, 'otp-expired', 'Code expired');
  if (code !== DEMO_CODE) {
    session.otp.attemptsLeft -= 1;
    if (session.otp.attemptsLeft <= 0) return endSession(sessionId);
    return problem(400, 'otp-invalid', 'Wrong code', { attemptsLeft: session.otp.attemptsLeft });
  }
  if (channel === 'email') afterEmail(entry);
  else afterPhone(entry);
  extend(entry);
  return json(200, session);
}

function resend(entry: MockSession, sessionId: string, channel: OtpChannel) {
  const { otp } = entry.session;
  if (entry.session.state !== `${channel}-pending`) return wrongStep();
  const wait = otp.resendAvailableAt === null ? 0 : Date.parse(otp.resendAvailableAt) - Date.now();
  if (wait > 0) {
    const retryAfterSeconds = Math.ceil(wait / 1000);
    return problem(
      429,
      'resend-cooldown',
      'Wait before asking for another code',
      { retryAfterSeconds },
      { 'RateLimit-Reset': String(retryAfterSeconds) },
    );
  }
  if (otp.resendsLeft <= 0) return endSession(sessionId);
  entry.session.otp = {
    ...freshOtp(channel),
    resendsLeft: otp.resendsLeft - 1,
  };
  return new Response(null, { status: 202 });
}

function provide(entry: MockSession, channel: OtpChannel, value: string) {
  const { session } = entry;
  if (session.state !== `${channel}-contact-required`) return wrongStep();
  const valid =
    channel === 'email'
      ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
      : /^\+[1-9]\d{7,14}$/.test(value);
  if (!valid) {
    return json(400, { type: 'about:blank', title: 'Invalid contact', status: 400 });
  }
  session.contacts[channel] = {
    masked: maskContact(channel, value),
    source: 'declarant',
    verified: false,
  };
  session.state = `${channel}-pending`;
  session.otp = freshOtp(channel);
  return json(200, session);
}

/** A new officer reference. The check character is not the real ISO 7064 one. */
function allocateOfr(): string {
  const digits = String(nextOfr).padStart(7, '0');
  nextOfr += 1;
  return `OFR-${digits}-X`;
}

/**
 * Starts the 60-second wait before the set-password email can be sent again. The contract lets
 * the directory leave `otp.resendAvailableAt` null here, so the mock does after confirm (the
 * portal then waits the full cooldown from the page load) and gives the time after a resend.
 */
function passwordEmailSent(entry: MockSession, { reportWait }: { reportWait: boolean }) {
  const now = Date.now();
  entry.passwordEmailAt = now;
  entry.session.otp = {
    ...idleOtp(),
    resendAvailableAt: reportWait ? new Date(now + RESEND_COOLDOWN_MS).toISOString() : null,
  };
}

function confirm(entry: MockSession) {
  const { session, record } = entry;
  if (session.state !== 'phone-verified') return wrongStep();
  const failure = entry.confirmFailures.shift();
  if (failure === 'iprs-unavailable') {
    return problem(503, 'iprs-unavailable', 'The national register is not responding');
  }
  if (failure === 'identity-unavailable') {
    return problem(502, 'identity-unavailable', 'The account could not be created');
  }
  if (record.iprs === 'mismatch') {
    session.state = 'identity-mismatch';
    session.outcome = 'identity-mismatch';
  } else {
    session.state = 'confirmed';
    session.outcome = record.existingOfr ? 'linked-existing-account' : 'account-created';
    session.ofr = record.existingOfr ?? allocateOfr();
    onboarded.add(record);
    if (!record.existingOfr) passwordEmailSent(entry, { reportWait: false });
  }
  return json(200, { outcome: session.outcome, session });
}

function resendPasswordEmail(entry: MockSession) {
  const { session } = entry;
  if (session.state !== 'confirmed' || session.outcome !== 'account-created') return wrongStep();
  const wait = secondsUntilPasswordEmail(entry);
  if (wait > 0) {
    return problem(
      429,
      'resend-cooldown',
      'Wait before asking for another email',
      { retryAfterSeconds: wait },
      { 'RateLimit-Reset': String(wait) },
    );
  }
  passwordEmailSent(entry, { reportWait: true });
  return new Response(null, { status: 202 });
}

function secondsUntilPasswordEmail({ passwordEmailAt }: MockSession): number {
  const wait =
    passwordEmailAt === undefined ? 0 : passwordEmailAt + RESEND_COOLDOWN_MS - Date.now();
  return wait > 0 ? Math.ceil(wait / 1000) : 0;
}

/**
 * The directory's Idempotency-Key handling on confirm and resend-password-email: the header is
 * required, a 2xx or 4xx answer is kept, and a retry with the same key gets it back.
 */
async function idempotent(
  request: Request,
  sessionId: string,
  run: () => Response,
): Promise<Response> {
  const key = request.headers.get('idempotency-key');
  if (!key) {
    return json(400, {
      type: 'idempotency-key-missing',
      title: 'Idempotency-Key required',
      status: 400,
    });
  }
  const scope = `${sessionId}:${key}`;
  const stored = idempotentAnswers.get(scope);
  if (stored) {
    return new Response(stored.body, {
      status: stored.status,
      headers: {
        'content-type': stored.status >= 400 ? 'application/problem+json' : 'application/json',
        'idempotent-replayed': 'true',
      },
    });
  }
  const response = run();
  if (response.status < 500) {
    idempotentAnswers.set(scope, {
      status: response.status,
      body: response.body ? await response.clone().text() : null,
    });
  }
  return response;
}

export async function mockDirectoryFetch(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'GET' && path === '/v1/onboarding/commissions') {
    const search = url.searchParams.get('search')?.toLowerCase() ?? '';
    return json(
      200,
      ONBOARDING_COMMISSIONS.filter((entry) => entry.name.toLowerCase().includes(search)),
    );
  }

  if (request.method === 'GET' && path === '/v1/me/declarant') {
    return myDeclarantProfile(request);
  }

  if (request.method === 'POST' && path === '/v1/onboarding/sessions') {
    const body = (await request.json()) as IdentifyDeclarant;
    return identify(body, request.headers.get('x-forwarded-for') ?? 'unknown');
  }

  const secret = request.headers.get('x-onboarding-secret');
  const sessionMatch = /^\/v1\/onboarding\/sessions\/([^/]+)$/.exec(path);
  if (request.method === 'GET' && sessionMatch?.[1]) {
    return getSession(sessionMatch[1], secret);
  }

  const stepMatch =
    /^\/v1\/onboarding\/sessions\/([^/]+)\/(contacts|confirm|resend-password-email|otp\/(email|phone)\/(verify|resend))$/.exec(
      path,
    );
  const sessionId = stepMatch?.[1];
  if (request.method === 'POST' && stepMatch && sessionId) {
    const entry = liveSession(sessionId, secret);
    if (entry instanceof Response) return entry;
    const channel = stepMatch[3] as OtpChannel | undefined;
    if (stepMatch[2] === 'confirm') {
      return idempotent(request, sessionId, () => confirm(entry));
    }
    if (stepMatch[2] === 'resend-password-email') {
      return idempotent(request, sessionId, () => resendPasswordEmail(entry));
    }
    if (stepMatch[2] === 'contacts') {
      const body = (await request.json()) as { channel: OtpChannel; value: string };
      return provide(entry, body.channel, body.value);
    }
    if (channel && stepMatch[4] === 'verify') {
      const body = (await request.json()) as { code: string };
      return verify(entry, sessionId, channel, body.code);
    }
    if (channel) return resend(entry, sessionId, channel);
  }

  return json(404, { type: 'about:blank', title: 'Not in the onboarding mock', status: 404 });
}

/** Moves a mock session's expiry into the past; for tests. */
export function expireMockSession(sessionId: string) {
  const entry = sessions.get(sessionId);
  if (entry) entry.session.expiresAt = new Date(Date.now() - 1000).toISOString();
}
