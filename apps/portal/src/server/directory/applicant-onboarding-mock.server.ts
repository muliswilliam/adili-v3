/**
 * In-memory stand-in for the directory's applicant onboarding endpoints
 * (`/v1/onboarding/applicants/...`, spec 10), part of the directory mock (DIRECTORY_MOCK).
 *
 * Demo applicants:
 * - National ID 28841276 with surname Kamau (e.g. Mercy Wanjiru Kamau): matches the national
 *   register
 * - National ID 30112233: already has an applicant account
 * - National ID 90909090 with surname Kamau: matches, but every answer takes 4 seconds, to see
 *   the busy states
 * - National ID 40404040: the national register is down (503)
 * - National ID 70707070: the code cannot be sent (502 `otp-send-failed`)
 * - National ID 80808080: the directory fails (500)
 * - National ID 50505050 with surname Otieno: matches, but creating the account fails once (502)
 * - National ID 60606060 with surname Achieng: matches, but the set-password email cannot be
 *   sent (`setPasswordEmail: failed`); resending it works
 * - Email taken@example.com: the address belongs to another account, so complete answers 409
 *   `email-in-use`
 * - Phone 0700 000 000: the first code goes, but a new one cannot be sent (502 `otp-send-failed`)
 * Any other national ID does not match (409 `identity-mismatch`). Any passport is accepted (no
 * register check) and its account is pending verification. Five starts from one address that do
 * not open a session are rate-limited for 15 minutes.
 *
 * Every code is 123456; 000000 is treated as expired. Five wrong codes or a fourth resend end
 * the session, resends wait 60 seconds, as in the declarant's mock.
 */
import { maskContact } from '@adili/ui';

import { json } from '../mock-http';
import type {
  ApplicantOnboardingProblem,
  ApplicantOnboardingSession,
  ApplicantOnboardingSessionCreated,
  StartApplicantOnboarding,
} from './types';

const SESSION_TTL_MS = 30 * 60 * 1000;
const STEP_EXTENSION_MS = 10 * 60 * 1000;
const SESSION_CAP_MS = 60 * 60 * 1000;
const CONFIRMED_TTL_MS = 24 * 60 * 60 * 1000;
const MISSES_BEFORE_LIMIT = 5;
const LIMIT_SECONDS = 15 * 60;
const CODE_ATTEMPTS = 5;
const RESENDS = 3;
const RESEND_COOLDOWN_MS = 60_000;
const DEMO_CODE = '123456';
const EXPIRED_CODE = '000000';

interface Registered {
  surname: string;
  completeFailures?: number;
  setPasswordEmailFails?: boolean;
  /** Every answer for this person takes this long, to see the busy states. */
  latencyMs?: number;
}

/** The national register's people the mock knows, by national ID. */
const REGISTER: Record<string, Registered> = {
  '28841276': { surname: 'kamau' },
  '90909090': { surname: 'kamau', latencyMs: 4000 },
  '50505050': { surname: 'otieno', completeFailures: 1 },
  '60606060': { surname: 'achieng', setPasswordEmailFails: true },
};
const ALREADY_ONBOARDED = '30112233';
const REGISTER_DOWN = '40404040';
const SEND_FAILS = '70707070';
const DIRECTORY_FAILS = '80808080';
const TAKEN_EMAIL = 'taken@example.com';
const UNREACHABLE_PHONE = '+254700000000';

interface MockApplicantSession {
  secret: string;
  session: ApplicantOnboardingSession;
  createdAt: number;
  email: string;
  completeFailures: number;
  setPasswordEmailFails: boolean;
  latencyMs: number;
  /** E.164, as the BFF sent it. */
  phone: string;
  passwordEmailAt?: number;
}

const sessions = new Map<string, MockApplicantSession>();
const idempotentAnswers = new Map<string, { status: number; body: string | null }>();
const misses = new Map<string, { count: number; blockedUntil: number }>();
/** Documents onboarded through the mock, so starting again reports already-onboarded. */
const onboarded = new Set<string>();
/** The document each session was started with, to mark it onboarded at complete. */
const onboardingDocuments = new Map<string, string>();

