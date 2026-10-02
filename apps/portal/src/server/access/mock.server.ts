/**
 * In-memory stand-in for the access service's applicant endpoints (access.yaml), used when
 * ACCESS_MOCK is set, to work on the portal without the service (the declarant's
 * `/v1/me/access-notices` go to `mock-notices.server.ts`, their history and certified copies to
 * `mock-history.server.ts`). Every signed-in caller
 * shares one store, seeded relative to when it was first used with one request in each status:
 *
 * - submitted today, awaiting identity verification (a passport), officer being identified,
 *   declarant notified, under decision (due in 3 days), under decision and late, granted
 *   (package for 13 more days), partially granted (2 more days), denied, cannot identify
 *   officer, withdrawn;
 * - granted with the package's window ending in about five hours, granted with the window
 *   closed (downloaded twice), granted today with the package still being prepared, granted
 *   two days ago with the package failing to issue, and two grants whose scope held no
 *   declaration, answered with the nil letter (one ready, one past its window).
 *
 * Commissions: the Public Service Commission (2025, 2026), the Teachers Service Commission,
 * the National Police Service Commission, the Judicial Service Commission (2026) and the Kiambu
 * County Public Service Board, which has no declarations yet.
 *
 * Submitting validates the body against `form-k.v1` (400 with `errors`), needs an
 * `Idempotency-Key` (a replay returns the first answer) and allocates the next ARQ reference.
 * A passport applicant's request waits as `pending-applicant-verification`. To see the
 * failures in the browser, name the officer sought:
 * - `Unavailable Officer`: 503, as when the directory or the key service is down;
 * - `Rejected Officer`: 400 on `partII.name`, as when the service refuses a field.
 *
 * Withdrawing works before a decision; after one it is 409 `request-decided`, and on a
 * withdrawn or closed request 409 `request-closed`. The late request under decision is decided
 * (denied) the moment someone tries to withdraw it, to show the race.
 *
 * It also answers the documents service's `GET /v1/documents/{id}/download` for the packages
 * (the portal downloads them from documents, as their subject): a link to
 * `/api/mock-packages/{id}` (served in mock mode by `routes/api/mock-packages.$documentId.ts`),
 * registered as a download; 410 once the window has closed. The window ending in five hours
 * closes at the first download attempt (410, the window closing while the page is open), and
 * the partial grant's first link fails (503, documents down; trying again works).
 *
 * Callers without the `applicant` realm role get 403, as from the service (the mock reads the
 * bearer token's claims without checking its signature).
 *
 * Commands (submit, withdraw) take about as long as the service would, so the busy states show;
 * tests turn that off (`setAccessMockLatency(0)`). Tests can also reseed at a given time
 * (`resetAccessMock`) and make the next call fail as if the service were down
 * (`failNextAccessCall`).
 */
import { validateFormK, type FormKV1 } from '@adili/forms';
import { addDays, DECIDED_ACCESS_STATUSES } from '@adili/ui';
import { ARQ, format } from '@adili/numbering/references';

import { json, problem, readJson } from '../mock-http';
import { placeholderPdf } from '../mock-pdf';
import {
  isHistoryPath,
  mockCopyDownload,
  mockCopyFile,
  mockHistoryFetch,
} from './mock-history.server';
import { mockNoticesFetch } from './mock-notices.server';
import type { AccessCommission, AccessRequest, RegisterEntry } from './types';

interface MockCommission extends AccessCommission {
  issuerCode: string;
}

export const MOCK_ACCESS_COMMISSIONS: MockCommission[] = [
  {
    slug: 'psc',
    issuerCode: 'PSC',
    name: 'Public Service Commission',
    years: [2025, 2026],
    decisionDays: 30,
  },
  {
    slug: 'tsc',
    issuerCode: 'TSC',
    name: 'Teachers Service Commission',
    years: [2025, 2026],
    decisionDays: 30,
  },
  // A policy with a shorter decision period than the default.
  {
    slug: 'jsc',
    issuerCode: 'JSC',
    name: 'Judicial Service Commission',
    years: [2026],
    decisionDays: 21,
  },
  {
    slug: 'npsc',
    issuerCode: 'NPSC',
    name: 'National Police Service Commission',
    years: [2025, 2026],
    decisionDays: 30,
  },
  {
    slug: 'cpsb022',
    issuerCode: 'CPSB022',
    name: 'Kiambu County Public Service Board',
    years: [],
    decisionDays: 30,
  },
];

