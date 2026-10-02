/**
 * In-memory stand-in for the access service's law enforcement endpoints (access.yaml), used
 * with the Form K mock (`mock.server.ts`) when ACCESS_MOCK is set. One store for every caller,
 * dated relative to when it was seeded, with PSC requests in every state the access officer's
 * tab and request page show, and the demo officer's own requests (Suleiman Ali, DCI) at several
 * Commissions:
 *
 * - `received`: received yesterday from the DCI, to verify ("Kamau" finds the officer sought).
 * - `soon`: received 11 days ago, 3 days left; `breach`: 16 days old and undecided (breached).
 * - `verified`: verified, to decide (ARA).
 * - `granted`: granted, the declarant notified, the package downloaded once.
 * - `expired`: granted a month ago; its download window has closed.
 * - `denied`: denied with Regulation 24 grounds; the declarant was not told.
 * - `tsc`: the demo officer's request to another Commission, received.
 *
 * The access officer verifies and decides; a supervisor gets 403. A law enforcement officer sees
 * only the demo officer's requests (another officer's is 404) and files new ones; a decided grant
 * issues its package three seconds later. A case reference containing `duplicate` is refused with
 * a 400 at `caseReference`; `offline` is 503. Package links point at `/api/mock-files/{id}`.
 */
import { randomUUID } from 'node:crypto';

import { addDays } from '@adili/ui';

import { isRecord, json, problem, readJson } from '../mock-http';
import { type MockCaller, mockCallerOf } from './mock-caller';
import { MOCK_ROSTER, MOCK_ROSTER_IDS, searchMockRoster } from './mock-roster';
import type {
  AccessCommission,
  Decision,
  Ground,
  LeaRequest,
  LeaRequestStatus,
  QueueItem,
  RegisterEntry,
  Scope,
} from './types';

export const MOCK_LEA_IDS = {
  received: 'a11e0000-0000-4000-8000-000000000001',
  soon: 'a11e0000-0000-4000-8000-000000000002',
  breach: 'a11e0000-0000-4000-8000-000000000003',
  verified: 'a11e0000-0000-4000-8000-000000000004',
  granted: 'a11e0000-0000-4000-8000-000000000005',
  expired: 'a11e0000-0000-4000-8000-000000000006',
  denied: 'a11e0000-0000-4000-8000-000000000007',
  tsc: 'a11e0000-0000-4000-8000-000000000008',
} as const;

const LEA_DAYS = 14;
const DOWNLOAD_DAYS = 14;
/** How long the mock's workflow takes to issue the package after a grant. */
const PACKAGE_AFTER_MS = 3000;
const ACCESS_OFFICER_NAME = 'Lucy Wambui';
/** The demo realm's law enforcement officer. */
const DEMO_OFFICER = { subject: 'mock-lea-officer', name: 'Suleiman Ali' };

export const MOCK_COMMISSIONS: AccessCommission[] = [
  { slug: 'jsc', name: 'Judicial Service Commission', years: [2025, 2026] },
  { slug: 'psc', name: 'Public Service Commission', years: [2025, 2026] },
  { slug: 'tsc', name: 'Teachers Service Commission', years: [2026] },
];

const AGENCIES = {
  DCI: {
    code: 'DCI',
    name: 'Directorate of Criminal Investigations',
    legalBasis: 'National Police Service Act, 2011, s.35',
  },
  ODPP: {
    code: 'ODPP',
    name: 'Office of the Director of Public Prosecutions',
    legalBasis:
      'Constitution of Kenya, Art. 157; Office of the Director of Public Prosecutions Act, 2013',
  },
  ARA: {
    code: 'ARA',
    name: 'Asset Recovery Agency',
    legalBasis: 'Proceeds of Crime and Anti-Money Laundering Act, 2009, s.53',
  },
} as const;

type AgencyCode = keyof typeof AGENCIES;

