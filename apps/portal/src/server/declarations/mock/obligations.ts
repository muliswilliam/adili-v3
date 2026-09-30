/**
 * The mock's declarant reads of spec 04, `GET /v1/me/obligations` and `GET /v1/obligations/{id}`.
 *
 * Like the real service they answer by the bearer token's `person_id` claim, read without
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

import { json, problem } from '../../mock-http';
import type {
  CommissionRef,
  MyObligations,
  Obligation,
  ObligationDetail,
  ObligationType,
  Reminder,
} from '../types';

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

export interface TokenClaims {
  preferred_username?: string;
  person_id?: string;
  /** Authentication context class: `step-up` after a fresh one-time code (spec 06). */
  acr?: string;
  /** When the user last authenticated, in seconds since the epoch. */
  auth_time?: number;
}

/** The claims of a bearer token, unverified; the mock trusts whatever the BFF sends. */
export function bearerClaims(request: Request): TokenClaims | null {
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

const notFound = () => problem(404, 'Not found, or not visible to the caller');

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

/** Every fixture obligation of every person, for the mock's other endpoints to look up. */
export function anyMockObligation(id: string): Obligation | undefined {
  const fixture = [...twoCommissions(), ...demoDeclarant()].find((entry) => entry.id === id);
  return fixture && toObligation(detail(fixture));
}

/** Whether the request reads the declarant's obligations or one obligation (OBLIGATIONS_MOCK). */
export function isObligationRead(request: Request, path: string): boolean {
  return (
    request.method === 'GET' &&
    (path === '/v1/me/obligations' || /^\/v1\/obligations\/[^/]+$/.test(path))
  );
}

/**
 * Answers the obligation reads, or null for any other request. A request without a bearer
 * token gets 401.
 */
export function obligationReads(request: Request, path: string): Response | null {
  if (!isObligationRead(request, path)) return null;
  const one = /^\/v1\/obligations\/([^/]+)$/.exec(path)?.[1];
  const list = path === '/v1/me/obligations';

  const claims = bearerClaims(request);
  if (!claims) return problem(401, 'Unauthorized');
  const obligations = obligationsOf(claims);
  if (list) return obligations ? json(200, myObligations(obligations)) : notFound();
  const obligation = obligations?.find((entry) => entry.id === one);
  return obligation ? json(200, obligation) : notFound();
}
