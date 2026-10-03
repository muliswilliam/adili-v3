/**
 * In-memory stand-in for the access service's officer endpoints (access.yaml), used when
 * ACCESS_MOCK is set, for screens without the access service and its upstreams (directory,
 * documents, Temporal) running. One store for every caller, dated relative to when it was
 * seeded, holding the PSC's Form K requests in every state the queue and the request page show:
 *
 * - `verify`: a passport applicant's request, held for the access officer's check.
 * - `identify`: received today, Josephine Akinyi Ouma sought (search "Ouma").
 * - `unresolved`: officer-unresolved after its day-5 reminder, "Mrs Kamau" sought.
 * - `window`: the declarant notified two days ago; no representations yet. Form K names the
 *   officer "Peter Kamau"; the roster record is Peter Mwangi Kamau.
 * - `lateWindow`: identified only after its decision deadline passed; the declarant notified
 *   yesterday, so it is late while representations are still open.
 * - `noAccount`: identified as Samuel Kiprotich Rotich, who has no account: invited to onboard,
 *   waiting for the access officer to record the written notice (spec 10 decision 2).
 * - `writtenNotice`: Beatrice Achieng Otieno, no account, served in writing two days ago; her
 *   objection received in writing, with a scan of her letter, entered by the access officer.
 * - `decidedNoAccount`: Beatrice Achieng Otieno again, an older request served in writing and
 *   denied yesterday: the decision waits to be served on her in writing too.
 * - `objection`: under decision, the declarant objected with two attachments; due in 3 days.
 * - `consent`: the declarant consented, which closed the window early.
 * - `late`: under decision with context, 7 days past its decision deadline.
 * - `noReply`: under decision, the window closed without representations.
 * - `cannot`, `withdrawn`: closed; `denied`: decided with two grounds.
 * - `granted`: package issued, not downloaded yet; `partial`: partially granted, its package
 *   downloaded twice; `endsToday`: the download window ends today; `expired`: the window closed;
 *   `preparing`: granted a minute ago, the package not issued yet (it stays so); `nilLetter`:
 *   granted on a scope that held nothing, answered with the nil letter (decision 1); `failed`:
 *   granted two days ago, its package could not be issued.
 * - Older decided requests fill a second page.
 *
 * Only the access officer acts (roster search, resolve, verify, written notice, representations
 * received in writing); a supervisor gets 403, as the service answers. Resolving to a record
 * leaves the request as it was until the workflow notifies the declarant, two seconds later; to a
 * record not onboarded, it waits for the written notice instead. Searching the queue for `slow` answers after four seconds
 * (the loading state); for `offline`, 503. Searching the roster for `offline` is 503 too.
 * Attachment links point at `/api/mock-files/{id}` (`routes/api/mock-files.$id.ts`). Written
 * self-access applications are answered by `self-access-mock.server.ts`.
 *
 * The scope preview (decision 1) counts what `mock-preview.ts` says the declarant holds: Grace
 * Nyambura Kamau filed nothing in 2026, so `noReply` (2026 assets) previews empty; officers with
 * no account hold nothing. Supervisors may preview too.
 *
 * A decision follows the access service's rules (`decisionOf`: 400 by field, 409 unless under
 * decision); a grant's package is issued four seconds later, as the nil letter when its scope
 * previews empty. Reasons containing `offline` answer
 * 503; `rejected`, a 400 the form did not foresee (`grounds-required`); `raced`, a 409 as if
 * another officer decided first (the request is then decided by Peter Otieno).
 */
import { randomUUID } from 'node:crypto';

import { addDays, isScopeWithin, nairobiDayStartOf } from '@adili/ui';
import createClient from 'openapi-fetch';

import { isRecord, json, problem, readJson } from '../mock-http';
import type { paths } from './api.gen';
import {
  mockSelfAccessFetch,
  mockSelfAccessFileTitle,
  mockUploadOf,
} from './self-access-mock.server';
import {
  leaQueueItems,
  mockLeaFetch,
  mockLeaFileTitle,
  resetLeaMock,
  setLeaMockLatency,
} from './lea-mock.server';
import { mockCallerOf, mockToken } from './mock-caller';
import { mockScopePreview } from './mock-preview';
import { MOCK_ROSTER, MOCK_ROSTER_IDS, searchMockRoster } from './mock-roster';
import type {
  AccessRequestStatus,
  OfficerRequestView,
  QueueItem,
  QueueStatus,
  RegisterEntry,
} from './types';

export { MOCK_ROSTER_IDS };

export const MOCK_REQUEST_IDS = {
  verify: 'a11c0000-0000-4000-8000-000000000001',
  identify: 'a11c0000-0000-4000-8000-000000000002',
  unresolved: 'a11c0000-0000-4000-8000-000000000003',
  window: 'a11c0000-0000-4000-8000-000000000004',
  objection: 'a11c0000-0000-4000-8000-000000000005',
  consent: 'a11c0000-0000-4000-8000-000000000006',
  late: 'a11c0000-0000-4000-8000-000000000007',
  noReply: 'a11c0000-0000-4000-8000-000000000008',
  cannot: 'a11c0000-0000-4000-8000-000000000009',
  withdrawn: 'a11c0000-0000-4000-8000-000000000010',
  granted: 'a11c0000-0000-4000-8000-000000000011',
  denied: 'a11c0000-0000-4000-8000-000000000012',
  partial: 'a11c0000-0000-4000-8000-000000000013',
  endsToday: 'a11c0000-0000-4000-8000-000000000014',
  expired: 'a11c0000-0000-4000-8000-000000000015',
  preparing: 'a11c0000-0000-4000-8000-000000000016',
  nilLetter: 'a11c0000-0000-4000-8000-000000000017',
  lateWindow: 'a11c0000-0000-4000-8000-000000000018',
  noAccount: 'a11c0000-0000-4000-8000-000000000019',
  writtenNotice: 'a11c0000-0000-4000-8000-000000000020',
  failed: 'a11c0000-0000-4000-8000-000000000021',
  decidedNoAccount: 'a11c0000-0000-4000-8000-000000000022',
} as const;

const PSC = { slug: 'psc', name: 'Public Service Commission' };
const DECLARATION =
  'I declare that the information I have given above is true, complete and correct to the best of my knowledge.';
const DECISION_DAYS = 30;
const WINDOW_DAYS = 7;
/** How long the mock's workflow takes to notify the declarant after a resolution. */
const NOTIFY_AFTER_MS = 2000;
/** How long it takes to issue a grant's package after the decision. */
const ISSUE_AFTER_MS = 4000;
const DOWNLOAD_DAYS = 14;

interface Applicant {
  name: string;
  occupation: string;
  identityDocument: { kind: 'national-id' | 'passport'; number: string; country?: string };
  telephone: string;
  email: string;
  postalAddress: string;
  physicalAddress: string;
}

const MERCY: Applicant = {
  name: 'Mercy Wanjiku Kamau',
  occupation: 'Journalist',
  identityDocument: { kind: 'national-id', number: '28841276' },
  telephone: '+254722418903',
  email: 'mercy.kamau@gmail.com',
  postalAddress: 'P.O. Box 49010-00100, Nairobi',
  physicalAddress: 'Othaya Road, Kileleshwa, Nairobi',
};
const KWAME: Applicant = {
  name: 'Kwame Mensah',
  occupation: 'Researcher, anti-corruption NGO',
  identityDocument: { kind: 'passport', number: 'G2837465', country: 'GH' },
  telephone: '+233244718265',
  email: 'kwame.mensah@outlook.com',
  postalAddress: 'P.O. Box 30218-00100, Nairobi',
  physicalAddress: 'Riverside Drive, Westlands, Nairobi',
};
const DENNIS: Applicant = {
  name: 'Dennis Kiplagat',
  occupation: 'Civil society officer',
  identityDocument: { kind: 'national-id', number: '30115526' },
  telephone: '+254712109427',
  email: 'dennis.kiplagat@yahoo.com',
  postalAddress: 'P.O. Box 2410-30100, Eldoret',
  physicalAddress: 'Eldoret',
};
const PAUL: Applicant = {
  name: 'Paul Kamau Njoroge',
  occupation: 'Businessman',
  identityDocument: { kind: 'national-id', number: '20142542' },
  telephone: '+254712518642',
  email: 'paul.njoroge@mail.co.ke',
  postalAddress: 'P.O. Box 30100-00100, Nairobi',
  physicalAddress: 'Thika',
};
const BRENDA: Applicant = {
  name: 'Brenda Wanjiru Gachie',
  occupation: 'Student',
  identityDocument: { kind: 'national-id', number: '39027716' },
  telephone: '+254799310845',
  email: 'brenda.gachie@students.uonbi.ac.ke',
  postalAddress: 'P.O. Box 30197-00100, Nairobi',
  physicalAddress: 'Kahawa Wendani, Kiambu',
};
const ESTHER: Applicant = {
  name: 'Esther Nduta Gikonyo',
  occupation: 'Nurse',
  identityDocument: { kind: 'national-id', number: '20158380' },
  telephone: '+254712640991',
  email: 'esther.gikonyo@mail.co.ke',
  postalAddress: 'P.O. Box 30100-00100, Nairobi',
  physicalAddress: 'Kiambu',
};