/** The default decision period of a Commission's policy (access.decisionDays). */
const DECISION_DAYS = 30;
/** The default download window of a Commission's policy (access.packageDownloadDays). */
const PACKAGE_DAYS = 14;
const DAY = 86_400_000;

const requests = new Map<string, AccessRequest>();
const sequences = new Map<string, number>();
/** First answer by Idempotency-Key, replayed on retry. */
const answered = new Map<string, { status: number; body: unknown }>();
/** Requests decided the moment someone tries to withdraw them. */
const decideOnWithdraw = new Set<string>();
/** Packages whose window closes the moment someone first tries to download them. */
const closeOnDownload = new Set<string>();
/** Packages whose first download link fails, as if the documents service were down. */
const failFirstDownload = new Set<string>();
let failNext = false;
let seeded = false;
let latencyMs = 600;

/** How long submit and withdraw take; 0 for tests. */
export function setAccessMockLatency(ms: number) {
  latencyMs = ms;
}

const settle = () =>
  latencyMs > 0 ? new Promise((resolve) => setTimeout(resolve, latencyMs)) : Promise.resolve();

function commissionOf(slug: string) {
  return MOCK_ACCESS_COMMISSIONS.find((commission) => commission.slug === slug);
}

function nextReference(commission: MockCommission, at: Date): string {
  const key = `${commission.slug}:${String(at.getUTCFullYear())}`;
  const sequence = (sequences.get(key) ?? 150) + 1;
  sequences.set(key, sequence);
  return format(ARQ, {
    issuer: commission.issuerCode,
    period: at.getUTCFullYear(),
    sequence,
  });
}

let entryCount = 0;
function entry(
  kind: RegisterEntry['kind'],
  at: string,
  reference: string,
  summary: string,
  actor: string | null = null,
): RegisterEntry {
  entryCount += 1;
  return {
    id: `e0000000-0000-4000-8000-${String(entryCount).padStart(12, '0')}`,
    kind,
    at,
    actor,
    summary,
    reference,
    inWriting: false,
  };
}

const APPLICANT = {
  name: 'Mercy Wanjiku Kamau',
  identityDocument: { kind: 'national-id', number: '28841276' },
  postalAddress: 'P.O. Box 49010-00100, Nairobi',
  physicalAddress: 'Othaya Road, Kileleshwa, Nairobi',
  telephone: '+254722418903',
  email: 'mercy.kamau@example.com',
  occupation: 'Journalist',
} satisfies FormKV1['partI'];

type SeedKey =
  | 'submitted'
  | 'pending'
  | 'unresolved'
  | 'notified'
  | 'deciding'
  | 'late'
  | 'granted'
  | 'partial'
  | 'denied'
  | 'cannot'
  | 'withdrawn'
  | 'expiring'
  | 'expired'
  | 'preparing'
  | 'nil'
  | 'nilExpired'
  | 'failed';

interface Seed {
  key: SeedKey;
  commission: string;
  status: AccessRequest['status'];
  submittedDaysAgo: number;
  officer: FormKV1['partII'];
  informationSought: string;
  reason: string;
  otherInformation?: string;
  scope: FormKV1['scope'];
  passport?: boolean;
  /** Days ago each later step happened, for the timeline. */
  verified?: number;
  notified?: number;
  decided?: number;
  closed?: number;
  decision?: Pick<AccessRequest['decision'] & object, 'outcome' | 'grounds' | 'reasons'> & {
    grantedScope?: FormKV1['scope'];
  };
  /** A grant's package: absent, issued at the decision for 14 days. */
  package?: {
    /** Still being prepared: the request has no package yet. */
    preparing?: boolean;
    /** Issuing it failed after its retries: no package, `packageFailedAt` at the decision. */
    failed?: boolean;
    /** The granted scope held no declaration: the nil letter is issued instead. */
    nil?: boolean;
    /** Milliseconds from now to the end of the window, instead of 14 days from the decision. */
    expiresIn?: number;
    /** Days ago it was downloaded, oldest first. */
    downloaded?: number[];
  };
}

const ALL_SECTIONS: FormKV1['scope']['sections'] = [
  'bio',
  'income',
  'assets',
  'liabilities',
  'other',
];

const scope = (
  years: number[],
  sections: FormKV1['scope']['sections'],
  people: { spouses?: boolean; children?: boolean; clarifications?: boolean } = {},
): FormKV1['scope'] => ({
  years,
  includeSpouses: people.spouses ?? false,
  includeChildren: people.children ?? false,
  sections,
  includeClarifications: people.clarifications ?? false,
});