interface Seed {
  id: string;
  commission: string;
  sequence: number;
  agency: AgencyCode;
  officer: { subject: string; name: string };
  sought: LeaRequest['officerSought'];
  reason: string;
  caseReference: string;
  scope: Scope;
  receivedDaysAgo: number;
  verified?: { daysAgo: number; record: string; note: string };
  decision?: {
    daysAgo: number;
    outcome: 'grant' | 'deny';
    grounds?: Ground[];
    reasons: string;
    downloads?: number;
  };
}

interface Stored {
  request: LeaRequest;
  /** When the mock workflow issues the package of a grant (epoch ms), if pending. */
  packageAt: number | null;
}

const requests = new Map<string, Stored>();

const SCOPE_ASSETS: Scope = {
  years: [2025, 2026],
  includeSpouses: true,
  includeChildren: false,
  sections: ['income', 'assets', 'liabilities'],
  includeClarifications: false,
};

const KAMAU_SOUGHT = {
  name: 'Grace Nyambura Kamau',
  entity: 'State Department for Housing and Urban Development',
  workStation: 'Nairobi',
  personnelFileNumber: '20107725',
};

const OTHER_OFFICER = { subject: 'mock-lea-other', name: 'Insp. Peter Kariuki' };

const SEEDS: Seed[] = [
  {
    id: MOCK_LEA_IDS.received,
    commission: 'psc',
    sequence: 12,
    agency: 'DCI',
    officer: DEMO_OFFICER,
    sought: KAMAU_SOUGHT,
    reason:
      'Investigation into the award of housing project tenders worth KES 412 million to companies linked to procurement staff at the State Department. We need to establish whether the officer declared interests in the companies and income consistent with their pay.',
    caseReference: 'DCI/ECU/142/2026',
    scope: SCOPE_ASSETS,
    receivedDaysAgo: 1,
  },
  {
    id: MOCK_LEA_IDS.soon,
    commission: 'psc',
    sequence: 10,
    agency: 'DCI',
    officer: DEMO_OFFICER,
    sought: {
      name: 'Peter Omondi Ouma',
      entity: 'Ministry of Health',
    },
    reason:
      'Suspected diversion of medical equipment leasing payments. The declarations show whether the officer declared an interest in the leasing company.',
    caseReference: 'DCI/ECU/131/2026',
    scope: { ...SCOPE_ASSETS, years: [2026], sections: ['assets', 'other'] },
    receivedDaysAgo: 11,
  },
  {
    id: MOCK_LEA_IDS.breach,
    commission: 'psc',
    sequence: 8,
    agency: 'ODPP',
    officer: { subject: 'mock-lea-odpp', name: 'Collins Kiprotich' },
    sought: { name: 'Esther Wairimu Njoroge', entity: 'State Department for Public Service' },
    reason:
      'Prosecution of a conspiracy to defraud in ICT procurement; the declaration of assets is needed as evidence of unexplained wealth.',
    caseReference: 'ODPP/ACD/77/2026',
    scope: { ...SCOPE_ASSETS, years: [2025], includeSpouses: false, sections: ['assets'] },
    receivedDaysAgo: 16,
  },
  {
    id: MOCK_LEA_IDS.verified,
    commission: 'psc',
    sequence: 9,
    agency: 'ARA',
    officer: { subject: 'mock-lea-ara', name: 'Mary Achieng Otieno' },
    sought: {
      name: 'Peter Mwangi Kamau',
      entity: 'State Department for Housing and Urban Development',
      personnelFileNumber: '20096631',
    },
    reason:
      'Preservation order application over properties in Karen and Nanyuki suspected to be proceeds of corruption.',
    caseReference: 'ARA/PO/58/2026',
    scope: { ...SCOPE_ASSETS, includeChildren: true },
    receivedDaysAgo: 6,
    verified: {
      daysAgo: 4,
      record: MOCK_ROSTER_IDS.peterKamau,
      note: 'Sent from the ARA account of Mary Achieng Otieno, activated in July. Reason and case reference stated.',
    },
  },
  {
    id: MOCK_LEA_IDS.granted,
    commission: 'psc',
    sequence: 7,
    agency: 'DCI',
    officer: DEMO_OFFICER,
    sought: {
      name: 'Josephine Akinyi Ouma',
      entity: 'State Department for Public Works',
      personnelFileNumber: '20113458',
    },
    reason:
      'Investigation into inflated road maintenance contracts. The declarations show income from the contractors.',
    caseReference: 'DCI/ECU/120/2026',
    scope: { ...SCOPE_ASSETS, years: [2026], sections: ['income', 'assets'] },
    receivedDaysAgo: 9,
    verified: {
      daysAgo: 7,
      record: MOCK_ROSTER_IDS.josephine,
      note: 'Provisioned DCI account, activated. Reason and case reference stated.',
    },
    decision: {
      daysAgo: 5,
      outcome: 'grant',
      reasons:
        'Written request from a provisioned DCI account with a stated reason and case reference, for an ongoing investigation.',
      downloads: 1,
    },
  },
  {
    id: MOCK_LEA_IDS.expired,
    commission: 'psc',
    sequence: 3,
    agency: 'DCI',
    officer: DEMO_OFFICER,
    sought: {
      name: 'Lilian Wairimu Njoroge',
      entity: 'The National Treasury',
      personnelFileNumber: '20102284',
    },
    reason: 'Investigation into irregular pending bills payments.',
    caseReference: 'DCI/ECU/88/2026',
    scope: { ...SCOPE_ASSETS, years: [2025], sections: ['income'] },
    receivedDaysAgo: 40,
    verified: {
      daysAgo: 38,
      record: MOCK_ROSTER_IDS.lilian,
      note: 'Provisioned DCI account. Reason and case reference stated.',
    },
    decision: {
      daysAgo: 34,
      outcome: 'grant',
      reasons: 'Written request with reason and case reference from a provisioned DCI account.',
      downloads: 2,
    },
  },
  {
    id: MOCK_LEA_IDS.denied,
    commission: 'psc',
    sequence: 5,
    agency: 'DCI',
    officer: DEMO_OFFICER,
    sought: { name: 'J. Mwangi', entity: 'Ministry of Lands' },
    reason: 'Background check on a land registry officer.',
    caseReference: 'DCI/ECU/101/2026',
    scope: { ...SCOPE_ASSETS, years: [2025, 2026], sections: ['bio', 'income', 'assets'] },
    receivedDaysAgo: 20,
    decision: {
      daysAgo: 12,
      outcome: 'deny',
      grounds: ['not-objectives'],
      reasons:
        'The request names no offence under investigation, and the officer sought could not be identified on the roster from the name and entity given. You may file a new request with the full name and personnel file number.',
    },
  },
  {
    id: MOCK_LEA_IDS.tsc,
    commission: 'tsc',
    sequence: 4,
    agency: 'DCI',
    officer: DEMO_OFFICER,
    sought: { name: 'Daniel Kiprono Rotich', entity: 'TSC County Office, Uasin Gishu' },
    reason: 'Investigation into ghost teachers on the county payroll.',
    caseReference: 'DCI/ECU/139/2026',
    scope: { ...SCOPE_ASSETS, years: [2026], includeSpouses: false, sections: ['income'] },
    receivedDaysAgo: 3,
  },
  ...fillers(),
];