interface Sought {
  name: string;
  entity: string;
  workStation: string;
  personnelFileNumber?: string;
}

interface Seed {
  id: string;
  /** `ARQ-PSC-2026-<seq>-<check>`, with a valid check character. */
  reference: string;
  applicant: Applicant;
  sought: Sought;
  informationSought: string;
  reason: string;
  otherInformation?: string;
  scope: OfficerRequestView['formK']['scope'];
  /** Days before the store was seeded that it was received. */
  receivedDaysAgo: number;
  status: AccessRequestStatus;
  resolved?: string;
  /** Days after receipt the declarant was notified. */
  notifiedAfterDays?: number;
  /** Resolved days after receipt (to show when the officer was identified); else not shown. */
  resolvedAfterDays?: number;
  /**
   * The officer resolved to has no account: invited to onboard when resolved; served in writing
   * the day `notifiedAfterDays` gives (the notice recorded the day after), if at all.
   */
  noAccount?: { served: boolean };
  representations?: {
    stance: 'object' | 'consent' | 'context';
    text: string;
    attachments?: { uploadId: string; fileName: string }[];
    afterNotifiedDays: number;
    editedAfterDays?: number;
    /** Received in writing, entered by the access officer. */
    inWriting?: boolean;
  };
  closedAfterDays?: number;
  decision?: {
    outcome: 'grant' | 'partial-grant' | 'deny';
    afterDays: number;
    reasons: string;
    grantedScope?: OfficerRequestView['formK']['scope'];
    grounds?: Ground[];
  };
  /**
   * A grant's package: issued an hour after the decision, unless `expiresAt` (epoch ms from the
   * seeding time) places its window; downloads hours after issue. Left out: still preparing.
   */
  pkg?: {
    downloadsAfterHours?: number[];
    expiresAt?: (now: number) => number;
    /** The nil letter instead of the access package (the scope held nothing). */
    nilLetter?: boolean;
  };
  /** Issuing the grant's package failed after its retries. */
  packageFailed?: boolean;
}

type Ground = OfficerRequestView['decision'] extends infer D
  ? D extends { grounds: (infer G)[] }
    ? G
    : never
  : never;

const SCOPE_2026_ASSETS = {
  years: [2026],
  includeSpouses: false,
  includeChildren: false,
  sections: ['assets' as const],
  includeClarifications: false,
};

interface Stored {
  view: OfficerRequestView;
  /** When the mock workflow notifies the declarant of a resolution (epoch ms), if pending. */
  notifyAt: number | null;
  /** When it issues a grant's package (epoch ms), if pending. */
  issueAt: number | null;
  /** For the queue's closed and decided rows. */
  closedAt: string | null;
}

const requests = new Map<string, Stored>();

function iso(now: number, days: number): string {
  return addDays(new Date(now).toISOString(), days);
}

function hoursLater(at: string, hours: number): string {
  return new Date(Date.parse(at) + hours * 60 * 60 * 1000).toISOString();
}

/** An issued package, with a verification code made from its reference. */
function packageOf(
  issuedAt: string,
  downloads: number,
  reference: string,
  kind: NonNullable<OfficerRequestView['package']>['kind'] = 'access-package',
): NonNullable<OfficerRequestView['package']> {
  const seq = reference.split('-').slice(3).join('');
  return {
    kind,
    documentId: randomUUID(),
    verificationId: `ADL-A7KQ-${seq.slice(0, 4)}-${seq.slice(4, 8).padEnd(4, 'X')}-9TPD-2HRC`,
    issuedAt,
    downloadExpiresAt: iso(Date.parse(issuedAt), DOWNLOAD_DAYS),
    downloads,
  };
}

function entry(
  kind: RegisterEntry['kind'],
  at: string,
  actor: string | null,
  reference: string,
  inWriting = false,
): RegisterEntry {
  return { id: randomUUID(), kind, at, actor, summary: kind, reference, inWriting };
}