const SEEDS: Seed[] = [
  {
    key: 'submitted',
    commission: 'psc',
    status: 'submitted',
    submittedDaysAgo: 0,
    officer: {
      name: 'Josephine Akinyi Ouma',
      entity: 'State Department for Public Works',
      workStation: 'Ministry of Roads and Transport, Nairobi',
    },
    informationSought: 'Income and assets declared in the 2026 initial declaration.',
    reason:
      'The officer approved variations worth KES 1.2 billion on the Northern Bypass contract. I want to see whether any income or assets link to the contractor, in furtherance of the objectives of the Act.',
    scope: scope([2026], ['income', 'assets']),
  },
  {
    key: 'pending',
    commission: 'psc',
    status: 'pending-applicant-verification',
    submittedDaysAgo: 2,
    passport: true,
    officer: {
      name: 'Peter Mwangi Kamau',
      entity: 'State Department for Housing and Urban Development',
      workStation: 'Ardhi House, Nairobi',
    },
    informationSought: 'Assets declared in the 2026 initial declaration.',
    reason:
      'Our research on affordable housing tenders found companies linked to officers of the department. The declaration shows whether the officer declared those interests.',
    scope: scope([2026], ['assets']),
  },
  {
    key: 'unresolved',
    commission: 'tsc',
    status: 'officer-unresolved',
    submittedDaysAgo: 5,
    officer: { name: 'Samuel Kiprono', entity: 'TSC County Office, Uasin Gishu', workStation: '' },
    informationSought: 'Assets declared in the 2025 biennial declaration.',
    reason:
      'Parents report that school levies were diverted. I am writing about whether the officer’s assets match their pay.',
    scope: scope([2025], ['assets']),
  },
  {
    key: 'notified',
    commission: 'psc',
    status: 'awaiting-representations',
    submittedDaysAgo: 4,
    notified: 2,
    officer: {
      name: 'Peter Mwangi Kamau',
      entity: 'State Department for Housing and Urban Development',
      workStation: 'Ardhi House, Nairobi',
    },
    informationSought:
      'Assets and liabilities declared in the biennial declarations, including land and vehicles.',
    reason:
      'I am reporting on procurement of affordable housing contracts. Public records show a company linked to the officer won three tenders in 2025. The declarations will show whether the officer declared an interest in that company, which is in furtherance of the Act.',
    otherInformation: 'My press card number is KMC-2024-11873 (Media Council of Kenya).',
    scope: scope([2025, 2026], ['assets', 'liabilities', 'other'], {
      spouses: true,
      clarifications: true,
    }),
  },
  {
    key: 'deciding',
    commission: 'psc',
    status: 'under-decision',
    submittedDaysAgo: 27,
    notified: 25,
    officer: {
      name: 'Grace Atieno Odhiambo',
      entity: 'Kenya Rural Roads Authority',
      workStation: 'Head office, Barabara Plaza, Nairobi',
      personnelFileNumber: 'KRR/2011/0442',
    },
    informationSought: 'Income from other sources and liabilities, 2025 and 2026.',
    reason:
      'A contractor paid consultancy fees to a firm registered to a relative of the officer. The declarations show whether that income was declared.',
    scope: scope([2025, 2026], ['income', 'liabilities'], { spouses: true, children: true }),
  },
  {
    key: 'late',
    commission: 'psc',
    status: 'under-decision',
    submittedDaysAgo: 37,
    notified: 35,
    officer: {
      name: 'Lilian Wairimu Njoroge',
      entity: 'Kenya Ports Authority',
      workStation: 'Kilindini, Mombasa',
    },
    informationSought: 'Income and assets in the 2025 and 2026 declarations.',
    reason:
      'Cargo clearing fees rose sharply while the officer headed the unit. The declarations show whether the officer’s income changed with them.',
    scope: scope([2025, 2026], ['income', 'assets']),
  },
  {
    key: 'granted',
    commission: 'psc',
    status: 'granted',
    submittedDaysAgo: 29,
    notified: 27,
    decided: 1,
    officer: {
      name: 'Daniel Otieno Were',
      entity: 'State Department for Lands',
      workStation: 'Ardhi House, Nairobi',
    },
    informationSought: 'Assets declared in the 2026 initial declaration.',
    reason:
      'Land in Karen was allocated to a company the officer is said to own. The declaration shows whether the officer declared the land.',
    scope: scope([2026], ['assets']),
    decision: {
      outcome: 'grant',
      grounds: [],
      reasons:
        'The applicant shows a legitimate interest in the allocation of public land, and access to the assets declared promotes the objectives of the Act.',
    },
  },
  {
    key: 'partial',
    commission: 'psc',
    status: 'partially-granted',
    submittedDaysAgo: 41,
    notified: 39,
    decided: 12,
    officer: {
      name: 'Anne Njeri Mutua',
      entity: 'Kenya Revenue Authority',
      workStation: 'Times Tower, Nairobi',
    },
    informationSought:
      'Assets, liabilities and income in the 2025 and 2026 declarations, with spouse and children.',
    reason:
      'Tax waivers were granted to firms linked to the officer’s family. The declarations show whether the family’s interests were declared.',
    scope: scope([2025, 2026], ['income', 'assets', 'liabilities'], {
      spouses: true,
      children: true,
      clarifications: true,
    }),
    decision: {
      outcome: 'partial-grant',
      grounds: ['public-interest'],
      reasons:
        'The officer’s own assets and liabilities bear on the waivers. The children’s declarations and income do not, and disclosing them would be against the public interest.',
      grantedScope: scope([2025, 2026], ['assets', 'liabilities'], { spouses: true }),
    },
  },
  {
    key: 'denied',
    commission: 'psc',
    status: 'denied',
    submittedDaysAgo: 40,
    notified: 38,
    decided: 8,
    officer: {
      name: 'Beatrice Chebet Rotich',
      entity: 'State Department for Interior',
      workStation: 'Harambee House, Nairobi',
    },
    informationSought: 'All sections of the 2026 initial declaration, with spouse and children.',
    reason: 'I want to know how much the officer is worth.',
    scope: scope([2026], ALL_SECTIONS, { spouses: true, children: true }),
    decision: {
      outcome: 'deny',
      grounds: ['frivolous-vexatious', 'not-objectives'],
      reasons:
        'The request gives no reason connected to the officer’s public duties, and curiosity about an officer’s wealth does not promote the objectives of the Act.',
    },
  },
  {
    key: 'cannot',
    commission: 'npsc',
    status: 'cannot-identify',
    submittedDaysAgo: 20,
    closed: 3,
    officer: {
      name: 'James Otieno',
      entity: 'National Police Service',
      workStation: 'Kilimani Police Station',
    },
    informationSought: 'Assets in the 2025 biennial declaration.',
    reason:
      'Residents report extortion at roadblocks in Kilimani. I am investigating officers whose assets may not match their pay.',
    scope: scope([2025], ['assets']),
  },
  {
    key: 'withdrawn',
    commission: 'psc',
    status: 'withdrawn',
    submittedDaysAgo: 24,
    closed: 16,
    officer: {
      name: 'Paul Kariuki Ngugi',
      entity: 'State Department for Water',
      workStation: 'Maji House, Nairobi',
    },
    informationSought: 'Assets in the 2026 declaration.',
    reason:
      'Borehole contracts were awarded without tender. The declaration shows whether the officer declared any interest in the contractors.',
    scope: scope([2026], ['assets']),
  },
  {
    key: 'expiring',
    commission: 'tsc',
    status: 'granted',
    submittedDaysAgo: 44,
    notified: 42,
    decided: 14,
    officer: {
      name: 'Grace Akinyi Odhiambo',
      entity: 'Teachers Service Commission',
      workStation: 'TSC House, Nairobi',
    },
    informationSought: 'Income and assets in the 2025 declaration.',
    reason:
      'Teacher promotion fees were collected in cash at the county office. The declaration shows whether the officer’s income changed with them.',
    scope: scope([2025], ['income', 'assets']),
    decision: {
      outcome: 'grant',
      grounds: [],
      reasons:
        'The applicant shows good cause tied to the officer’s duties, and access to the income and assets declared promotes the objectives of the Act.',
    },
    package: { expiresIn: 5 * 3_600_000 + 12 * 60_000, downloaded: [13] },
  },
  {
    key: 'expired',
    commission: 'tsc',
    status: 'granted',
    submittedDaysAgo: 50,
    notified: 48,
    decided: 20,
    officer: {
      name: 'Samuel Kiprono Langat',
      entity: 'Teachers Service Commission',
      workStation: 'Uasin Gishu County Office, Eldoret',
    },
    informationSought: 'Assets in the 2025 declaration.',
    reason:
      'School land in Eldoret was sold to a developer the officer is said to be related to. The declaration shows whether the officer declared an interest.',
    scope: scope([2025], ['assets']),
    decision: {
      outcome: 'grant',
      grounds: [],
      reasons:
        'The sale of public school land is a matter of legitimate public concern, and access to the assets declared promotes the objectives of the Act.',
    },
    package: { downloaded: [19, 15] },
  },
  {
    key: 'preparing',
    commission: 'jsc',
    status: 'granted',
    submittedDaysAgo: 28,
    notified: 26,
    decided: 0,
    officer: {
      name: 'Esther Wambui Njoroge',
      entity: 'Judiciary',
      workStation: 'Milimani Law Courts, Nairobi',
    },
    informationSought: 'Liabilities in the 2026 declaration.',
    reason:
      'Court fees collected at the registry went missing while the officer headed it. The declaration shows whether the officer’s debts changed at the time.',
    scope: scope([2026], ['liabilities']),
    decision: {
      outcome: 'grant',
      grounds: [],
      reasons:
        'The applicant shows a legitimate interest in the handling of court fees, and access to the liabilities declared promotes the objectives of the Act.',
    },
    package: { preparing: true },
  },
  {
    // Granted days ago; the Commission holds no declaration in the granted scope: a nil letter.
    key: 'nil',
    commission: 'psc',
    status: 'granted',
    submittedDaysAgo: 24,
    notified: 22,
    decided: 3,
    officer: {
      name: 'Daniel Kiprotich Rotich',
      entity: 'Kenya Forest Service',
      workStation: 'Karura, Nairobi',
    },
    informationSought: 'Other information in the 2025 declaration.',
    reason:
      'Forest land was allocated to private developers while the officer led the station. The declaration shows whether the officer declared an interest in the developers.',
    scope: scope([2025], ['other']),
    decision: {
      outcome: 'grant',
      grounds: [],
      reasons:
        'The applicant shows a legitimate interest in the allocation of public forest land, which promotes the objectives of the Act.',
    },
    package: { nil: true },
  },
  {
    // A nil letter whose download window has closed, downloaded once.
    key: 'nilExpired',
    commission: 'tsc',
    status: 'granted',
    submittedDaysAgo: 48,
    notified: 46,
    decided: 20,
    officer: {
      name: 'Lucy Wairimu Gitau',
      entity: 'Teachers Service Commission',
      workStation: 'Nyeri County Office',
    },
    informationSought: 'Assets in the 2025 declaration.',
    reason:
      'School funds for laboratory equipment were misspent in the county. The declaration shows whether the officer acquired assets at the time.',
    scope: scope([2025], ['assets']),
    decision: {
      outcome: 'grant',
      grounds: [],
      reasons:
        'The applicant shows a legitimate interest in the use of school funds, which promotes the objectives of the Act.',
    },
    package: { nil: true, downloaded: [19] },
  },
  {
    // Granted; issuing the package failed after its retries.
    key: 'failed',
    commission: 'psc',
    status: 'granted',
    submittedDaysAgo: 30,
    notified: 28,
    decided: 2,
    officer: {
      name: 'Hassan Omar Abdi',
      entity: 'Kenya Ports Authority',
      workStation: 'Mombasa',
    },
    informationSought: 'Income in the 2025 declaration.',
    reason:
      'Port tenders were awarded to a firm linked to the officer. The declaration shows whether the officer declared income from it.',
    scope: scope([2025], ['income']),
    decision: {
      outcome: 'grant',
      grounds: [],
      reasons:
        'The applicant shows a legitimate interest in the award of port tenders, which promotes the objectives of the Act.',
    },
    package: { failed: true },
  },
];