/** Older decided PSC requests from other officers, so the tab has a second page. */
function fillers(): Seed[] {
  const sought = MOCK_ROSTER.filter((each) => each.onboarded);
  return Array.from({ length: 16 }, (_, index): Seed => {
    const record = sought[index % sought.length] ?? MOCK_ROSTER[0];
    const agency: AgencyCode = index % 3 === 0 ? 'ODPP' : index % 3 === 1 ? 'ARA' : 'DCI';
    return {
      id: `a11e0000-0000-4000-8000-1${String(index).padStart(11, '0')}`,
      commission: 'psc',
      sequence: 100 + index,
      agency,
      officer: OTHER_OFFICER,
      sought: { name: record?.fullName ?? 'Officer', entity: record?.reportingEntity ?? '' },
      reason: 'Investigation into unexplained wealth.',
      caseReference: `${agency}/2026/${String(300 + index)}`,
      scope: SCOPE_ASSETS,
      receivedDaysAgo: 60 + index * 3,
      verified: { daysAgo: 58 + index * 3, record: record?.id ?? '', note: 'Checked.' },
      decision: {
        daysAgo: 52 + index * 3,
        outcome: index % 4 === 0 ? 'deny' : 'grant',
        grounds: index % 4 === 0 ? ['prejudice-proceeding'] : undefined,
        reasons: 'Decided on the written request.',
        downloads: 1,
      },
    };
  });
}