/** The Nairobi calendar day of an instant, `YYYY-MM-DD`. */
function nairobiDay(at: string): string {
  return new Date(Date.parse(at) + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** The instant the Nairobi calendar day `day` (YYYY-MM-DD) starts. */
function midnightOn(day: string): string {
  return new Date(`${day}T00:00:00+03:00`).toISOString();
}

/** A written notice served on `day`: notified from its start, window to the end of day + 7. */
function writtenWindow(day: string): { notifiedAt: string; windowEndsAt: string } {
  const notifiedAt = midnightOn(day);
  return { notifiedAt, windowEndsAt: iso(Date.parse(notifiedAt), WINDOW_DAYS + 1) };
}

const OFFICER_NAME = 'Lucy Wambui';

/** 09:10 in Nairobi on the seeding day, or the day before when that is still ahead. */
function morningOf(now: number): number {
  const today = Date.parse(nairobiDayStartOf(new Date(now).toISOString())) + (9 * 60 + 10) * 60_000;
  return today <= now ? today : today - 24 * 60 * 60 * 1000;
}

function build(seed: Seed, now: number): Stored {
  const submittedAt = iso(morningOf(now), -seed.receivedDaysAgo);
  const deadline = iso(Date.parse(submittedAt), DECISION_DAYS);
  const record = seed.resolved ? MOCK_ROSTER.find((each) => each.id === seed.resolved) : undefined;
  const timeline: RegisterEntry[] = [
    entry('received', submittedAt, seed.applicant.name, seed.reference),
  ];
  const resolvedAt =
    seed.resolvedAfterDays === undefined
      ? null
      : hoursLater(iso(Date.parse(submittedAt), seed.resolvedAfterDays), 2);
  if (resolvedAt) timeline.push(entry('identified', resolvedAt, OFFICER_NAME, seed.reference));
  let notifiedAt: string | null = null;
  let windowEndsAt: string | null = null;
  let notice: OfficerRequestView['notice'] = null;
  if (seed.notifiedAfterDays !== undefined && seed.noAccount?.served) {
    const servedOn = nairobiDay(iso(Date.parse(submittedAt), seed.notifiedAfterDays));
    ({ notifiedAt, windowEndsAt } = writtenWindow(servedOn));
    const recordedAt = hoursLater(iso(Date.parse(submittedAt), seed.notifiedAfterDays + 1), 1);
    timeline.push(entry('notified', recordedAt, OFFICER_NAME, seed.reference, true));
    notice = { channel: 'written', notifiedAt, notifiedOn: servedOn, recordedBy: OFFICER_NAME };
  } else if (seed.notifiedAfterDays !== undefined) {
    notifiedAt = hoursLater(iso(Date.parse(submittedAt), seed.notifiedAfterDays), 1);
    windowEndsAt = iso(Date.parse(notifiedAt), WINDOW_DAYS);
    timeline.push(entry('notified', notifiedAt, null, seed.reference));
    notice = { channel: 'online', notifiedAt, notifiedOn: null, recordedBy: null };
  }
  let representations: OfficerRequestView['representations'] = null;
  if (seed.representations && notifiedAt) {
    const submitted = hoursLater(
      iso(Date.parse(notifiedAt), seed.representations.afterNotifiedDays),
      3,
    );
    const updated =
      seed.representations.editedAfterDays === undefined
        ? submitted
        : hoursLater(iso(Date.parse(notifiedAt), seed.representations.editedAfterDays), 5);
    const inWriting = seed.representations.inWriting ?? false;
    representations = {
      stance: seed.representations.stance,
      text: seed.representations.text,
      attachments: seed.representations.attachments ?? [],
      submittedAt: submitted,
      updatedAt: updated,
      receivedInWriting: inWriting,
      recordedBy: inWriting ? OFFICER_NAME : null,
    };
    const actor = inWriting ? OFFICER_NAME : (record?.fullName ?? null);
    timeline.push(entry('representations', submitted, actor, seed.reference, inWriting));
    if (updated !== submitted) {
      timeline.push(entry('representations', updated, actor, seed.reference, inWriting));
    }
  }
  let closedAt: string | null = null;
  if (seed.closedAfterDays !== undefined) {
    closedAt = hoursLater(iso(Date.parse(submittedAt), seed.closedAfterDays), 4);
    timeline.push(
      seed.status === 'withdrawn'
        ? entry('withdrawn', closedAt, seed.applicant.name, seed.reference)
        : entry('cannot-identify', closedAt, OFFICER_NAME, seed.reference),
    );
  }
  let decision: OfficerRequestView['decision'] = null;
  let pkg: OfficerRequestView['package'] = null;
  if (seed.decision) {
    const { outcome } = seed.decision;
    const decidedAt =
      seed.decision.afterDays < 0
        ? new Date(now + seed.decision.afterDays * 24 * 60 * 60 * 1000).toISOString()
        : hoursLater(iso(Date.parse(submittedAt), seed.decision.afterDays), 6);
    closedAt = decidedAt;
    decision = {
      outcome,
      grantedScope:
        outcome === 'deny'
          ? null
          : outcome === 'grant'
            ? seed.scope
            : (seed.decision.grantedScope ?? null),
      grounds: seed.decision.grounds ?? (outcome === 'deny' ? ['frivolous-vexatious'] : []),
      reasons: seed.decision.reasons,
      decidedBy: { subject: 'mock-access-officer', name: OFFICER_NAME },
      decidedAt,
    };
    timeline.push(entry('decided', decidedAt, OFFICER_NAME, seed.reference));
    if (seed.pkg && outcome !== 'deny') {
      const expiresAt = seed.pkg.expiresAt
        ? new Date(seed.pkg.expiresAt(now)).toISOString()
        : iso(Date.parse(hoursLater(decidedAt, 1)), DOWNLOAD_DAYS);
      const issuedAt = iso(Date.parse(expiresAt), -DOWNLOAD_DAYS);
      const downloads = (seed.pkg.downloadsAfterHours ?? []).map((hours) =>
        hoursLater(issuedAt, hours),
      );
      pkg = packageOf(
        issuedAt,
        downloads.length,
        seed.reference,
        seed.pkg.nilLetter ? 'nil-letter' : 'access-package',
      );
      timeline.push(entry('package-issued', issuedAt, null, seed.reference));
      for (const at of downloads) {
        timeline.push(entry('downloaded', at, seed.applicant.name, seed.reference));
      }
      if (Date.parse(expiresAt) <= now) {
        timeline.push(entry('expired', expiresAt, null, seed.reference));
      }
    }
  }
  const partII: OfficerRequestView['formK']['partII'] = {
    name: seed.sought.name,
    entity: seed.sought.entity,
    workStation: seed.sought.workStation,
  };
  if (seed.sought.personnelFileNumber) partII.personnelFileNumber = seed.sought.personnelFileNumber;
  return {
    notifyAt: null,
    issueAt: null,
    closedAt,
    view: {
      id: seed.id,
      reference: seed.reference,
      commission: PSC,
      status: seed.status,
      formK: {
        schemaVersion: 'form-k.v1',
        responsibleCommission: 'psc',
        partI: {
          name: seed.applicant.name,
          identityDocument: seed.applicant.identityDocument,
          postalAddress: seed.applicant.postalAddress,
          physicalAddress: seed.applicant.physicalAddress,
          telephone: seed.applicant.telephone,
          email: seed.applicant.email,
          occupation: seed.applicant.occupation,
        },
        partII,
        partIII: {
          informationSought: seed.informationSought,
          reason: seed.reason,
          otherInformation: seed.otherInformation ?? '',
        },
        partIV: { text: DECLARATION, declaredAt: hoursLater(submittedAt, -0.1) },
        scope: seed.scope,
        meta: { reference: seed.reference, submittedAt },
      },
      submittedAt,
      decisionDeadlineAt: deadline,
      decision,
      package: pkg,
      packageFailedAt: seed.packageFailed && decision ? hoursLater(decision.decidedAt, 7.5) : null,
      timeline,
      applicantIdentityStatus:
        seed.status === 'pending-applicant-verification' ? 'pending-verification' : 'verified',
      resolvedRosterRecordId: record?.id ?? null,
      resolvedName: record?.fullName ?? null,
      resolvedFileNumber: record?.personnelFileNumber ?? null,
      representations,
      windowEndsAt,
      representationWindowDays: windowEndsAt === null ? WINDOW_DAYS : null,
      declarantOnboarded: record ? record.onboarded : null,
      declarantInvitedAt: record && !record.onboarded ? (resolvedAt ?? submittedAt) : null,
      notice,
      decisionNotice: null,
    },
  };
}

const R = MOCK_REQUEST_IDS;
const K = MOCK_ROSTER_IDS;

const SEEDS: Seed[] = [
  {
    id: R.verify,
    reference: 'ARQ-PSC-2026-0000148-M',
    applicant: KWAME,
    sought: {
      name: 'Peter Mwangi Kamau',
      entity: 'State Department for Housing and Urban Development',
      workStation: 'Ardhi House, Nairobi',
    },
    informationSought: 'Assets declared in the 2026 initial declaration.',
    reason:
      'Our research on affordable housing tenders found companies linked to officers of the department. The declaration shows whether the officer declared those interests.',
    scope: SCOPE_2026_ASSETS,
    receivedDaysAgo: 2,
    status: 'pending-applicant-verification',
  },
  {
    id: R.identify,
    reference: 'ARQ-PSC-2026-0000151-W',
    applicant: MERCY,
    sought: {
      name: 'Josephine Akinyi Ouma',
      entity: 'State Department for Public Works',
      workStation: 'Ministry of Roads and Transport, Nairobi',
    },
    informationSought: 'Income and assets declared in the 2026 initial declaration.',
    reason:
      'The officer approved variations worth KES 1.2 billion on the Northern Bypass contract. I want to see whether any income or assets link to the contractor, in furtherance of the objectives of the Act.',
    scope: { ...SCOPE_2026_ASSETS, sections: ['income', 'assets'] },
    receivedDaysAgo: 0,
    status: 'submitted',
  },
  {
    id: R.unresolved,
    reference: 'ARQ-PSC-2026-0000134-Y',
    applicant: DENNIS,
    sought: { name: 'Mrs Kamau', entity: 'Housing department', workStation: 'Ardhi House' },
    informationSought: 'Assets declared in 2025 and 2026.',
    reason: 'Our coalition tracks affordable housing procurement.',
    scope: { ...SCOPE_2026_ASSETS, years: [2025, 2026] },
    receivedDaysAgo: 11,
    status: 'officer-unresolved',
  },
  {
    id: R.window,
    reference: 'ARQ-PSC-2026-0000142-Y',
    applicant: MERCY,
    sought: {
      name: 'Peter Kamau',
      entity: 'State Department for Housing and Urban Development',
      workStation: 'Ardhi House, Nairobi',
    },
    informationSought:
      'Assets and liabilities declared in the biennial declarations, including land and vehicles.',
    reason:
      'I am reporting on procurement of affordable housing contracts. Public records show a company linked to the officer won three tenders in 2025. The declarations will show whether the officer declared an interest in that company, which is in furtherance of the Act.',
    otherInformation: 'My press card number is KMC-2024-11873 (Media Council of Kenya).',
    scope: {
      years: [2025, 2026],
      includeSpouses: true,
      includeChildren: false,
      sections: ['assets', 'liabilities'],
      includeClarifications: false,
    },
    receivedDaysAgo: 4,
    status: 'awaiting-representations',
    resolved: K.peterKamau,
    notifiedAfterDays: 2,
  },
  {
    id: R.objection,
    reference: 'ARQ-PSC-2026-0000139-O',
    applicant: MERCY,
    sought: {
      name: 'Grace Atieno Odhiambo',
      entity: 'Kenya Rural Roads Authority',
      workStation: 'Head office, Barabara Plaza, Nairobi',
      personnelFileNumber: 'KRR/2011/0442',
    },
    informationSought: 'Income from other sources and liabilities, 2025 and 2026.',
    reason:
      'A contractor paid consultancy fees to a firm registered to a relative of the officer. The declarations show whether that income was declared.',
    scope: {
      years: [2025, 2026],
      includeSpouses: true,
      includeChildren: true,
      sections: ['income', 'liabilities'],
      includeClarifications: true,
    },
    receivedDaysAgo: 27,
    status: 'under-decision',
    resolved: K.graceAtieno,
    notifiedAfterDays: 2,
    representations: {
      stance: 'object',
      text: "I object to the release of my children's details. They are students and have no income. The consultancy firm belongs to my brother-in-law; I declared the relationship to the tender committee in March 2026 and did not take part in the award.",
      attachments: [
        {
          uploadId: 'a11e0000-0000-4000-8000-000000000001',
          fileName: 'Declaration of interest to tender committee.pdf',
        },
        {
          uploadId: 'a11e0000-0000-4000-8000-000000000002',
          fileName: 'Tender committee minutes KeRRA-2026-03.pdf',
        },
      ],
      afterNotifiedDays: 3,
      editedAfterDays: 5,
    },
  },
  {
    id: R.consent,
    reference: 'ARQ-PSC-2026-0000120-9',
    applicant: PAUL,
    sought: {
      name: 'Esther Njoroge',
      entity: 'State Department for Public Service',
      workStation: 'ICT',
    },
    informationSought: 'Other information (business interests) in 2026.',
    reason: 'Our company is bidding for an ICT tender. We want to confirm there is no conflict.',
    scope: { ...SCOPE_2026_ASSETS, sections: ['other'] },
    receivedDaysAgo: 10,
    status: 'under-decision',
    resolved: K.esther,
    notifiedAfterDays: 1,
    representations: {
      stance: 'consent',
      text: 'I consent. I have no business interests to hide.',
      afterNotifiedDays: 1,
    },
  },
  {
    id: R.late,
    reference: 'ARQ-PSC-2026-0000060-1',
    applicant: MERCY,
    sought: {
      name: 'Lilian Wairimu Njoroge',
      entity: 'The National Treasury',
      workStation: 'Treasury Building, Nairobi',
      personnelFileNumber: '20102284',
    },
    informationSought: 'Income and assets declared in 2025.',
    reason:
      'The officer oversaw pending bills payments that are the subject of an audit query. The declaration shows whether the officer declared any interest in the paid suppliers.',
    scope: { ...SCOPE_2026_ASSETS, years: [2025], sections: ['income', 'assets'] },
    receivedDaysAgo: 37,
    status: 'under-decision',
    resolved: K.lilian,
    notifiedAfterDays: 3,
    representations: {
      stance: 'context',
      text: 'The suppliers named in the audit query were paid under a framework agreement approved before I joined the Treasury. I have no interest in any of them.',
      afterNotifiedDays: 6,
    },
  },
  {
    id: R.noReply,
    reference: 'ARQ-PSC-2026-0000116-1',
    applicant: BRENDA,
    sought: {
      name: 'Grace Nyambura Kamau',
      entity: 'State Department for Housing and Urban Development',
      workStation: 'Ardhi House, Nairobi',
    },
    informationSought: 'Assets declared in 2026.',
    reason: 'A research project on lifestyle audits in public procurement, for my thesis.',
    scope: SCOPE_2026_ASSETS,
    receivedDaysAgo: 16,
    status: 'under-decision',
    resolved: K.grace,
    notifiedAfterDays: 2,
  },
  {
    id: R.cannot,
    reference: 'ARQ-PSC-2026-0000109-0',
    applicant: ESTHER,
    sought: { name: 'Dr Achieng', entity: 'Kenyatta National Hospital', workStation: 'Casualty' },
    informationSought: 'Income in 2026.',
    reason: 'Concern about private practice during working hours.',
    scope: { ...SCOPE_2026_ASSETS, sections: ['income'] },
    receivedDaysAgo: 24,
    status: 'cannot-identify',
    closedAfterDays: 3,
  },
  {
    id: R.withdrawn,
    reference: 'ARQ-PSC-2026-0000097-C',
    applicant: PAUL,
    sought: {
      name: 'Peter Omondi Ouma',
      entity: 'Ministry of Health',
      workStation: 'Afya House, Nairobi',
    },
    informationSought: 'Assets declared in 2026.',
    reason: 'A supplier dispute.',
    scope: SCOPE_2026_ASSETS,
    receivedDaysAgo: 20,
    status: 'withdrawn',
    closedAfterDays: 2,
  },
  {
    id: R.granted,
    reference: 'ARQ-PSC-2026-0000088-E',
    applicant: MERCY,
    sought: {
      name: 'Josephine Akinyi Ouma',
      entity: 'State Department for Public Works',
      workStation: 'Ministry of Roads and Transport, Nairobi',
    },
    informationSought: 'Assets declared in 2025.',
    reason: 'Reporting on the Northern Bypass contract variations.',
    scope: { ...SCOPE_2026_ASSETS, years: [2025] },
    receivedDaysAgo: 20,
    status: 'granted',
    resolved: K.josephine,
    notifiedAfterDays: 1,
    decision: {
      outcome: 'grant',
      afterDays: -3,
      reasons: 'A legitimate interest in public procurement; the declarant consented.',
    },
    pkg: {},
  },
  {
    id: R.denied,
    reference: 'ARQ-PSC-2026-0000090-Q',
    applicant: DENNIS,
    sought: {
      name: 'Peter Omondi Ouma',
      entity: 'Ministry of Health',
      workStation: 'Afya House, Nairobi',
    },
    informationSought: 'Everything declared in 2025 and 2026.',
    reason: 'Personal disagreement with the officer.',
    scope: {
      years: [2025, 2026],
      includeSpouses: true,
      includeChildren: true,
      sections: ['bio', 'income', 'assets', 'liabilities', 'other'],
      includeClarifications: true,
    },
    receivedDaysAgo: 45,
    status: 'denied',
    resolved: K.peterOuma,
    notifiedAfterDays: 2,
    decision: {
      outcome: 'deny',
      afterDays: 20,
      reasons:
        'The request is part of a private dispute and does not promote the objectives of the Act.',
      grounds: ['frivolous-vexatious', 'not-objectives'],
    },
  },
  {
    id: R.partial,
    reference: 'ARQ-PSC-2026-0000118-3',
    applicant: MERCY,
    sought: {
      name: 'Peter Mwangi Kamau',
      entity: 'State Department for Housing and Urban Development',
      workStation: 'Ardhi House, Nairobi',
    },
    informationSought:
      'Assets, liabilities and income in the 2025 and 2026 declarations, with spouse and children.',
    reason:
      'Several parcels in Ruiru were re-allocated to companies linked to officers of the department. The declarations show whether the officer declared land held directly or through family.',
    scope: {
      years: [2025, 2026],
      includeSpouses: true,
      includeChildren: true,
      sections: ['income', 'assets', 'liabilities'],
      includeClarifications: true,
    },
    receivedDaysAgo: 34,
    status: 'partially-granted',
    resolved: K.peterKamau,
    notifiedAfterDays: 2,
    decision: {
      outcome: 'partial-grant',
      afterDays: -6,
      reasons:
        "The request for land holdings is in furtherance of the objectives of the Act. Income and the declarations of the officer's children are not needed for that purpose and disclosing them would be against the public interest. The 2025 declaration predates the re-allocations and is not granted.",
      grantedScope: {
        years: [2026],
        includeSpouses: true,
        includeChildren: false,
        sections: ['assets', 'liabilities'],
        includeClarifications: true,
      },
      grounds: ['public-interest'],
    },
    pkg: { downloadsAfterHours: [6, 30] },
  },
  {
    id: R.endsToday,
    reference: 'ARQ-PSC-2026-0000102-K',
    applicant: BRENDA,
    sought: {
      name: 'Esther Wairimu Njoroge',
      entity: 'State Department for Public Service',
      workStation: 'ICT',
    },
    informationSought: 'Other information (business interests) in 2026.',
    reason: 'A research project on lifestyle audits in public procurement, for my thesis.',
    scope: { ...SCOPE_2026_ASSETS, sections: ['other'] },
    receivedDaysAgo: 40,
    status: 'granted',
    resolved: K.esther,
    notifiedAfterDays: 1,
    decision: {
      outcome: 'grant',
      afterDays: -14.05,
      reasons: 'A legitimate research interest; the declarant consented.',
    },
    pkg: { expiresAt: endOfToday },
  },
  {
    id: R.expired,
    reference: 'ARQ-PSC-2026-0000079-5',
    applicant: PAUL,
    sought: {
      name: 'Lilian Wairimu Njoroge',
      entity: 'The National Treasury',
      workStation: 'Treasury Building, Nairobi',
    },
    informationSought: 'Liabilities declared in 2025.',
    reason: 'A supplier payment audit.',
    scope: { ...SCOPE_2026_ASSETS, years: [2025], sections: ['liabilities'] },
    receivedDaysAgo: 60,
    status: 'granted',
    resolved: K.lilian,
    notifiedAfterDays: 1,
    decision: {
      outcome: 'grant',
      afterDays: 18,
      reasons: 'A legitimate interest in public finance; no representations were made.',
    },
    pkg: { downloadsAfterHours: [20] },
  },
  {
    id: R.preparing,
    reference: 'ARQ-PSC-2026-0000127-8',
    applicant: ESTHER,
    sought: {
      name: 'Grace Nyambura Kamau',
      entity: 'State Department for Housing and Urban Development',
      workStation: 'Ardhi House, Nairobi',
    },
    informationSought: 'Assets declared in 2026.',
    reason: 'Our research on affordable housing tenders.',
    scope: SCOPE_2026_ASSETS,
    receivedDaysAgo: 18,
    status: 'granted',
    resolved: K.grace,
    notifiedAfterDays: 2,
    decision: {
      outcome: 'grant',
      afterDays: -0.001,
      reasons: 'A legitimate research interest in public procurement.',
    },
  },
  {
    id: R.lateWindow,
    reference: 'ARQ-PSC-2026-0000143-W',
    applicant: PAUL,
    sought: {
      name: 'Lilian Wairimu Njoroge',
      entity: 'The National Treasury',
      workStation: 'Treasury Building, Nairobi',
    },
    informationSought: 'Income declared in 2026.',
    reason: 'A supplier payment audit.',
    scope: { ...SCOPE_2026_ASSETS, sections: ['income'] },
    receivedDaysAgo: 32,
    status: 'awaiting-representations',
    resolved: K.lilian,
    notifiedAfterDays: 31,
  },
  {
    id: R.nilLetter,
    reference: 'ARQ-PSC-2026-0000141-0',
    applicant: ESTHER,
    sought: {
      name: 'Lilian Wairimu Njoroge',
      entity: 'The National Treasury',
      workStation: 'Treasury Building, Nairobi',
    },
    informationSought: 'Other information declared in 2025.',
    reason: 'Our research on public finance.',
    scope: { ...SCOPE_2026_ASSETS, years: [2025], sections: ['other'] },
    receivedDaysAgo: 30,
    status: 'granted',
    resolved: K.lilian,
    notifiedAfterDays: 2,
    decision: {
      outcome: 'grant',
      afterDays: -2,
      reasons: 'A legitimate research interest in public finance.',
    },
    pkg: { nilLetter: true, downloadsAfterHours: [3] },
  },
  {
    id: R.failed,
    reference: referenceOf(158),
    applicant: MERCY,
    sought: {
      name: 'Esther Wairimu Njoroge',
      entity: 'State Department for Public Service',
      workStation: 'Harambee House, Nairobi',
    },
    informationSought: 'Assets declared in 2026.',
    reason: 'Reporting on public service ICT tenders.',
    scope: SCOPE_2026_ASSETS,
    receivedDaysAgo: 28,
    status: 'granted',
    resolved: K.esther,
    notifiedAfterDays: 2,
    decision: {
      outcome: 'grant',
      afterDays: -2,
      reasons: 'A legitimate public interest in health procurement.',
    },
    packageFailed: true,
  },
  {
    id: R.noAccount,
    reference: referenceOf(152),
    applicant: DENNIS,
    sought: {
      name: 'Samuel Rotich',
      entity: 'Ministry of Lands and Physical Planning',
      workStation: 'Ardhi House, Nairobi',
      personnelFileNumber: '20118802',
    },
    informationSought: 'Assets declared in the 2026 initial declaration, including land.',
    reason:
      'Our coalition follows land valuations for public projects. The declaration shows whether the officer declared land near the valuations he approved.',
    scope: { ...SCOPE_2026_ASSETS, includeSpouses: true },
    receivedDaysAgo: 4,
    status: 'submitted',
    resolved: K.samuel,
    resolvedAfterDays: 1,
    noAccount: { served: false },
  },
  {
    id: R.writtenNotice,
    reference: referenceOf(146),
    applicant: MERCY,
    sought: {
      name: 'Beatrice Achieng Otieno',
      entity: 'State Department for Public Works',
      workStation: 'Works Building, Nairobi',
    },
    informationSought: 'Income and liabilities declared in 2025 and 2026.',
    reason:
      'A road maintenance contractor shares directors with a firm the officer is linked to. The declarations show whether she declared that interest.',
    scope: { ...SCOPE_2026_ASSETS, years: [2025, 2026], sections: ['income', 'liabilities'] },
    receivedDaysAgo: 6,
    status: 'awaiting-representations',
    resolved: K.beatrice,
    resolvedAfterDays: 1,
    notifiedAfterDays: 3,
    noAccount: { served: true },
    representations: {
      stance: 'object',
      text: 'I object to the disclosure. I left the board of the firm in 2023, before I joined the procurement unit, and I declared it then. The applicant has my resignation letter on public record already.',
      attachments: [
        { uploadId: 'a11e0000-0000-4000-8000-000000000031', fileName: 'Letter from B. Otieno.pdf' },
      ],
      afterNotifiedDays: 2,
      inWriting: true,
    },
  },
  {
    id: R.decidedNoAccount,
    reference: referenceOf(137),
    applicant: DENNIS,
    sought: {
      name: 'Beatrice Achieng Otieno',
      entity: 'State Department for Public Works',
      workStation: 'Works Building, Nairobi',
    },
    informationSought: 'Everything declared in 2026.',
    reason: 'I want to know what she owns.',
    scope: { ...SCOPE_2026_ASSETS, sections: ['assets', 'other'] },
    receivedDaysAgo: 16,
    status: 'denied',
    resolved: K.beatrice,
    resolvedAfterDays: 1,
    notifiedAfterDays: 3,
    noAccount: { served: true },
    decision: {
      outcome: 'deny',
      afterDays: 15,
      grounds: ['frivolous-vexatious', 'not-objectives'],
      reasons: 'The application gives no reason connected to the officer’s public duties.',
    },
  },
];

/** Ten minutes before the end of the Kenyan day of `now`, or five minutes on when that passed. */
function endOfToday(now: number): number {
  const tomorrow = Date.parse(addDays(nairobiDayStartOf(new Date(now).toISOString()), 1));
  const end = tomorrow - 10 * 60 * 1000;
  return end > now ? end : now + 5 * 60 * 1000;
}

/** Older decided requests, so the queue has a second page. */
function fillers(): Seed[] {
  const sought = MOCK_ROSTER.filter((each) => each.onboarded);
  return Array.from({ length: 14 }, (_, index) => {
    const record = sought[index % sought.length] ?? MOCK_ROSTER[0];
    const seq = 70 - index * 3;
    return {
      id: `a11c0000-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`,
      reference: referenceOf(seq),
      applicant: index % 2 === 0 ? BRENDA : PAUL,
      sought: {
        name: record?.fullName ?? 'Officer',
        entity: record?.reportingEntity ?? 'Ministry',
        workStation: 'Nairobi',
      },
      informationSought: 'Assets declared in 2025.',
      reason: 'A research project on lifestyle audits in public procurement.',
      scope: { ...SCOPE_2026_ASSETS, years: [2025] },
      receivedDaysAgo: 50 + index * 6,
      status: index % 3 === 0 ? 'denied' : 'granted',
      resolved: record?.id,
      notifiedAfterDays: 1,
      decision: {
        outcome: index % 3 === 0 ? 'deny' : 'grant',
        afterDays: 12,
        reasons: 'Decided on the requested scope.',
      },
      pkg: {},
    };
  });
}

/** `ARQ-PSC-2026-<seq>` with its ISO 7064 MOD 37-36 check character (ADR-011). */
function referenceOf(seq: number): string {
  const base = `ARQ-PSC-2026-${String(seq).padStart(7, '0')}`;
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let state = 18;
  for (const character of base.replaceAll('-', '')) {
    state = ((((state || 36) * 2) % 37) + alphabet.indexOf(character)) % 36;
  }
  return `${base}-${alphabet.charAt((37 - (((state || 36) * 2) % 37)) % 36)}`;
}

export function resetAccessMock(now: number = Date.now()) {
  resetLeaMock(now);
  requests.clear();
  for (const seed of [...SEEDS, ...fillers()]) requests.set(seed.id, build(seed, now));
}

function ensureSeeded() {
  if (requests.size === 0) resetAccessMock();
}

/** Runs the mock workflow: a resolution notifies the declarant once its time has come. */
function advance(stored: Stored, now: number) {
  if (stored.issueAt !== null && now >= stored.issueAt) {
    const at = new Date(stored.issueAt).toISOString();
    stored.issueAt = null;
    const granted = stored.view.decision?.grantedScope;
    const empty =
      !granted ||
      stored.view.resolvedRosterRecordId === null ||
      mockScopePreview(stored.view.resolvedRosterRecordId, granted).empty;
    stored.view = {
      ...stored.view,
      package: packageOf(at, 0, stored.view.reference, empty ? 'nil-letter' : 'access-package'),
      timeline: [...stored.view.timeline, entry('package-issued', at, null, stored.view.reference)],
    };
  }
  if (stored.notifyAt === null || now < stored.notifyAt) return;
  const at = new Date(stored.notifyAt).toISOString();
  stored.notifyAt = null;
  stored.view = {
    ...stored.view,
    status: 'awaiting-representations',
    windowEndsAt: iso(Date.parse(at), WINDOW_DAYS),
    representationWindowDays: null,
    notice: { channel: 'online', notifiedAt: at, notifiedOn: null, recordedBy: null },
    timeline: [...stored.view.timeline, entry('notified', at, null, stored.view.reference)],
  };
}

interface Caller {
  subject: string;
  name: string;
  accessOfficer: boolean;
}

function callerOf(request: Request): Caller {
  const { subject, name, roles } = mockCallerOf(request);
  return { subject, name, accessOfficer: roles.includes('access-officer') };
}

const CLOSED: readonly QueueStatus[] = [
  'granted',
  'partially-granted',
  'denied',
  'cannot-identify',
  'withdrawn',
];

function queueItem(stored: Stored, now: number): QueueItem {
  const { view } = stored;
  return {
    kind: 'form-k',
    id: view.id,
    reference: view.reference,
    applicantOrAgency: view.formK.partI.name,
    officerSought: view.formK.partII.name,
    resolvedName: view.resolvedName,
    resolvedFileNumber: view.resolvedFileNumber,
    status: view.status,
    submittedAt: view.submittedAt,
    deadlineAt: view.decisionDeadlineAt,
    windowEndsAt: view.windowEndsAt,
    late: !CLOSED.includes(view.status) && now > Date.parse(view.decisionDeadlineAt),
    closedAt: stored.closedAt,
  };
}

function matches(item: QueueItem, search: string): boolean {
  const text = search.toLowerCase();
  return (
    item.reference.toLowerCase().startsWith(text) ||
    (item.resolvedFileNumber?.toLowerCase().startsWith(text) ?? false) ||
    [item.applicantOrAgency, item.officerSought, item.resolvedName ?? ''].some((name) =>
      name.toLowerCase().includes(text),
    )
  );
}

/** How much slower than nothing the mock answers commands, so busy states show; tests set 0. */
let latency = 1;

export function setAccessMockLatency(factor: number) {
  latency = factor;
  setLeaMockLatency(factor);
}

const delay = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms * latency);
  });