/** Clears sessions, rate-limit counters and onboarded documents; for tests. */
export function resetApplicantOnboardingMock() {
  sessions.clear();
  onboardingDocuments.clear();
  idempotentAnswers.clear();
  misses.clear();
  onboarded.clear();
}

function problem(
  status: number,
  code: ApplicantOnboardingProblem['code'],
  title: string,
  extra: Partial<ApplicantOnboardingProblem> = {},
  headers: Record<string, string> = {},
) {
  const body: ApplicantOnboardingProblem = {
    type: `https://adili.go.ke/problems/${code}`,
    title,
    status,
    code,
    ...extra,
  };
  return json(status, body, headers);
}

const notFound = () => json(404, { type: 'about:blank', title: 'Not found', status: 404 });
const sessionEnded = () => problem(410, 'session-expired', 'Session ended');
const wrongStep = () => problem(409, 'wrong-step', 'Session is not waiting for this');

function freshOtp(): ApplicantOnboardingSession['otp'] {
  return {
    channel: 'phone',
    resendAvailableAt: new Date(Date.now() + RESEND_COOLDOWN_MS).toISOString(),
    resendsLeft: RESENDS,
    attemptsLeft: CODE_ATTEMPTS,
  };
}

function idleOtp(resendAvailableAt: string | null = null): ApplicantOnboardingSession['otp'] {
  return { channel: null, resendAvailableAt, resendsLeft: 0, attemptsLeft: 0 };
}

function documentKey({ identityDocument: document }: StartApplicantOnboarding): string {
  const number = document.number.replace(/\s/g, '').toUpperCase();
  return document.kind === 'passport'
    ? `passport:${(document.country ?? '').toUpperCase()}:${number}`
    : `national-id:${number}`;
}

/** Counts a start that opened no session; the fifth in a row blocks the address. */
function miss(key: string) {
  const counter = misses.get(key) ?? { count: 0, blockedUntil: 0 };
  counter.count += 1;
  if (counter.count >= MISSES_BEFORE_LIMIT) {
    counter.count = 0;
    counter.blockedUntil = Date.now() + LIMIT_SECONDS * 1000;
  }
  misses.set(key, counter);
}

function start(body: StartApplicantOnboarding, clientIp: string) {
  const counter = misses.get(clientIp);
  const now = Date.now();
  if (counter && counter.blockedUntil > now) {
    const retryAfterSeconds = Math.ceil((counter.blockedUntil - now) / 1000);
    return problem(
      429,
      'rate-limit-exceeded',
      'Too many attempts',
      { retryAfterSeconds },
      { 'RateLimit-Reset': String(retryAfterSeconds), 'Retry-After': String(retryAfterSeconds) },
    );
  }

  const { identityDocument: document, names } = body;
  const number = document.number.replace(/\s/g, '').toUpperCase();
  let registered: Registered | undefined;
  if (document.kind === 'national-id') {
    if (number === REGISTER_DOWN) {
      return problem(503, 'iprs-unavailable', 'The national register is not responding');
    }
    if (number === SEND_FAILS) {
      return problem(502, 'otp-send-failed', 'The code could not be sent');
    }
    if (number === DIRECTORY_FAILS) {
      return json(500, { type: 'about:blank', title: 'Internal server error', status: 500 });
    }
    registered = REGISTER[number];
    const onRegister =
      number === ALREADY_ONBOARDED || registered?.surname === names.surname.trim().toLowerCase();
    if (!onRegister) {
      miss(clientIp);
      return problem(409, 'identity-mismatch', 'The national register does not match');
    }
  }
  if (number === ALREADY_ONBOARDED || onboarded.has(documentKey(body))) {
    miss(clientIp);
    return problem(409, 'already-onboarded', 'Already onboarded', {
      links: { signIn: '/auth/login', recoverAccess: '/auth/recover' },
    });
  }
  misses.delete(clientIp);

  const id = crypto.randomUUID();
  const secret = crypto.randomUUID();
  const session: ApplicantOnboardingSession = {
    id,
    state: 'phone-pending',
    fullName: [names.firstName, names.otherNames, names.surname].filter(Boolean).join(' '),
    identityDocument: {
      kind: document.kind,
      number,
      country: document.kind === 'passport' ? (document.country ?? '').toUpperCase() : null,
    },
    identityStatus: document.kind === 'national-id' ? 'verified' : 'pending-verification',
    contacts: {
      phone: { masked: maskContact('phone', body.phone), verified: false },
      email: { masked: maskContact('email', body.email) },
    },
    otp: freshOtp(),
    outcome: null,
    setPasswordEmail: null,
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
  };
  sessions.set(id, {
    secret,
    session,
    createdAt: now,
    email: body.email.trim().toLowerCase(),
    completeFailures: registered?.completeFailures ?? 0,
    setPasswordEmailFails: registered?.setPasswordEmailFails ?? false,
    latencyMs: registered?.latencyMs ?? 0,
    phone: body.phone,
  });
  onboardingDocuments.set(id, documentKey(body));
  const created: ApplicantOnboardingSessionCreated = { ...session, secret };
  return json(201, created);
}