function iso(now: number, days: number): string {
  return addDays(new Date(now).toISOString(), days);
}

/** 09:10 in Nairobi on the seeding day, or the day before when that is still ahead. */
function morningOf(now: number): number {
  const today = Date.parse(
    `${new Date(now + 3 * 60 * 60 * 1000).toISOString().slice(0, 10)}T06:10:00Z`,
  );
  return today <= now ? today : today - 24 * 60 * 60 * 1000;
}

function hoursLater(at: string, hours: number): string {
  return new Date(Date.parse(at) + hours * 60 * 60 * 1000).toISOString();
}

function entry(
  kind: RegisterEntry['kind'],
  at: string,
  actor: string | null,
  reference: string,
): RegisterEntry {
  return { id: randomUUID(), kind, at, actor, summary: kind, reference };
}

/** An LEA reference with its ISO 7064 check character, as the numbering package makes it. */
function referenceOf(commission: string, sequence: number): string {
  const base = `LEA-${commission.toUpperCase()}-2026-${String(sequence).padStart(7, '0')}`;
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let state = 18;
  for (const character of base.replaceAll('-', '')) {
    state = ((((state || 36) * 2) % 37) + alphabet.indexOf(character)) % 36;
  }
  return `${base}-${alphabet.charAt((37 - (((state || 36) * 2) % 37)) % 36)}`;
}

function commissionOf(slug: string): { slug: string; name: string } {
  const found = MOCK_COMMISSIONS.find((each) => each.slug === slug);
  return { slug, name: found?.name ?? slug.toUpperCase() };
}

function provenance(checkedAt: string): LeaRequest['provenance'] {
  return {
    accountState: 'activated',
    activatedAt: '2026-07-14T07:30:00.000Z',
    agencyLegalBasis: '',
    checkedAt,
  };
}