/** A client of the mock as `roles` (tests). */
export function mockAccessClient(roles: readonly string[], name = 'Lucy Wambui') {
  return createClient<paths>({
    baseUrl: 'http://access.test',
    headers: { authorization: `Bearer ${mockToken('mock-officer', name, roles)}` },
    fetch: mockAccessFetch,
  });
}

async function queue(url: URL): Promise<Response> {
  const now = Date.now();
  const status = url.searchParams.get('status')?.split(',');
  const late = url.searchParams.get('late');
  const search = url.searchParams.get('search')?.trim() ?? '';
  if (search === 'slow') await delay(4000);
  if (search === 'offline') return problem(503, 'Service unavailable');
  const limit = Number(url.searchParams.get('limit') ?? '50');
  const offset = Number(/^at-(\d+)$/.exec(url.searchParams.get('cursor') ?? '')?.[1] ?? '0');
  const kind = url.searchParams.get('kind');
  const formK = [...requests.values()].map((stored) => {
    advance(stored, now);
    return queueItem(stored, now);
  });
  const items = [...(kind === 'lea' ? [] : formK), ...(kind === 'form-k' ? [] : leaQueueItems(now))]
    .filter((item) => (status ? status.includes(item.status) : true))
    .filter((item) => (late === null ? true : item.late === (late === 'true')))
    .filter((item) => (search && search !== 'slow' ? matches(item, search) : true))
    // As the service orders it: open requests by earliest deadline, then closed by latest.
    .sort((a, b) => {
      const closedA = CLOSED.includes(a.status);
      const closedB = CLOSED.includes(b.status);
      if (closedA !== closedB) return closedA ? 1 : -1;
      const byDeadline = closedA
        ? b.deadlineAt.localeCompare(a.deadlineAt)
        : a.deadlineAt.localeCompare(b.deadlineAt);
      return byDeadline || a.id.localeCompare(b.id);
    });
  const page = items.slice(offset, offset + limit);
  return json(200, {
    items: page,
    nextCursor: offset + limit < items.length ? `at-${String(offset + limit)}` : null,
  });
}

