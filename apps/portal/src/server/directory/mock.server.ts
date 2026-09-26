/**
 * In-memory stand-in for the directory's public onboarding endpoints (contract draft, spec 03),
 * used when DIRECTORY_MOCK is set until the directory implements them (#67).
 *
 * Demo declarants (personnel file number / national ID):
 * - TSC/100200 / 12345678 at the Teachers Service Commission: match, code sent to the roster email
 * - PSC/300400 / 23456789 at the Public Service Commission: match, roster has no email
 * - TSC/999999 / 11111111 at the Teachers Service Commission: already onboarded
 * Anything else is `no-match`; five misses from one address in a row are rate-limited.
 * The Judicial Service Commission has no roster yet.
 */
import type {
  IdentifyDeclarant,
  OnboardingCommission,
  OnboardingProblem,
  OnboardingSession,
  OnboardingSessionCreated,
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
  personnelFileNumber: string;
  nationalId: string;
  email: string | null;
  phone: string | null;
  onboarded: boolean;
}

const ROSTER: RosterRecord[] = [
  {
    commission: 'tsc',
    personnelFileNumber: 'TSC/100200',
    nationalId: '12345678',
    email: 'j***@tsc.go.ke',
    phone: '07** *** 123',
    onboarded: false,
  },
  {
    commission: 'psc',
    personnelFileNumber: 'PSC/300400',
    nationalId: '23456789',
    email: null,
    phone: '07** *** 456',
    onboarded: false,
  },
  {
    commission: 'tsc',
    personnelFileNumber: 'TSC/999999',
    nationalId: '11111111',
    email: 'm***@tsc.go.ke',
    phone: '07** *** 789',
    onboarded: true,
  },
];

const SESSION_TTL_MS = 30 * 60 * 1000;
const MISSES_BEFORE_LIMIT = 5;
const LIMIT_SECONDS = 15 * 60;

const sessions = new Map<string, { secret: string; session: OnboardingSession }>();
const misses = new Map<string, { count: number; blockedUntil: number }>();

/** Clears sessions and rate-limit counters; for tests. */
export function resetOnboardingMock() {
  sessions.clear();
  misses.clear();
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
    otp: {
      channel: hasEmail ? 'email' : null,
      resendAvailableAt: hasEmail ? new Date(Date.now() + 60_000).toISOString() : null,
      resendsLeft: 3,
      attemptsLeft: 5,
    },
    outcome: null,
    ofr: null,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  };
  sessions.set(id, { secret, session });
  const created: OnboardingSessionCreated = { ...session, secret };
  return created;
}

function identify(body: IdentifyDeclarant, clientIp: string) {
  const commission = ONBOARDING_COMMISSIONS.find((entry) => entry.slug === body.commission);
  if (!commission) return problem(404, 'no-match', 'No matching roster record');
  if (!commission.hasRoster) {
    return problem(409, 'no-roster', 'This Commission has not imported its roster');
  }

  const key = `${clientIp}:${commission.slug}`;
  const counter = misses.get(key) ?? { count: 0, blockedUntil: 0 };
  const now = Date.now();
  if (counter.blockedUntil > now) {
    const retryAfterSeconds = Math.ceil((counter.blockedUntil - now) / 1000);
    return problem(
      429,
      'rate-limited',
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

  if (record.onboarded) {
    return problem(409, 'already-onboarded', 'Already onboarded', {
      links: { signIn: '/auth/login', recoverAccess: '/auth/login?action=recover' },
    });
  }
  return json(201, createSession(record, commission));
}

function getSession(sessionId: string, secret: string | null) {
  const entry = sessions.get(sessionId);
  const notFound = json(404, { type: 'about:blank', title: 'Not found', status: 404 });
  if (!entry) return notFound;
  if (entry.secret !== secret) return notFound;
  if (Date.parse(entry.session.expiresAt) <= Date.now()) {
    sessions.delete(sessionId);
    return problem(410, 'session-expired', 'Session ended');
  }
  return json(200, entry.session);
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

  if (request.method === 'POST' && path === '/v1/onboarding/sessions') {
    const body = (await request.json()) as IdentifyDeclarant;
    return identify(body, request.headers.get('x-forwarded-for') ?? 'unknown');
  }

  const sessionMatch = /^\/v1\/onboarding\/sessions\/([^/]+)$/.exec(path);
  if (request.method === 'GET' && sessionMatch?.[1]) {
    return getSession(sessionMatch[1], request.headers.get('x-onboarding-secret'));
  }

  return json(404, { type: 'about:blank', title: 'Not in the onboarding mock', status: 404 });
}

/** Moves a mock session's expiry into the past; for tests. */
export function expireMockSession(sessionId: string) {
  const entry = sessions.get(sessionId);
  if (entry) entry.session.expiresAt = new Date(Date.now() - 1000).toISOString();
}
