/**
 * In-memory stand-in for the access service's officer endpoints (access.yaml), used when
 * ACCESS_MOCK is set, for screens without the access service and its upstreams (directory,
 * documents, Temporal) running. One store for every caller, dated relative to when it was
 * seeded, holding the PSC's Form K requests in every state the queue and the request page show:
 *
 * - `verify`: a passport applicant's request, held for the access officer's check.
 * - `identify`: received today, Josephine Akinyi Ouma sought (search "Ouma").
 * - `unresolved`: officer-unresolved after its day-5 reminder, "Mrs Kamau" sought.
 * - `window`: the declarant notified two days ago; no representations yet.
 * - `objection`: under decision, the declarant objected with two attachments; due in 3 days.
 * - `consent`: the declarant consented, which closed the window early.
 * - `late`: under decision with context, 7 days past its decision deadline.
 * - `noReply`: under decision, the window closed without representations.
 * - `cannot`, `withdrawn`: closed; `granted`, `denied`: decided. Older decided requests fill a
 *   second page.
 *
 * Only the access officer acts (roster search, resolve, verify); a supervisor gets 403, as the
 * service answers. Resolving to a record leaves the request as it was until the workflow notifies
 * the declarant, two seconds later. Searching the queue for `slow` answers after four seconds
 * (the loading state); for `offline`, 503. Searching the roster for `offline` is 503 too.
 * Attachment links point at `/api/mock-files/{id}` (`routes/api/mock-files.$id.ts`).
 */
import { randomUUID } from 'node:crypto';

import { addDays } from '@adili/ui';
import createClient from 'openapi-fetch';

import { isRecord, json, problem, readJson } from '../mock-http';
import type { paths } from './api.gen';
import type {
  AccessRequestStatus,
  OfficerRequestView,
  QueueItem,
  RegisterEntry,
  RosterCandidate,
} from './types';

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
} as const;

export const MOCK_ROSTER_IDS = {
  josephine: 'a11d0000-0000-4000-8000-000000000001',
  peterOuma: 'a11d0000-0000-4000-8000-000000000002',
  josephineAdhiambo: 'a11d0000-0000-4000-8000-000000000003',
  grace: 'a11d0000-0000-4000-8000-000000000004',
  peterKamau: 'a11d0000-0000-4000-8000-000000000005',
  graceAtieno: 'a11d0000-0000-4000-8000-000000000006',
  esther: 'a11d0000-0000-4000-8000-000000000007',
  lilian: 'a11d0000-0000-4000-8000-000000000008',
} as const;

const PSC = { slug: 'psc', name: 'Public Service Commission' };
const DECLARATION =
  'I declare that the information I have given above is true, complete and correct to the best of my knowledge.';
const DECISION_DAYS = 30;
const WINDOW_DAYS = 7;
/** How long the mock's workflow takes to notify the declarant after a resolution. */
const NOTIFY_AFTER_MS = 2000;

const ROSTER: RosterCandidate[] = [
  candidate(
    MOCK_ROSTER_IDS.josephine,
    '20113458',
    'Josephine Akinyi Ouma',
    'Deputy Director, Contract Management',
    'State Department for Public Works',
  ),
  candidate(
    MOCK_ROSTER_IDS.peterOuma,
    '20071190',
    'Peter Omondi Ouma',
    'Deputy Director, Procurement',
    'Ministry of Health',
  ),
  candidate(
    MOCK_ROSTER_IDS.josephineAdhiambo,
    '20131175',
    'Josephine Adhiambo Ouma',
    'Housing Officer',
    'State Department for Housing and Urban Development',
    false,
  ),
  candidate(
    MOCK_ROSTER_IDS.grace,
    '20107725',
    'Grace Nyambura Kamau',
    'Principal Procurement Officer',
    'State Department for Housing and Urban Development',
  ),
  candidate(
    MOCK_ROSTER_IDS.peterKamau,
    '20096631',
    'Peter Mwangi Kamau',
    'Director, Housing Development',
    'State Department for Housing and Urban Development',
  ),
  candidate(
    MOCK_ROSTER_IDS.graceAtieno,
    'KRR/2011/0442',
    'Grace Atieno Odhiambo',
    'Deputy Director, Contracts',
    'Kenya Rural Roads Authority',
  ),
  candidate(
    MOCK_ROSTER_IDS.esther,
    '20099314',
    'Esther Wairimu Njoroge',
    'Assistant Director, ICT',
    'State Department for Public Service',
  ),
  candidate(
    MOCK_ROSTER_IDS.lilian,
    '20102284',
    'Lilian Wairimu Njoroge',
    'Senior Accountant',
    'The National Treasury',
  ),
];