async function resolve(request: Request, stored: Stored, caller: Caller): Promise<Response> {
  const body = await readJson(request);
  const rosterRecordId = isRecord(body) ? body.rosterRecordId : undefined;
  const { view } = stored;
  if (CLOSED.includes(view.status)) {
    return json(409, {
      type: 'about:blank',
      title: 'Request closed',
      status: 409,
      code: view.decision ? 'request-decided' : 'request-closed',
    });
  }
  if (view.status === 'pending-applicant-verification') {
    return problem(409, "The applicant's identity must be verified first");
  }
  if (
    view.resolvedRosterRecordId !== null ||
    (view.status !== 'submitted' && view.status !== 'officer-unresolved')
  ) {
    return problem(409, 'The officer is resolved already', 'officer-resolved');
  }
  const now = new Date().toISOString();
  if (rosterRecordId === null) {
    stored.closedAt = now;
    stored.view = {
      ...view,
      status: 'cannot-identify',
      timeline: [...view.timeline, entry('cannot-identify', now, caller.name, view.reference)],
    };
    return json(200, stored.view);
  }
  const record = MOCK_ROSTER.find((each) => each.id === rosterRecordId);
  if (!record) {
    return json(400, {
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      errors: [{ path: 'rosterRecordId', message: 'is not a roster record of the Commission' }],
    });
  }
  // An officer with no account is invited to onboard and served in writing.
  if (record.onboarded) stored.notifyAt = Date.now() + NOTIFY_AFTER_MS;
  stored.view = {
    ...view,
    resolvedRosterRecordId: record.id,
    resolvedName: record.fullName,
    resolvedFileNumber: record.personnelFileNumber,
    declarantOnboarded: record.onboarded,
    declarantInvitedAt: record.onboarded ? null : now,
    timeline: [...view.timeline, entry('identified', now, caller.name, view.reference)],
  };
  return json(200, stored.view);
}