function build(seed: Seed, now: number): Stored {
  const receivedAt = iso(morningOf(now), -seed.receivedDaysAgo);
  const deadlineAt = iso(Date.parse(receivedAt), LEA_DAYS);
  const reference = referenceOf(seed.commission, seed.sequence);
  const agency = AGENCIES[seed.agency];
  const record = seed.verified
    ? MOCK_ROSTER.find((each) => each.id === seed.verified?.record)
    : undefined;
  const timeline: RegisterEntry[] = [entry('received', receivedAt, seed.officer.name, reference)];
  let status: LeaRequestStatus = 'received';
  let verification: LeaRequest['verification'] = null;
  if (seed.verified && record) {
    const at = hoursLater(iso(morningOf(now), -seed.verified.daysAgo), 2);
    status = 'verified';
    verification = {
      by: { subject: 'mock-officer', name: ACCESS_OFFICER_NAME },
      at,
      note: seed.verified.note,
      provenance: { ...provenance(at), agencyLegalBasis: agency.legalBasis },
    };
    timeline.push(entry('verified', at, ACCESS_OFFICER_NAME, reference));
  }
  let decision: Decision | null = null;
  let declarantNotifiedAt: string | null = null;
  let pkg: LeaRequest['package'] = null;
  if (seed.decision) {
    const decidedAt = hoursLater(iso(morningOf(now), -seed.decision.daysAgo), 3);
    status = seed.decision.outcome === 'deny' ? 'denied' : 'granted';
    decision = {
      outcome: seed.decision.outcome,
      grantedScope: seed.decision.outcome === 'grant' ? seed.scope : null,
      grounds: seed.decision.grounds ?? [],
      reasons: seed.decision.reasons,
      decidedBy: { subject: 'mock-officer', name: ACCESS_OFFICER_NAME },
      decidedAt,
    };
    timeline.push(entry('decided', decidedAt, ACCESS_OFFICER_NAME, reference));
    if (seed.decision.outcome === 'grant') {
      declarantNotifiedAt = hoursLater(decidedAt, 0.05);
      timeline.push(entry('notified', declarantNotifiedAt, null, reference));
      const issuedAt = hoursLater(decidedAt, 0.1);
      const downloadExpiresAt = iso(Date.parse(issuedAt), DOWNLOAD_DAYS);
      timeline.push(entry('package-issued', issuedAt, null, reference));
      const downloads = seed.decision.downloads ?? 0;
      for (let index = 0; index < downloads; index += 1) {
        timeline.push(
          entry('downloaded', hoursLater(issuedAt, 20 + index * 26), seed.officer.name, reference),
        );
      }
      if (Date.parse(downloadExpiresAt) < now) {
        timeline.push(entry('expired', downloadExpiresAt, null, reference));
      }
      pkg = {
        documentId: `a11f${seed.id.slice(4)}`,
        verificationId: 'ADL-M3PK-7WQD-2XNC-9RTB-5HJV-6L',
        issuedAt,
        downloadExpiresAt,
        downloads,
      };
    }
  }
  const request: LeaRequest = {
    id: seed.id,
    reference,
    commission: commissionOf(seed.commission),
    agency: { code: agency.code, name: agency.name },
    officer: seed.officer,
    provenance: { ...provenance(receivedAt), agencyLegalBasis: agency.legalBasis },
    officerSought: seed.sought,
    reason: seed.reason,
    caseReference: seed.caseReference,
    scope: seed.scope,
    status,
    receivedAt,
    deadlineAt,
    breachedAt: decision === null && Date.parse(deadlineAt) < now ? deadlineAt : null,
    resolvedRosterRecordId: record?.id ?? null,
    resolvedName: record?.fullName ?? null,
    verification,
    decision,
    declarantNotifiedAt,
    package: pkg,
    timeline,
  };
  return { request, packageAt: null };
}

export function resetLeaMock(now: number = Date.now()) {
  requests.clear();
  for (const seed of SEEDS) requests.set(seed.id, build(seed, now));
}

function ensureSeeded() {
  if (requests.size === 0) resetLeaMock();
}

/** Runs the mock workflow: a grant's package is issued once its time has come. */
function advance(stored: Stored, now: number) {
  if (stored.packageAt === null || now < stored.packageAt) return;
  const issuedAt = new Date(stored.packageAt).toISOString();
  stored.packageAt = null;
  const { request } = stored;
  stored.request = {
    ...request,
    package: {
      documentId: randomUUID(),
      verificationId: 'ADL-Q8RT-2MXW-7KPD-4HNC-9VBJ-3L',
      issuedAt,
      downloadExpiresAt: iso(Date.parse(issuedAt), DOWNLOAD_DAYS),
      downloads: 0,
    },
    timeline: [...request.timeline, entry('package-issued', issuedAt, null, request.reference)],
  };
}

const OPEN: readonly LeaRequestStatus[] = ['received', 'verified'];

