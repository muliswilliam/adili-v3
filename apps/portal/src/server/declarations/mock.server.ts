/**
 * In-memory stand-in for the declarations service's declarant reads, `GET /v1/me/obligations`
 * and `GET /v1/obligations/{id}` (spec 04), used when DECLARATIONS_MOCK is set to work on the
 * portal without the service.
 *
 * Like the real service it answers by the bearer token's `person_id` claim, read without
 * checking the signature; a token without one gets 404. Fixtures, dated from today so the
 * statuses stay true:
 * - OFR-0000417-4 (Grace Wambui Njeri, as in the directory mock), by username or person id: an
 *   overdue final declaration at the Public Service Commission with a sent and a failed
 *   reminder, and a due initial and the upcoming biennial at the National Police Service
 *   Commission
 * - anyone else with a `person_id` (the realm's demo `declarant`): a due initial declaration
 *   and the upcoming biennial at the Teachers Service Commission
 */
import { formatCalendarDate } from '@adili/ui';

import type {
  CommissionRef,
  MyObligations,
  Obligation,
  ObligationDetail,
  ObligationType,
  Reminder,
} from './types';

const TSC: CommissionRef = { slug: 'tsc', issuerCode: 'TSC', name: 'Teachers Service Commission' };
const PSC: CommissionRef = { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' };
const NPSC: CommissionRef = {
  slug: 'npsc',
  issuerCode: 'NPSC',
  name: 'National Police Service Commission',
};

const DAY_MS = 86_400_000;
const INITIAL_DUE_AFTER_DAYS = 30;
const FINAL_DUE_AFTER_DAYS = 30;

/** Today's calendar date in Kenya, moved by a number of days. */
function day(offset: number): string {
  return formatCalendarDate(Date.now() + offset * DAY_MS);
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** A date-time on a calendar day, at a time of day in Kenya (UTC+3). */
function at(date: string, time: string): string {
  return new Date(`${date}T${time}:00+03:00`).toISOString();
}

function statusOn(statementDate: string, dueDate: string): Obligation['status'] {
  const today = day(0);
  if (today < statementDate) return 'upcoming';
  return today <= dueDate ? 'due' : 'overdue';
}

interface Fixture {
  id: string;
  commission: CommissionRef;
  type: ObligationType;
  statementDate: string;
  reminders: Reminder[];
}

function dueDateOf({ type, statementDate }: Pick<Fixture, 'type' | 'statementDate'>): string {
  if (type === 'biennial') return `${statementDate.slice(0, 4)}-12-31`;
  return addDays(statementDate, type === 'initial' ? INITIAL_DUE_AFTER_DAYS : FINAL_DUE_AFTER_DAYS);
}

function detail(fixture: Fixture): ObligationDetail {
  const { id, commission, type, statementDate, reminders } = fixture;
  const dueDate = dueDateOf(fixture);
  return {
    id,
    commission,
    type,
    cycleKey:
      type === 'biennial' ? `biennial:${statementDate.slice(0, 4)}` : `${type}:${statementDate}`,
    statementDate,
    dueDate,
    status: statusOn(statementDate, dueDate),
    cancelReason: null,
    remindersSent: reminders.filter((reminder) => reminder.outcome === 'sent').length,
    policyVersion: 1,
    createdAt: at(day(-2), '06:15'),
    reminders,
    declarant: null,
  };
}

/** A reminder `offsetDays` before a due date, scheduled mid-morning. */
function reminder(
  dueDate: string,
  offsetDays: number,
  outcome: Reminder['outcome'],
  channels: Reminder['channels'] = [],
): Reminder {
  const scheduledAt = at(addDays(dueDate, -offsetDays), '09:12');
  return {
    offsetDays,
    scheduledAt,
    sentAt: outcome === 'sent' ? scheduledAt : null,
    channels,
    outcome,
  };
}

function biennial2027(id: string, commission: CommissionRef): Fixture {
  return { id, commission, type: 'biennial', statementDate: '2027-11-01', reminders: [] };
}

function demoDeclarant(): Fixture[] {
  const appointed = day(-24);
  return [
    {
      id: '01926b3e-7a10-7c3d-9e2f-3a4b5c6d7e01',
      commission: TSC,
      type: 'initial',
      statementDate: appointed,
      reminders: [
        reminder(addDays(appointed, INITIAL_DUE_AFTER_DAYS), 30, 'skipped-past-due-at-creation'),
        reminder(addDays(appointed, INITIAL_DUE_AFTER_DAYS), 14, 'skipped-not-onboarded'),
      ],
    },
    biennial2027('01926b3e-7a10-7c3d-9e2f-3a4b5c6d7e02', TSC),
  ];
}

function twoCommissions(): Fixture[] {
  const exited = day(-75);
  const exitDue = addDays(exited, FINAL_DUE_AFTER_DAYS);
  return [
    {
      id: '01926b3e-7a10-7c3d-9e2f-3a4b5c6d7e11',
      commission: PSC,
      type: 'final',
      statementDate: exited,
      reminders: [
        reminder(exitDue, 14, 'sent', ['sms', 'email']),
        reminder(exitDue, 7, 'failed', ['sms']),
      ],
    },
    {
      id: '01926b3e-7a10-7c3d-9e2f-3a4b5c6d7e12',
      commission: NPSC,
      type: 'initial',
      statementDate: day(-10),
      reminders: [],
    },
    biennial2027('01926b3e-7a10-7c3d-9e2f-3a4b5c6d7e13', NPSC),
  ];
}

interface TokenClaims {
  preferred_username?: string;
  person_id?: string;
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

const TWO_COMMISSIONS_PERSON = '8d7f3a90-2b1c-4e5d-a6f7-9081a2b3c4d5';

/** The caller's obligations, or null when the token carries no person. */
function obligationsOf(claims: TokenClaims): ObligationDetail[] | null {
  if (!claims.person_id) return null;
  const fixtures =
    claims.person_id === TWO_COMMISSIONS_PERSON || claims.preferred_username === 'OFR-0000417-4'
      ? twoCommissions()
      : demoDeclarant();
  return fixtures.map(detail);
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });
}

const notFound = () =>
  json(404, { type: 'about:blank', title: 'Not found, or not visible to the caller', status: 404 });

function toObligation(detail: ObligationDetail): Obligation {
  const { id, commission, type, cycleKey, statementDate, dueDate, status } = detail;
  const { cancelReason, remindersSent, policyVersion, createdAt } = detail;
  return {
    id,
    commission,
    type,
    cycleKey,
    statementDate,
    dueDate,
    status,
    cancelReason,
    remindersSent,
    policyVersion,
    createdAt,
  };
}

function myObligations(obligations: ObligationDetail[]): MyObligations {
  const groups: MyObligations['groups'] = [];
  for (const obligation of obligations) {
    const group = groups.find((entry) => entry.commission.slug === obligation.commission.slug);
    if (group) group.obligations.push(toObligation(obligation));
    else
      groups.push({ commission: obligation.commission, obligations: [toObligation(obligation)] });
  }
  return { groups };
}

export function mockDeclarationsFetch(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  const claims = bearerClaims(request);
  if (!claims) {
    return Promise.resolve(json(401, { type: 'about:blank', title: 'Unauthorized', status: 401 }));
  }
  const obligations = obligationsOf(claims);

  if (request.method === 'GET' && path === '/v1/me/obligations') {
    return Promise.resolve(obligations ? json(200, myObligations(obligations)) : notFound());
  }

  const one = /^\/v1\/obligations\/([^/]+)$/.exec(path)?.[1];
  if (request.method === 'GET' && one) {
    const obligation = obligations?.find((entry) => entry.id === one);
    return Promise.resolve(obligation ? json(200, obligation) : notFound());
  }

  return Promise.resolve(
    json(404, { type: 'about:blank', title: 'Not in the declarations mock', status: 404 }),
  );
}