/** `POST .../written-notice`: as the access service rules (decision 2, r.22(2)). */
async function writtenNotice(request: Request, stored: Stored, caller: Caller): Promise<Response> {
  const body = await readJson(request);
  const notifiedOn = isRecord(body) && typeof body.notifiedOn === 'string' ? body.notifiedOn : '';
  const { view } = stored;
  if (CLOSED.includes(view.status)) {
    return problem(
      409,
      'The request is closed',
      view.decision ? 'request-decided' : 'request-closed',
    );
  }
  if (view.notice) return problem(409, 'Notified already', 'declarant-notified');
  if (view.resolvedRosterRecordId === null || view.declarantOnboarded !== false) {
    return problem(409, 'Nothing to notify in writing');
  }
  const identified = view.timeline.filter((each) => each.kind === 'identified').at(-1);
  const now = new Date().toISOString();
  const badDay = (message: string) =>
    json(400, {
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      errors: [{ path: 'notifiedOn', message }],
    });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(notifiedOn)) return badDay('is not a date');
  if (notifiedOn > nairobiDay(now)) return badDay('is in the future');
  if (identified && notifiedOn < nairobiDay(identified.at)) {
    return badDay('is before the officer was identified');
  }
  const { notifiedAt, windowEndsAt } = writtenWindow(notifiedOn);
  const passed = Date.parse(windowEndsAt) <= Date.now();
  stored.view = {
    ...view,
    status: passed ? 'under-decision' : 'awaiting-representations',
    windowEndsAt,
    notice: { channel: 'written', notifiedAt, notifiedOn, recordedBy: caller.name },
    timeline: [...view.timeline, entry('notified', now, caller.name, view.reference, true)],
  };
  return json(200, stored.view);
}