export const MOCK_ACCESS_REQUEST_IDS = Object.fromEntries(
  SEEDS.map((seed, index) => [
    seed.key,
    `a2c70000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  ]),
) as Record<SeedKey, string>;

function seedRequest(seed: Seed, id: string, now: number): AccessRequest {
  const commission = commissionOf(seed.commission);
  if (!commission) throw new Error(`No mock Commission ${seed.commission}`);
  const ago = (days: number, hour = 9) => {
    const at = new Date(now - days * DAY);
    at.setUTCHours(hour - 3, 12, 0, 0);
    return at.toISOString();
  };
  const submittedAt =
    seed.submittedDaysAgo === 0 ? new Date(now).toISOString() : ago(seed.submittedDaysAgo);
  const reference = nextReference(commission, new Date(submittedAt));
  const partI: FormKV1['partI'] = seed.passport
    ? {
        ...APPLICANT,
        name: 'Kwame Mensah',
        identityDocument: { kind: 'passport', number: 'G2847193', country: 'GH' },
        telephone: '+233244718265',
        email: 'kwame.mensah@example.com',
        occupation: 'Researcher',
      }
    : APPLICANT;
  const timeline: RegisterEntry[] = [
    entry('received', submittedAt, reference, 'Request received', partI.name),
  ];
  if (seed.notified !== undefined) {
    timeline.push(entry('notified', ago(seed.notified, 11), reference, 'Officer notified'));
  }
  let decision: AccessRequest['decision'] = null;
  let pkg: AccessRequest['package'] = null;
  let packageFailedAt: string | null = null;
  if (seed.decided !== undefined && seed.decision) {
    // A window that ends a set time from now was opened by a decision 14 days before that; a
    // decision today was made a little while ago.
    const decidedAt =
      seed.package?.expiresIn !== undefined
        ? new Date(now + seed.package.expiresIn - PACKAGE_DAYS * DAY).toISOString()
        : seed.decided === 0
          ? new Date(now - 40 * 60_000).toISOString()
          : ago(seed.decided, 14);
    decision = {
      outcome: seed.decision.outcome,
      grantedScope:
        seed.decision.outcome === 'deny' ? null : (seed.decision.grantedScope ?? seed.scope),
      grounds: seed.decision.grounds,
      reasons: seed.decision.reasons,
      decidedBy: { subject: 'access-officer', name: 'Access officer' },
      decidedAt,
    };
    timeline.push(entry('decided', decidedAt, reference, 'Decision made'));
    if (seed.package?.failed) packageFailedAt = decidedAt;
    if (seed.decision.outcome !== 'deny' && !seed.package?.preparing && !seed.package?.failed) {
      const nil = seed.package?.nil === true;
      const issuedAt = decidedAt;
      const downloadExpiresAt = new Date(Date.parse(issuedAt) + PACKAGE_DAYS * DAY).toISOString();
      const downloaded = (seed.package?.downloaded ?? []).map((days) => ago(days, 19));
      pkg = {
        kind: nil ? 'nil-letter' : 'access-package',
        documentId: `d0c00000-0000-4000-8000-${id.slice(-12)}`,
        verificationId: 'ADL-9PLX-2MWE-C3KF-7VUA',
        issuedAt,
        downloadExpiresAt,
        downloads: downloaded.length,
      };
      const what = nil ? 'Nil letter' : 'Package';
      timeline.push(entry('package-issued', issuedAt, reference, `${what} issued`));
      for (const at of downloaded) {
        timeline.push(entry('downloaded', at, reference, `${what} downloaded`, partI.name));
      }
      if (Date.parse(downloadExpiresAt) <= now) {
        timeline.push(entry('expired', downloadExpiresAt, reference, 'Download window closed'));
      }
    }
  }
  if (seed.closed !== undefined) {
    const kind = seed.status === 'withdrawn' ? 'withdrawn' : 'cannot-identify';
    timeline.push(
      entry(
        kind,
        ago(seed.closed, 10),
        reference,
        kind === 'withdrawn' ? 'Withdrawn by the applicant' : 'Officer could not be identified',
        kind === 'withdrawn' ? partI.name : null,
      ),
    );
  }
  return {
    id,
    reference,
    commission: { slug: commission.slug, name: commission.name },
    status: seed.status,
    formK: {
      schemaVersion: 'form-k.v1',
      responsibleCommission: commission.slug,
      partI,
      partII: seed.officer,
      partIII: {
        informationSought: seed.informationSought,
        reason: seed.reason,
        otherInformation: seed.otherInformation ?? '',
      },
      partIV: {
        text: 'I declare that the information I have given above is true, complete and correct to the best of my knowledge.',
        declaredAt: submittedAt,
      },
      scope: seed.scope,
      meta: { reference, submittedAt },
    },
    submittedAt,
    decisionDeadlineAt: addDays(submittedAt, DECISION_DAYS),
    decision,
    package: pkg,
    packageFailedAt,
    timeline,
  };
}

/** Clears the store and seeds it again as of `now`; for tests. */
export function resetAccessMock(now = Date.now()) {
  requests.clear();
  sequences.clear();
  answered.clear();
  decideOnWithdraw.clear();
  failNext = false;
  entryCount = 0;
  // Oldest first, so references count up with the submission dates.
  [...SEEDS]
    .map((seed, index) => ({ seed, index }))
    .sort((a, b) => b.seed.submittedDaysAgo - a.seed.submittedDaysAgo)
    .forEach(({ seed, index }) => {
      const id = `a2c70000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
      requests.set(id, seedRequest(seed, id, now));
    });
  decideOnWithdraw.add(MOCK_ACCESS_REQUEST_IDS.late);
  closeOnDownload.clear();
  closeOnDownload.add(MOCK_ACCESS_REQUEST_IDS.expiring);
  failFirstDownload.clear();
  failFirstDownload.add(MOCK_ACCESS_REQUEST_IDS.partial);
  seeded = true;
}