function candidate(
  id: string,
  personnelFileNumber: string,
  fullName: string,
  designation: string,
  reportingEntity: string,
  onboarded = true,
): RosterCandidate {
  return {
    id,
    personnelFileNumber,
    fullName,
    designation,
    reportingEntity,
    state: onboarded ? 'onboarded' : 'not_onboarded',
    onboarded,
  };
}

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
  representations?: {
    stance: 'object' | 'consent' | 'context';
    text: string;
    attachments?: { uploadId: string; fileName: string }[];
    afterNotifiedDays: number;
    editedAfterDays?: number;
  };
  closedAfterDays?: number;
  decision?: { outcome: 'grant' | 'partial-grant' | 'deny'; afterDays: number; reasons: string };
}

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

function entry(
  kind: RegisterEntry['kind'],
  at: string,
  actor: string | null,
  reference: string,
): RegisterEntry {
  return { id: randomUUID(), kind, at, actor, summary: kind, reference };
}

const OFFICER_NAME = 'Lucy Wambui';

/** 09:10 in Nairobi on the seeding day, or the day before when that is still ahead. */
function morningOf(now: number): number {
  const today = Date.parse(
    `${new Date(now + 3 * 60 * 60 * 1000).toISOString().slice(0, 10)}T06:10:00Z`,
  );
  return today <= now ? today : today - 24 * 60 * 60 * 1000;
}

function build(seed: Seed, now: number): Stored {
  const submittedAt = iso(morningOf(now), -seed.receivedDaysAgo);
  const deadline = iso(Date.parse(submittedAt), DECISION_DAYS);
  const record = seed.resolved ? ROSTER.find((each) => each.id === seed.resolved) : undefined;
  const timeline: RegisterEntry[] = [
    entry('received', submittedAt, seed.applicant.name, seed.reference),
  ];
  const notifiedAt =
    seed.notifiedAfterDays === undefined
      ? null
      : hoursLater(iso(Date.parse(submittedAt), seed.notifiedAfterDays), 1);
  if (notifiedAt) timeline.push(entry('notified', notifiedAt, null, seed.reference));
  const windowEndsAt = notifiedAt ? iso(Date.parse(notifiedAt), WINDOW_DAYS) : null;
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
    representations = {
      stance: seed.representations.stance,
      text: seed.representations.text,
      attachments: seed.representations.attachments ?? [],
      submittedAt: submitted,
      updatedAt: updated,
    };
    timeline.push(entry('representations', submitted, record?.fullName ?? null, seed.reference));
    if (updated !== submitted) {
      timeline.push(entry('representations', updated, record?.fullName ?? null, seed.reference));
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
  if (seed.decision) {
    const decidedAt = hoursLater(iso(Date.parse(submittedAt), seed.decision.afterDays), 6);
    closedAt = decidedAt;
    decision = {
      outcome: seed.decision.outcome,
      grantedScope: null,
      grounds: seed.decision.outcome === 'deny' ? ['frivolous-vexatious'] : [],
      reasons: seed.decision.reasons,
      decidedBy: { subject: 'mock-access-officer', name: OFFICER_NAME },
      decidedAt,
    };
    timeline.push(entry('decided', decidedAt, OFFICER_NAME, seed.reference));
  }
  const partII: OfficerRequestView['formK']['partII'] = {
    name: seed.sought.name,
    entity: seed.sought.entity,
    workStation: seed.sought.workStation,
  };
  if (seed.sought.personnelFileNumber) partII.personnelFileNumber = seed.sought.personnelFileNumber;
  return {
    notifyAt: null,
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
      package: null,
      timeline,
      applicantIdentityStatus:
        seed.status === 'pending-applicant-verification' ? 'pending-verification' : 'verified',
      resolvedRosterRecordId: record?.id ?? null,
      resolvedName: record?.fullName ?? null,
      resolvedFileNumber: record?.personnelFileNumber ?? null,
      representations,
      windowEndsAt,
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
      name: 'Peter Mwangi Kamau',
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
    receivedDaysAgo: 40,
    status: 'granted',
    resolved: K.josephine,
    notifiedAfterDays: 1,
    decision: {
      outcome: 'grant',
      afterDays: 14,
      reasons: 'A legitimate interest in public procurement; the declarant consented.',
    },
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
    },
  },
];