/** The PSC's law enforcement requests as rows of its queue. */
export function leaQueueItems(now: number): QueueItem[] {
  ensureSeeded();
  return [...requests.values()]
    .filter((stored) => stored.request.commission.slug === 'psc')
    .map(({ request }): QueueItem => ({
      kind: 'lea',
      id: request.id,
      reference: request.reference,
      applicantOrAgency: request.agency.name,
      officerSought: request.officerSought.name,
      resolvedName: request.resolvedName,
      resolvedFileNumber:
        MOCK_ROSTER.find((each) => each.id === request.resolvedRosterRecordId)
          ?.personnelFileNumber ?? null,
      status: request.status,
      submittedAt: request.receivedAt,
      deadlineAt: request.deadlineAt,
      windowEndsAt: null,
      late: OPEN.includes(request.status) && now > Date.parse(request.deadlineAt),
      closedAt: request.decision?.decidedAt ?? null,
    }));
}

const isLeaOfficer = (caller: MockCaller) => caller.roles.includes('law-enforcement');

/** Whether the request is the signed-in law enforcement officer's (the demo officer's). */
const isMine = (request: LeaRequest) => request.officer.subject === DEMO_OFFICER.subject;

/** The officer's view: their own name on the timeline, nobody else's. */
function asOfficerView(request: LeaRequest): LeaRequest {
  return {
    ...request,
    verification: request.verification
      ? { ...request.verification, by: { subject: '', name: '' }, note: '' }
      : null,
    timeline: request.timeline.map((each) =>
      each.kind === 'received' || each.kind === 'downloaded' ? each : { ...each, actor: null },
    ),
  };
}

function viewFor(caller: MockCaller, request: LeaRequest): LeaRequest {
  return isLeaOfficer(caller) ? asOfficerView(request) : request;
}

function conflict(title: string, code?: string) {
  return problem(409, title, code);
}

function badRequest(title: string, errors: { path: string; message: string }[], code?: string) {
  return json(400, { type: 'about:blank', title, status: 400, errors, ...(code ? { code } : {}) });
}

let latency = 1;

/** How much slower than nothing the mock answers commands; tests set 0. */
export function setLeaMockLatency(factor: number) {
  latency = factor;
}

const delay = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms * latency);
  });

async function verify(request: Request, stored: Stored, caller: MockCaller): Promise<Response> {
  const body = await readJson(request);
  const record = isRecord(body) ? body.rosterRecordId : undefined;
  const note = isRecord(body) && typeof body.note === 'string' ? body.note.trim() : '';
  if (!note) return badRequest('Bad Request', [{ path: 'note', message: 'is required' }]);
  const { request: lea } = stored;
  if (lea.status === 'granted' || lea.status === 'denied') {
    return conflict('The request is decided', 'request-decided');
  }
  if (lea.status !== 'received')
    return conflict('The request is verified already', 'officer-resolved');
  const found = MOCK_ROSTER.find((each) => each.id === record);
  if (!found?.onboarded) {
    return badRequest('Bad Request', [
      { path: 'rosterRecordId', message: 'is not an onboarded roster record' },
    ]);
  }
  const now = new Date().toISOString();
  stored.request = {
    ...lea,
    status: 'verified',
    resolvedRosterRecordId: found.id,
    resolvedName: found.fullName,
    verification: {
      by: { subject: caller.subject, name: caller.name },
      at: now,
      note,
      provenance: { ...lea.provenance, checkedAt: now },
    },
    timeline: [...lea.timeline, entry('verified', now, caller.name, lea.reference)],
  };
  return json(200, stored.request);
}