/** Makes the next call answer 503, as if the service were down; for tests. */
export function failNextAccessCall() {
  failNext = true;
}

function newest(a: AccessRequest, b: AccessRequest) {
  return b.submittedAt.localeCompare(a.submittedAt);
}

async function submit(request: Request): Promise<Response> {
  const key = request.headers.get('idempotency-key');
  if (!key) return problem(400, 'Idempotency-Key is required');
  const replay = answered.get(key);
  if (replay) return json(replay.status, replay.body, { 'idempotent-replayed': 'true' });

  const body = await readJson(request);
  const validated = validateFormK(body);
  if (!validated.ok) {
    return json(400, {
      type: 'about:blank',
      title: 'The document is not a valid Form K.',
      status: 400,
      errors: validated.errors,
    });
  }
  const formK = validated.value;
  if (formK.partII.name === 'Unavailable Officer') {
    return problem(503, 'The key service cannot be reached');
  }
  if (formK.partII.name === 'Rejected Officer') {
    return json(400, {
      type: 'about:blank',
      title: 'The document is not a valid Form K.',
      status: 400,
      errors: [{ path: 'partII.name', message: 'is not acceptable' }],
    });
  }
  const commission = commissionOf(formK.responsibleCommission);
  if (!commission) {
    return json(400, {
      type: 'about:blank',
      title: 'No such Responsible Commission',
      status: 400,
      errors: [{ path: 'responsibleCommission', message: 'no such Commission' }],
    });
  }
  const now = new Date();
  const submittedAt = now.toISOString();
  const reference = nextReference(commission, now);
  const id = crypto.randomUUID();
  const created: AccessRequest = {
    id,
    reference,
    commission: { slug: commission.slug, name: commission.name },
    status:
      formK.partI.identityDocument.kind === 'passport'
        ? 'pending-applicant-verification'
        : 'submitted',
    formK: { ...formK, meta: { reference, submittedAt } },
    submittedAt,
    decisionDeadlineAt: addDays(submittedAt, commission.decisionDays),
    decision: null,
    package: null,
    packageFailedAt: null,
    timeline: [entry('received', submittedAt, reference, 'Request received', formK.partI.name)],
  };
  requests.set(id, created);
  answered.set(key, { status: 201, body: created });
  return json(201, created);
}