/** `POST .../decision-written-notice`: as the access service rules (decision 2). */
async function decisionWrittenNotice(
  request: Request,
  stored: Stored,
  caller: Caller,
): Promise<Response> {
  const body = await readJson(request);
  const notifiedOn = isRecord(body) && typeof body.notifiedOn === 'string' ? body.notifiedOn : '';
  const { view } = stored;
  if (!view.decision) {
    return view.status === 'withdrawn' || view.status === 'cannot-identify'
      ? problem(409, 'The request is closed', 'request-closed')
      : problem(409, 'Not decided yet', 'not-under-decision');
  }
  if (view.decisionNotice) return problem(409, 'Told already', 'declarant-notified');
  if (view.declarantOnboarded !== false) return problem(409, 'The declarant is told online');
  const now = new Date().toISOString();
  const badDay = (message: string) =>
    json(400, {
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      errors: [{ path: 'notifiedOn', message }],
    });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(notifiedOn)) return badDay('is not a date');
  if (notifiedOn > nairobiDay(now)) return badDay('is in the future');
  if (notifiedOn < nairobiDay(view.decision.decidedAt)) return badDay('is before the decision');
  stored.view = {
    ...view,
    decisionNotice: {
      channel: 'written',
      notifiedAt: writtenWindow(notifiedOn).notifiedAt,
      notifiedOn,
      recordedBy: caller.name,
    },
    timeline: [
      ...view.timeline,
      entry('decision-notified', now, caller.name, view.reference, true),
    ],
  };
  return json(200, stored.view);
}

/** `PUT .../representations`: received in writing, entered by the access officer. */
async function enterRepresentations(
  request: Request,
  stored: Stored,
  caller: Caller,
): Promise<Response> {
  const body = await readJson(request);
  const { view } = stored;
  if (CLOSED.includes(view.status)) {
    return problem(
      409,
      'The request is closed',
      view.decision ? 'request-decided' : 'request-closed',
    );
  }
  if (view.notice?.channel !== 'written') {
    return problem(409, 'The declarant was notified online');
  }
  if (
    view.status !== 'awaiting-representations' ||
    !view.windowEndsAt ||
    Date.now() >= Date.parse(view.windowEndsAt)
  ) {
    return problem(409, 'The window is closed', 'representations-closed');
  }
  const stance = isRecord(body) ? body.stance : undefined;
  const text = isRecord(body) && typeof body.text === 'string' ? body.text.trim() : '';
  const ids = isRecord(body) && Array.isArray(body.attachments) ? body.attachments : [];
  if (stance !== 'object' && stance !== 'consent' && stance !== 'context') {
    return problem(400, 'A stance is required');
  }
  if (!text && stance !== 'consent') return problem(400, 'Text is required');
  if (text.includes('offline')) return problem(503, 'Service unavailable');
  const kept = view.representations?.attachments ?? [];
  const attachments = ids.map((uploadId) => {
    const id = String(uploadId);
    const known = kept.find((each) => each.uploadId === id);
    return { uploadId: id, fileName: known?.fileName ?? mockUploadOf(id)?.fileName ?? 'scan.pdf' };
  });
  const now = new Date().toISOString();
  stored.view = {
    ...view,
    status: stance === 'consent' ? 'under-decision' : view.status,
    representations: {
      stance,
      text,
      attachments,
      submittedAt: view.representations?.submittedAt ?? now,
      updatedAt: now,
      receivedInWriting: true,
      recordedBy: caller.name,
    },
    timeline: [...view.timeline, entry('representations', now, caller.name, view.reference, true)],
  };
  return json(200, stored.view);
}

async function verify(request: Request, stored: Stored, caller: Caller): Promise<Response> {
  const body = await readJson(request);
  const note = isRecord(body) && typeof body.note === 'string' ? body.note.trim() : '';
  if (!note || note.length > 1000)
    return problem(400, 'A note of 1 to 1,000 characters is required');
  const { view } = stored;
  if (view.status !== 'pending-applicant-verification') {
    return problem(409, 'Not pending verification', 'not-pending-verification');
  }
  const now = new Date().toISOString();
  stored.view = {
    ...view,
    status: 'submitted',
    applicantIdentityStatus: 'verified',
    timeline: [...view.timeline, entry('verified', now, caller.name, view.reference)],
  };
  return json(200, stored.view);
}

function badDecision(path: string, message: string, code?: string): Response {
  return json(400, {
    type: 'about:blank',
    title: 'Bad Request',
    status: 400,
    detail: `${path} ${message}`,
    ...(code ? { code } : {}),
    errors: [{ path, message }],
  });
}

type MockScope = OfficerRequestView['formK']['scope'];

const DECIDED_STATUS = {
  grant: 'granted',
  'partial-grant': 'partially-granted',
  deny: 'denied',
} as const;