function liveSession(sessionId: string, secret: string | null): MockApplicantSession | Response {
  const entry = sessions.get(sessionId);
  if (entry?.secret !== secret) return notFound();
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

function extend(entry: MockApplicantSession) {
  const expiresAt = Math.min(
    Date.parse(entry.session.expiresAt) + STEP_EXTENSION_MS,
    entry.createdAt + SESSION_CAP_MS,
  );
  entry.session.expiresAt = new Date(expiresAt).toISOString();
}

function verify(entry: MockApplicantSession, sessionId: string, code: string) {
  const { session } = entry;
  if (session.state !== 'phone-pending') return wrongStep();
  if (code === EXPIRED_CODE) return problem(400, 'otp-expired', 'Code expired');
  if (code !== DEMO_CODE) {
    session.otp.attemptsLeft -= 1;
    if (session.otp.attemptsLeft <= 0) return endSession(sessionId);
    return problem(400, 'otp-invalid', 'Wrong code', { attemptsLeft: session.otp.attemptsLeft });
  }
  session.state = 'phone-verified';
  session.contacts.phone = session.contacts.phone && { ...session.contacts.phone, verified: true };
  session.otp = idleOtp();
  extend(entry);
  return json(200, session);
}

function resend(entry: MockApplicantSession, sessionId: string) {
  const { otp, state } = entry.session;
  if (state !== 'phone-pending') return wrongStep();
  const wait = otp.resendAvailableAt === null ? 0 : Date.parse(otp.resendAvailableAt) - Date.now();
  if (wait > 0) {
    const retryAfterSeconds = Math.ceil(wait / 1000);
    return problem(429, 'resend-cooldown', 'Wait before asking for another code', {
      retryAfterSeconds,
    });
  }
  if (otp.resendsLeft <= 0) return endSession(sessionId);
  if (entry.phone === UNREACHABLE_PHONE) {
    return problem(502, 'otp-send-failed', 'The code could not be sent');
  }
  entry.session.otp = { ...freshOtp(), resendsLeft: otp.resendsLeft - 1 };
  return new Response(null, { status: 202 });
}

function passwordEmailSent(entry: MockApplicantSession, { reportWait }: { reportWait: boolean }) {
  const now = Date.now();
  entry.passwordEmailAt = now;
  entry.session.setPasswordEmail = 'sent';
  entry.session.otp = idleOtp(reportWait ? new Date(now + RESEND_COOLDOWN_MS).toISOString() : null);
}

function complete(entry: MockApplicantSession, sessionId: string) {
  const { session } = entry;
  if (session.state !== 'phone-verified') return wrongStep();
  if (entry.completeFailures > 0) {
    entry.completeFailures -= 1;
    return problem(502, 'identity-unavailable', 'The account could not be created');
  }
  if (entry.email === TAKEN_EMAIL) {
    return problem(409, 'email-in-use', 'The email belongs to another account');
  }
  const document = onboardingDocuments.get(sessionId);
  if (document && onboarded.has(document)) {
    return problem(409, 'already-onboarded', 'Already onboarded', {
      links: { signIn: '/auth/login', recoverAccess: '/auth/recover' },
    });
  }
  if (document) onboarded.add(document);
  session.state = 'confirmed';
  session.outcome = 'account-created';
  session.expiresAt = new Date(Date.now() + CONFIRMED_TTL_MS).toISOString();
  if (entry.setPasswordEmailFails) {
    entry.setPasswordEmailFails = false;
    session.setPasswordEmail = 'failed';
    session.otp = idleOtp();
  } else {
    passwordEmailSent(entry, { reportWait: false });
  }
  return json(200, session);
}

function resendPasswordEmail(entry: MockApplicantSession) {
  const { session } = entry;
  if (session.state !== 'confirmed') return wrongStep();
  const wait =
    entry.passwordEmailAt === undefined
      ? 0
      : Math.ceil((entry.passwordEmailAt + RESEND_COOLDOWN_MS - Date.now()) / 1000);
  if (wait > 0) {
    return problem(429, 'resend-cooldown', 'Wait before asking for another email', {
      retryAfterSeconds: wait,
    });
  }
  passwordEmailSent(entry, { reportWait: true });
  return new Response(null, { status: 202 });
}

/** The directory's Idempotency-Key handling on complete and resend-password-email. */
async function idempotent(
  request: Request,
  sessionId: string,
  run: () => Response,
): Promise<Response> {
  const key = request.headers.get('idempotency-key');
  if (!key) {
    return json(400, { type: 'about:blank', title: 'Idempotency-Key required', status: 400 });
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

function wait(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

const SESSION_PATH = /^\/v1\/onboarding\/applicants\/([^/]+)$/;
const STEP_PATH =
  /^\/v1\/onboarding\/applicants\/([^/]+)\/(otp\/verify|otp\/resend|complete|resend-password-email)$/;

/** Answers an applicant onboarding request, or null for any other path. */
export async function mockApplicantOnboardingFetch(request: Request): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (request.method === 'POST' && path === '/v1/onboarding/applicants') {
    const body = (await request.json()) as StartApplicantOnboarding;
    const number = body.identityDocument.number.replace(/\s/g, '');
    await wait(REGISTER[number]?.latencyMs ?? 0);
    return start(body, request.headers.get('x-forwarded-for') ?? 'unknown');
  }

  const secret = request.headers.get('x-onboarding-secret');
  const sessionId = SESSION_PATH.exec(path)?.[1];
  if (request.method === 'GET' && sessionId) {
    const entry = liveSession(sessionId, secret);
    return entry instanceof Response ? entry : json(200, entry.session);
  }

  const step = STEP_PATH.exec(path);
  const stepSessionId = step?.[1];
  if (request.method !== 'POST' || !step || !stepSessionId) return null;
  const entry = liveSession(stepSessionId, secret);
  if (entry instanceof Response) return entry;
  await wait(entry.latencyMs);
  switch (step[2]) {
    case 'otp/verify': {
      const body = (await request.json()) as { code: string };
      return verify(entry, stepSessionId, body.code);
    }
    case 'otp/resend':
      return resend(entry, stepSessionId);
    case 'complete':
      return idempotent(request, stepSessionId, () => complete(entry, stepSessionId));
    default:
      return idempotent(request, stepSessionId, () => resendPasswordEmail(entry));
  }
}

/** Lets the next resend of a mock session through its cooldown; for tests. */
export function endMockApplicantResendCooldown(sessionId: string) {
  const entry = sessions.get(sessionId);
  if (entry) entry.session.otp.resendAvailableAt = new Date(Date.now() - 1000).toISOString();
}

/** Moves a mock session's expiry into the past; for tests. */
export function expireMockApplicantSession(sessionId: string) {
  const entry = sessions.get(sessionId);
  if (entry) entry.session.expiresAt = new Date(Date.now() - 1000).toISOString();
}