const CLOSED = new Set(['withdrawn', 'cannot-identify']);

function withdraw(id: string, key: string | null): Response {
  if (key) {
    const replay = answered.get(`withdraw:${key}`);
    if (replay) return json(replay.status, replay.body, { 'idempotent-replayed': 'true' });
  }
  const found = requests.get(id);
  if (!found) return problem(404, 'No such request of the applicant');
  if (decideOnWithdraw.has(id)) {
    decideOnWithdraw.delete(id);
    const decidedAt = new Date().toISOString();
    found.status = 'denied';
    found.decision = {
      outcome: 'deny',
      grantedScope: null,
      grounds: ['prejudice-proceeding'],
      reasons:
        'The officer is the subject of an ongoing investigation, which access to the declarations may prejudice.',
      decidedBy: { subject: 'access-officer', name: 'Access officer' },
      decidedAt,
    };
    found.timeline.push(entry('decided', decidedAt, found.reference, 'Decision made'));
  }
  if (DECIDED_ACCESS_STATUSES.has(found.status))
    return problem(409, 'A decision is final', 'request-decided');
  if (CLOSED.has(found.status)) return problem(409, 'The request is closed', 'request-closed');
  const at = new Date().toISOString();
  found.status = 'withdrawn';
  found.timeline.push(
    entry('withdrawn', at, found.reference, 'Withdrawn by the applicant', found.formK.partI.name),
  );
  if (key) answered.set(`withdraw:${key}`, { status: 200, body: found });
  return json(200, found);
}