async function decide(request: Request, stored: Stored, caller: MockCaller): Promise<Response> {
  const body = await readJson(request);
  const { request: lea } = stored;
  if (lea.decision) return conflict('The request is decided', 'request-decided');
  if (!isRecord(body)) return badRequest('Bad Request', [{ path: '', message: 'is required' }]);
  const outcome = body.outcome;
  const grounds = Array.isArray(body.grounds) ? (body.grounds as Ground[]) : [];
  const reasons = typeof body.reasons === 'string' ? body.reasons.trim() : '';
  if (outcome !== 'grant' && outcome !== 'deny') {
    return badRequest('Bad Request', [{ path: 'outcome', message: 'is not an outcome' }]);
  }
  if (outcome === 'grant' && lea.status !== 'verified') {
    return conflict('The request is not verified yet', 'not-under-decision');
  }
  if (outcome === 'deny' && grounds.length === 0) {
    return badRequest(
      'A denial cites grounds',
      [{ path: 'grounds', message: 'is required' }],
      'grounds-required',
    );
  }
  if (!reasons) return badRequest('Bad Request', [{ path: 'reasons', message: 'is required' }]);
  const now = new Date().toISOString();
  const timeline = [...lea.timeline, entry('decided', now, caller.name, lea.reference)];
  if (outcome === 'grant') timeline.push(entry('notified', now, null, lea.reference));
  stored.request = {
    ...lea,
    status: outcome === 'grant' ? 'granted' : 'denied',
    decision: {
      outcome,
      grantedScope: outcome === 'grant' ? lea.scope : null,
      grounds: outcome === 'grant' ? [] : grounds,
      reasons,
      decidedBy: { subject: caller.subject, name: caller.name },
      decidedAt: now,
    },
    declarantNotifiedAt: outcome === 'grant' ? now : null,
    breachedAt: lea.breachedAt,
    timeline,
  };
  if (outcome === 'grant') stored.packageAt = Date.now() + PACKAGE_AFTER_MS;
  return json(200, stored.request);
}

async function submit(request: Request, caller: MockCaller): Promise<Response> {
  const body = await readJson(request);
  if (!isRecord(body) || !isRecord(body.officerSought) || !isRecord(body.scope)) {
    return badRequest('Bad Request', [{ path: '', message: 'is not a written request' }]);
  }
  const commission = MOCK_COMMISSIONS.find((each) => each.slug === body.commission);
  if (!commission) {
    return badRequest('No such Responsible Commission', [
      { path: 'commission', message: 'is not a Responsible Commission' },
    ]);
  }
  const caseReference = typeof body.caseReference === 'string' ? body.caseReference : '';
  if (/offline/i.test(caseReference)) return problem(503, 'Service unavailable');
  if (/duplicate/i.test(caseReference)) {
    return json(400, {
      type: 'about:blank',
      title: 'Request not accepted',
      status: 400,
      detail: `A request for this case is already open with ${commission.slug.toUpperCase()}: ${referenceOf(commission.slug, 12)}.`,
      errors: [{ path: 'caseReference', message: 'One open request per case' }],
    });
  }
  await delay(600);
  const now = Date.now();
  const sequence =
    13 +
    [...requests.values()].filter((each) => each.request.commission.slug === commission.slug)
      .length;
  const seed: Seed = {
    id: randomUUID(),
    commission: commission.slug,
    sequence,
    agency: 'DCI',
    officer: { subject: DEMO_OFFICER.subject, name: caller.name },
    sought: body.officerSought as LeaRequest['officerSought'],
    reason: typeof body.reason === 'string' ? body.reason : '',
    caseReference,
    scope: body.scope as Scope,
    receivedDaysAgo: 0,
  };
  const stored = build(seed, now);
  const receivedAt = new Date(now).toISOString();
  stored.request = {
    ...stored.request,
    receivedAt,
    deadlineAt: iso(now, LEA_DAYS),
    timeline: [entry('received', receivedAt, caller.name, stored.request.reference)],
  };
  requests.set(seed.id, stored);
  return json(201, asOfficerView(stored.request));
}

/**
 * Answers the law enforcement endpoints and the Commissions list, or null for any other path
 * (the Form K mock answers those).
 */