/** Older decided requests, so the queue has a second page. */
function fillers(): Seed[] {
  const sought = ROSTER.filter((each) => each.onboarded);
  return Array.from({ length: 14 }, (_, index) => {
    const record = sought[index % sought.length] ?? ROSTER[0];
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
  requests.clear();
  for (const seed of [...SEEDS, ...fillers()]) requests.set(seed.id, build(seed, now));
}

function ensureSeeded() {
  if (requests.size === 0) resetAccessMock();
}

/** Runs the mock workflow: a resolution notifies the declarant once its time has come. */
function advance(stored: Stored, now: number) {
  if (stored.notifyAt === null || now < stored.notifyAt) return;
  const at = new Date(stored.notifyAt).toISOString();
  stored.notifyAt = null;
  stored.view = {
    ...stored.view,
    status: 'awaiting-representations',
    windowEndsAt: iso(Date.parse(at), WINDOW_DAYS),
    timeline: [...stored.view.timeline, entry('notified', at, null, stored.view.reference)],
  };
}

interface Caller {
  subject: string;
  name: string;
  accessOfficer: boolean;
}

function callerOf(request: Request): Caller {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  try {
    const claims = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as { sub?: unknown; name?: unknown; realm_access?: { roles?: unknown } };
    const roles = Array.isArray(claims.realm_access?.roles) ? claims.realm_access.roles : [];
    return {
      subject: typeof claims.sub === 'string' ? claims.sub : 'unknown',
      name: typeof claims.name === 'string' ? claims.name : 'You',
      accessOfficer: roles.includes('access-officer'),
    };
  } catch {
    return { subject: 'unknown', name: 'You', accessOfficer: true };
  }
}

const CLOSED: readonly AccessRequestStatus[] = [
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
}

const delay = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms * latency);
  });

/** A token the mock reads the caller from: subject, name and realm roles. */
function mockToken(subject: string, name: string, roles: readonly string[]): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: subject, name, realm_access: { roles } }),
  ).toString('base64url');
  return `mock.${payload}.signature`;
}

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
  const items = [...requests.values()]
    .map((stored) => {
      advance(stored, now);
      return queueItem(stored, now);
    })
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
  const record = ROSTER.find((each) => each.id === rosterRecordId);
  if (!record?.onboarded) {
    return json(400, {
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      errors: [{ path: 'rosterRecordId', message: 'is not an onboarded roster record' }],
    });
  }
  stored.notifyAt = Date.now() + NOTIFY_AFTER_MS;
  stored.view = {
    ...view,
    resolvedRosterRecordId: record.id,
    resolvedName: record.fullName,
    resolvedFileNumber: record.personnelFileNumber,
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

  if (!caller.accessOfficer) {
    return problem(403, 'The Commission supervisor reads requests; only its access officer acts');
  }

  if (method === 'GET' && action === 'roster-candidates') {
    const q = url.searchParams.get('q')?.trim().toLowerCase() ?? '';
    if (q.length < 2) return problem(400, 'A search of at least 2 characters is required');
    if (q === 'offline') return problem(503, 'The directory cannot be reached');
    await delay(250);
    const items = ROSTER.filter(
      (each) =>
        each.personnelFileNumber.toLowerCase().startsWith(q) ||
        each.fullName.toLowerCase().includes(q),
    )
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
      .slice(0, 20);
    return json(200, { items });
  }
  if (method === 'POST' && action === 'resolve') {
    await delay(500);
    return resolve(request, stored, caller);
  }
  if (method === 'POST' && action === 'verify-applicant') {
    await delay(500);
    return verify(request, stored, caller);
  }
  return problem(404, 'Not found');
}

/** What the placeholder file route names: an attachment of the declarant's representations. */
export function mockAccessFileTitle(id: string): string | null {
  ensureSeeded();
  for (const stored of requests.values()) {
    const file = stored.view.representations?.attachments.find((each) => each.uploadId === id);
    if (file) return file.fileName;
  }
  return null;
}