/** The request whose package is this document, if any. */
function packageRequest(documentId: string): AccessRequest | undefined {
  return [...requests.values()].find((each) => each.package?.documentId === documentId);
}

/** The placeholder PDF the mock's package link serves, or null for no such package. */
export function mockPackageFile(documentId: string): { fileName: string; pdf: string } | null {
  const found = packageRequest(documentId);
  if (!found?.package) return mockCopyFile(documentId);
  return {
    fileName: `access-package-${found.reference}.pdf`,
    pdf: placeholderPdf([
      'CONFIDENTIAL (mock access package)',
      `Issued to ${found.formK.partI.name} · ${found.reference}`,
      `Officer: ${found.formK.partII.name}`,
      found.commission.name,
    ]),
  };
}

/**
 * The documents service's `GET /v1/documents/{id}/download` for an access package, as the
 * applicant (its subject person): a link valid for five minutes, registered as a download;
 * 410 `download-window-closed` once the window has ended; 404 for any other document.
 */
function packageDownload(documentId: string): Response {
  const found = packageRequest(documentId);
  const pkg = found?.package;
  if (!found || !pkg) return problem(404, 'Not found');
  const now = new Date();
  if (closeOnDownload.delete(found.id)) {
    pkg.downloadExpiresAt = now.toISOString();
    found.timeline.push(
      entry('expired', pkg.downloadExpiresAt, found.reference, 'Download window closed'),
    );
  }
  if (Date.parse(pkg.downloadExpiresAt) <= now.getTime()) {
    return problem(410, 'The download window has ended', 'download-window-closed');
  }
  if (failFirstDownload.delete(found.id)) {
    return problem(503, 'The documents service is unavailable');
  }
  pkg.downloads += 1;
  found.timeline.push(
    entry(
      'downloaded',
      now.toISOString(),
      found.reference,
      'Package downloaded',
      found.formK.partI.name,
    ),
  );
  return json(200, {
    downloadUrl: `/api/mock-packages/${documentId}`,
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
    sha256: '0'.repeat(64),
  });
}