export async function mockLeaFetch(request: Request): Promise<Response | null> {
  ensureSeeded();
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;
  const caller = mockCallerOf(request);
  const now = Date.now();

  if (method === 'GET' && pathname === '/v1/access/commissions') {
    if (!isLeaOfficer(caller) && !caller.roles.includes('applicant')) {
      return problem(403, 'Neither an applicant nor a law enforcement officer');
    }
    return json(200, MOCK_COMMISSIONS);
  }
  if (pathname === '/v1/lea/requests') {
    if (!isLeaOfficer(caller)) return problem(403, 'Not a law enforcement officer account');
    if (method === 'POST') return submit(request, caller);
    if (method !== 'GET') return problem(404, 'Not found');
    await delay(300);
    const mine = [...requests.values()]
      .map((stored) => {
        advance(stored, now);
        return stored.request;
      })
      .filter(isMine)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .map(asOfficerView);
    return json(200, mine);
  }

  const match = /^\/v1\/lea\/requests\/([^/]+)(?:\/(.+))?$/.exec(pathname);
  if (!match) return null;
  const stored = match[1] ? requests.get(match[1]) : undefined;
  const visible =
    stored &&
    (isLeaOfficer(caller) ? isMine(stored.request) : stored.request.commission.slug === 'psc');
  if (!stored || !visible) return problem(404, 'Not found');
  advance(stored, now);
  const action = match[2];

  if (method === 'GET' && action === undefined) return json(200, viewFor(caller, stored.request));
  if (isLeaOfficer(caller)) return problem(403, 'Only the access officer acts');
  if (!caller.roles.includes('access-officer')) {
    return problem(403, 'The Commission supervisor reads requests; only its access officer acts');
  }
  if (method === 'GET' && action === 'roster-candidates') {
    const q = url.searchParams.get('q')?.trim().toLowerCase() ?? '';
    if (q.length < 2) return problem(400, 'A search of at least 2 characters is required');
    if (q === 'offline') return problem(503, 'The directory cannot be reached');
    await delay(250);
    return json(200, { items: searchMockRoster(q) });
  }
  if (method === 'POST' && action === 'verify') {
    await delay(500);
    return verify(request, stored, caller);
  }
  if (method === 'POST' && action === 'decision') {
    await delay(700);
    return decide(request, stored, caller);
  }
  return problem(404, 'Not found');
}

/**
 * The documents service's package download, for the officer a package was issued to: a link to
 * the placeholder file route, or 410 once its window has closed.
 */
export async function mockPackageFetch(request: Request): Promise<Response> {
  ensureSeeded();
  const match = /^\/v1\/documents\/([^/]+)\/download$/.exec(new URL(request.url).pathname);
  const stored = [...requests.values()].find(
    (each) => each.request.package?.documentId === match?.[1],
  );
  const pkg = stored?.request.package;
  if (request.method !== 'GET' || !stored || !pkg || !isMine(stored.request)) {
    return problem(404, 'Not found');
  }
  if (Date.parse(pkg.downloadExpiresAt) < Date.now()) {
    return json(410, {
      type: 'download-window-closed',
      title: 'The download window has ended',
      status: 410,
    });
  }
  await delay(300);
  const at = new Date().toISOString();
  stored.request = {
    ...stored.request,
    package: { ...pkg, downloads: pkg.downloads + 1 },
    timeline: [
      ...stored.request.timeline,
      entry('downloaded', at, stored.request.officer.name, stored.request.reference),
    ],
  };
  return json(200, {
    downloadUrl: `/api/mock-files/${pkg.documentId}`,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    sha256: '0'.repeat(64),
  });
}

/** What the placeholder file route names: a law enforcement package. */
export function mockLeaFileTitle(id: string): string | null {
  ensureSeeded();
  const stored = [...requests.values()].find((each) => each.request.package?.documentId === id);
  return stored ? `Access package ${stored.request.reference}` : null;
}