/** As the access service's `decide`: status first, then `decisionOf`'s rules. */
async function decide(request: Request, stored: Stored, caller: Caller): Promise<Response> {
  const body = await readJson(request);
  if (!isRecord(body)) return problem(400, 'A decision is required');
  const outcome = body.outcome;
  const reasons = typeof body.reasons === 'string' ? body.reasons.trim() : '';
  const grounds = Array.isArray(body.grounds) ? (body.grounds as Ground[]) : [];
  const scope = isRecord(body.grantedScope) ? (body.grantedScope as unknown as MockScope) : null;
  if (outcome !== 'grant' && outcome !== 'partial-grant' && outcome !== 'deny') {
    return badDecision('outcome', 'must be grant, partial-grant or deny');
  }
  if (!reasons || reasons.length > 4000)
    return badDecision('reasons', 'must be 1 to 4000 characters');
  if (reasons.includes('offline')) return problem(503, 'Service unavailable');
  const { view } = stored;
  if (reasons.includes('raced') && view.status === 'under-decision') {
    const at = new Date().toISOString();
    stored.closedAt = at;
    stored.view = {
      ...view,
      status: 'denied',
      decision: {
        outcome: 'deny',
        grantedScope: null,
        grounds: ['not-objectives'],
        reasons: 'The reason given does not promote the objectives of the Act.',
        decidedBy: { subject: 'mock-other-officer', name: 'Peter Otieno' },
        decidedAt: at,
      },
      timeline: [...view.timeline, entry('decided', at, 'Peter Otieno', view.reference)],
    };
  }
  const current = stored.view;
  if (current.decision) {
    return problem(409, 'The request is decided, and a decision is final.', 'request-decided');
  }
  if (current.status === 'withdrawn' || current.status === 'cannot-identify') {
    return problem(409, 'The request is closed.', 'request-closed');
  }
  if (current.status !== 'under-decision') {
    return problem(409, 'The request is not under decision yet', 'not-under-decision');
  }
  if (reasons.includes('rejected')) {
    return badDecision(
      'grounds',
      'a denial must cite at least one Regulation 24 ground',
      'grounds-required',
    );
  }
  const requested = current.formK.scope;
  const exceeds = scope !== null && !isScopeWithin(scope, requested);
  const whole = scope !== null && !exceeds && isScopeWithin(requested, scope);
  if (exceeds) {
    return badDecision(
      'grantedScope',
      'grants more than the request asked for',
      'scope-exceeds-request',
    );
  }
  if (outcome === 'grant') {
    if (scope !== null && !whole)
      return badDecision(
        'grantedScope',
        'is narrower than the requested scope: decide a partial grant to narrow it',
      );
    if (grounds.length > 0) return badDecision('grounds', 'must be empty for a grant');
  }
  if (outcome === 'partial-grant') {
    if (scope === null) return badDecision('grantedScope', 'is required for a partial grant');
    if (whole)
      return badDecision('grantedScope', 'is the whole requested scope: decide a grant instead');
    if (grounds.length === 0)
      return badDecision(
        'grounds',
        'a partial grant must cite at least one Regulation 24 ground',
        'grounds-required',
      );
  }
  if (outcome === 'deny') {
    if (scope !== null) return badDecision('grantedScope', 'must be absent for a denial');
    if (grounds.length === 0)
      return badDecision(
        'grounds',
        'a denial must cite at least one Regulation 24 ground',
        'grounds-required',
      );
  }
  const at = new Date().toISOString();
  stored.closedAt = at;
  stored.issueAt = outcome === 'deny' ? null : Date.now() + ISSUE_AFTER_MS;
  stored.view = {
    ...current,
    status: DECIDED_STATUS[outcome],
    decision: {
      outcome,
      grantedScope: outcome === 'deny' ? null : outcome === 'grant' ? requested : scope,
      grounds,
      reasons,
      decidedBy: { subject: caller.subject, name: caller.name },
      decidedAt: at,
    },
    timeline: [...current.timeline, entry('decided', at, caller.name, current.reference)],
  };
  return json(200, stored.view);
}

/**
 * The scope preview (decision 1): of the requested scope (GET) or one within it (POST), once the
 * officer named is identified and until the decision, as the access service answers it.
 */
async function preview(request: Request, stored: Stored): Promise<Response> {
  const { view } = stored;
  if (view.decision) return problem(409, 'The request is decided', 'request-decided');
  if (view.status === 'withdrawn' || view.status === 'cannot-identify') {
    return problem(409, 'The request is closed', 'request-closed');
  }
  if (view.resolvedRosterRecordId === null) {
    return problem(409, 'The officer named is not identified yet', 'not-under-decision');
  }
  const requested = view.formK.scope;
  let scope = requested;
  if (request.method === 'POST') {
    const body = await readJson(request);
    if (!isRecord(body)) return problem(400, 'A scope is required');
    scope = body as unknown as typeof requested;
    if (!isScopeWithin(scope, requested)) {
      return problem(400, 'The scope asks for more than the request did', 'scope-exceeds-request');
    }
  }
  return json(200, mockScopePreview(view.resolvedRosterRecordId, scope));
}

export async function mockAccessFetch(request: Request): Promise<Response> {
  ensureSeeded();
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;
  const caller = callerOf(request);
  const now = Date.now();

  if (method === 'GET' && /^\/v1\/commissions\/[^/]+\/access\/requests$/.test(pathname)) {
    return queue(url);
  }
  // Written self-access applications (#304) have their own store.
  if (/\/self-access(\/|$)/.test(pathname)) return mockSelfAccessFetch(request);
  const lea = await mockLeaFetch(request);
  if (lea) return lea;

  const match = /^\/v1\/access\/requests\/([^/]+)\/(.+)$/.exec(pathname);
  const stored = match?.[1] ? requests.get(match[1]) : undefined;
  if (!match?.[2] || !stored) return problem(404, 'Not found');
  advance(stored, now);
  const action = match[2];

  if (method === 'GET' && action === 'officer') return json(200, stored.view);

  const attachment = /^representations\/attachments\/([^/]+)\/download$/.exec(action);
  if (method === 'GET' && attachment?.[1]) {
    const known = stored.view.representations?.attachments.some(
      (each) => each.uploadId === attachment[1],
    );
    if (!known) return problem(404, 'Not found');
    return json(200, {
      downloadUrl: `/api/mock-files/${attachment[1]}`,
      expiresAt: new Date(now + 5 * 60_000).toISOString(),
    });
  }

  if (action === 'preview' && (method === 'GET' || method === 'POST')) {
    await delay(350);
    return preview(request, stored);
  }

  if (!caller.accessOfficer) {
    return problem(403, 'The Commission supervisor reads requests; only its access officer acts');
  }

  if (method === 'GET' && action === 'roster-candidates') {
    const q = url.searchParams.get('q')?.trim().toLowerCase() ?? '';
    if (q.length < 2) return problem(400, 'A search of at least 2 characters is required');
    if (q === 'offline') return problem(503, 'The directory cannot be reached');
    await delay(250);
    return json(200, { items: searchMockRoster(q) });
  }
  if (method === 'POST' && action === 'resolve') {
    await delay(500);
    return resolve(request, stored, caller);
  }
  if (method === 'POST' && action === 'verify-applicant') {
    await delay(500);
    return verify(request, stored, caller);
  }
  if (method === 'POST' && action === 'decision') {
    await delay(700);
    return decide(request, stored, caller);
  }
  if (method === 'POST' && action === 'written-notice') {
    await delay(500);
    return writtenNotice(request, stored, caller);
  }
  if (method === 'POST' && action === 'decision-written-notice') {
    await delay(500);
    return decisionWrittenNotice(request, stored, caller);
  }
  if (method === 'PUT' && action === 'representations') {
    await delay(600);
    return enterRepresentations(request, stored, caller);
  }
  return problem(404, 'Not found');
}

/**
 * What the placeholder file route names: an attachment of the declarant's representations, or a
 * law enforcement package.
 */
export function mockAccessFileTitle(id: string): string | null {
  ensureSeeded();
  const lea = mockLeaFileTitle(id);
  if (lea) return lea;
  for (const stored of requests.values()) {
    const file = stored.view.representations?.attachments.find((each) => each.uploadId === id);
    if (file) return file.fileName;
  }
  return mockSelfAccessFileTitle(id);
}