/** Whether the bearer token, unverified, carries the realm role. */
function hasRole(request: Request, role: string): boolean {
  const token = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  const payload = token?.split('.')[1];
  if (!payload) return false;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      realm_access?: { roles?: string[] };
    };
    return claims.realm_access?.roles?.includes(role) ?? false;
  } catch {
    return false;
  }
}

export async function mockAccessFetch(request: Request): Promise<Response> {
  if (!seeded) resetAccessMock();
  const url = new URL(request.url);
  const path = url.pathname;
  const download = /^\/v1\/documents\/([^/]+)\/download$/.exec(path);
  if (request.method === 'GET' && download?.[1]) {
    // Documents answers anyone but the document's subject with 404: applicants get their
    // packages, declarants their certified copies (`mock-history.server.ts`).
    if (hasRole(request, 'declarant')) {
      await settle();
      return mockCopyDownload(download[1]) ?? problem(404, 'Not found');
    }
    if (!hasRole(request, 'applicant')) return problem(404, 'Not found');
    await settle();
    return packageDownload(download[1]);
  }
  // The declarant's side: the requests about their declaration (`mock-notices.server.ts`), who
  // accessed it and their certified copies (`mock-history.server.ts`).
  const history = isHistoryPath(path);
  const role = path.startsWith('/v1/me/access-notices') || history ? 'declarant' : 'applicant';
  if (!hasRole(request, role)) {
    return json(403, {
      type: 'about:blank',
      title: 'Forbidden',
      status: 403,
      detail: `Requires one of the roles: ${role}`,
    });
  }
  if (failNext) {
    failNext = false;
    return problem(503, 'The access service is unavailable');
  }
  if (history) return mockHistoryFetch(request, path, settle);
  if (role === 'declarant') return mockNoticesFetch(request, path, settle);

  if (request.method === 'GET' && path === '/v1/access/commissions') {
    return json(
      200,
      MOCK_ACCESS_COMMISSIONS.map(({ slug, name, years, decisionDays }) => ({
        slug,
        name,
        years,
        decisionDays,
      })),
    );
  }
  if (path === '/v1/access/requests') {
    if (request.method === 'GET') return json(200, [...requests.values()].sort(newest));
    if (request.method === 'POST') {
      await settle();
      return submit(request);
    }
  }
  const one = /^\/v1\/access\/requests\/([^/]+)$/.exec(path);
  if (request.method === 'GET' && one?.[1]) {
    const found = requests.get(one[1]);
    return found ? json(200, found) : problem(404, 'No such request of the applicant');
  }
  const withdrawing = /^\/v1\/access\/requests\/([^/]+)\/withdraw$/.exec(path);
  if (request.method === 'POST' && withdrawing?.[1]) {
    await settle();
    return withdraw(withdrawing[1], request.headers.get('idempotency-key'));
  }
  return problem(404, 'Not in the access mock');
}
