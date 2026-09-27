/**
 * Fixtures for the fake directory (MSW handlers in `./handlers.ts`): the prototype's Commissions
 * and the statutory officer categories. Dev and test only; never imported by the server bundle.
 */
import type {
  Commission,
  OfficerCategory,
  ReportingOfficer,
  RosterSummary,
} from '../../server/directory/types';

export const OFFICER_CATEGORIES: OfficerCategory[] = [
  {
    code: 'act-s32-2',
    citation: 'Act s.32(2)',
    description:
      'Cabinet, MPs, DPP, Secretary to the Cabinet, JSC members, Chapter Fifteen commissioners, senior EACC staff',
  },
  { code: 'act-s32-3', citation: 'Act s.32(3)', description: 'Senators' },
  {
    code: 'act-s32-4',
    citation: 'Act s.32(4)',
    description: 'County executive committees, MCAs and County Public Service Board members',
  },
  {
    code: 'act-s32-5',
    citation: 'Act s.32(5)',
    description:
      'Principal secretaries, envoys, officers under PSC control and state corporation staff',
  },
  {
    code: 'act-s32-6',
    citation: 'Act s.32(6)',
    description: 'Officers under a County Public Service Board and county corporation staff',
  },
  {
    code: 'act-s32-7',
    citation: 'Act s.32(7)',
    description: 'Judges, magistrates and officers under JSC disciplinary control',
  },
  {
    code: 'act-s32-8',
    citation: 'Act s.32(8)',
    description: 'Officers under Parliamentary Service Commission disciplinary control',
  },
  {
    code: 'act-s32-9',
    citation: 'Act s.32(9)',
    description: 'Officers under a County Assembly Service Board',
  },
  { code: 'act-s32-10', citation: 'Act s.32(10)', description: 'Registered teachers' },
  {
    code: 'act-s32-11',
    citation: 'Act s.32(11)',
    description: 'Members of the Kenya Defence Forces',
  },
  {
    code: 'act-s32-12',
    citation: 'Act s.32(12)',
    description: 'Members of the National Intelligence Service',
  },
  {
    code: 'act-s32-13',
    citation: 'Act s.32(13)',
    description: 'Members of the National Police Service',
  },
  {
    code: 'act-s32-14',
    citation: 'Act s.32(14)',
    description: 'Members of the Witness Protection Agency',
  },
  {
    code: 'regs-r5-a',
    citation: 'Regs r.5(a)',
    description: 'EACC staff below the rank of Deputy Director',
  },
  {
    code: 'regs-r5-b',
    citation: 'Regs r.5(b)',
    description: 'Officers and employees of public universities',
  },
  {
    code: 'regs-r5-c',
    citation: 'Regs r.5(c)',
    description: 'Central Bank staff and state-corporation banks',
  },
  {
    code: 'regs-r5-d',
    citation: 'Regs r.5(d)',
    description: 'Employees of Article 248(2) constitutional commissions',
  },
  {
    code: 'regs-r5-e',
    citation: 'Regs r.5(e)',
    description: 'Employees of the ODPP, Controller of Budget and Auditor General',
  },
  {
    code: 'regs-r5-f',
    citation: 'Regs r.5(f)',
    description: 'Officers of reporting entities not otherwise assigned',
  },
];

function categories(...codes: OfficerCategory['code'][]): OfficerCategory[] {
  return OFFICER_CATEGORIES.filter((category) => codes.includes(category.code));
}

/** Times are Kenyan local time, as in the prototype. */
const eat = (local: string) => `${local}+03:00`;

function officer(
  name: string,
  email: string,
  phone: string,
  invitedAt: string,
  activatedAt: string | null = null,
): ReportingOfficer {
  return {
    id: crypto.randomUUID(),
    name,
    email,
    phone,
    state: activatedAt ? 'activated' : 'invited',
    invitedAt: eat(invitedAt),
    activatedAt: activatedAt ? eat(activatedAt) : null,
  };
}

/** Slice 01 has no rosters yet: every Commission reads "No roster yet" until slice 02. */
const NO_ROSTER: RosterSummary = {
  status: 'none',
  expectedDeclarants: 0,
  onboardedDeclarants: 0,
  flagged: 0,
  lastImportAt: null,
  lastImportId: null,
};

function commission(
  slug: string,
  name: string,
  type: Commission['type'],
  categoryCodes: OfficerCategory['code'][],
  createdAt: string,
  reportingOfficer: ReportingOfficer | null,
): Commission {
  return {
    id: crypto.randomUUID(),
    slug,
    issuerCode: slug.toUpperCase(),
    name,
    type,
    categories: categories(...categoryCodes),
    status: 'active',
    policyVersion: 1,
    reportingOfficer,
    roster: NO_ROSTER,
    createdAt: eat(createdAt),
  };
}

/** The prototype's Commissions, ordered by name as the directory returns them. */
export const MOCK_COMMISSIONS: Commission[] = [
  commission(
    'cbk',
    'Central Bank of Kenya Board of Directors',
    'federated',
    ['regs-r5-c'],
    '2026-08-20T09:30:00',
    officer(
      'Lucy Njeri',
      'l.njeri@centralbank.go.ke',
      '+254722007731',
      '2026-08-20T09:48:00',
      '2026-08-21T10:31:00',
    ),
  ),
  commission(
    'cue',
    'Commission for University Education',
    'federated',
    ['regs-r5-b'],
    '2026-08-27T13:00:00',
    officer('Dr. Paul Odhiambo', 'p.odhiambo@cue.or.ke', '+254735114209', '2026-08-27T13:15:00'),
  ),
  commission(
    'caj',
    'Commission on Administrative Justice',
    'hosted',
    ['regs-r5-d'],
    '2026-08-25T16:00:00',
    officer(
      'Ann Kerubo',
      'a.kerubo@ombudsman.go.ke',
      '+254710448290',
      '2026-08-25T16:10:00',
      '2026-08-26T08:30:00',
    ),
  ),
  commission('kdf', 'Defence Council', 'federated', ['act-s32-11'], '2026-09-10T08:20:00', null),
  commission(
    'eacc',
    'Ethics and Anti-Corruption Commission',
    'hosted',
    ['act-s32-2', 'regs-r5-a'],
    '2026-08-03T09:16:00',
    officer(
      'Kevin Mutua',
      'k.mutua@eacc.go.ke',
      '+254733902114',
      '2026-08-03T10:02:00',
      '2026-08-03T15:47:00',
    ),
  ),
  commission(
    'jsc',
    'Judicial Service Commission',
    'hosted',
    ['act-s32-7'],
    '2026-09-18T11:30:00',
    officer('Peter Wekesa', 'peter.wekesa@jsc.go.ke', '+254711508226', '2026-09-24T16:22:00'),
  ),
  commission(
    'cpsb042',
    'Kisumu County Public Service Board',
    'hosted',
    ['act-s32-6'],
    '2026-09-22T10:12:00',
    null,
  ),
  commission(
    'cpsb001',
    'Mombasa County Public Service Board',
    'hosted',
    ['act-s32-6'],
    '2026-09-21T12:40:00',
    null,
  ),
  commission(
    'casb047',
    'Nairobi City County Assembly Service Board',
    'hosted',
    ['act-s32-9', 'act-s32-4'],
    '2026-09-15T15:25:00',
    officer('Halima Abdi', 'h.abdi@nairobiassembly.go.ke', '+254724901356', '2026-09-25T09:10:00'),
  ),
  commission(
    'cpsb047',
    'Nairobi City County Public Service Board',
    'hosted',
    ['act-s32-6'],
    '2026-09-08T09:00:00',
    officer('Joseph Kamau', 'joseph.kamau@nairobi.go.ke', '+254701223914', '2026-09-19T08:45:00'),
  ),
  commission(
    'nassembly',
    'National Assembly Committee on Ethics',
    'hosted',
    ['act-s32-2'],
    '2026-09-04T11:00:00',
    officer(
      'Collins Barasa',
      'c.barasa@parliament.go.ke',
      '+254718220463',
      '2026-09-04T11:15:00',
      '2026-09-07T10:04:00',
    ),
  ),
  commission(
    'nis',
    'National Intelligence Service Council',
    'federated',
    ['act-s32-12'],
    '2026-09-10T08:25:00',
    null,
  ),
  commission(
    'npsc',
    'National Police Service Commission',
    'hosted',
    ['act-s32-13'],
    '2026-08-12T10:05:00',
    officer(
      'Mary Chebet',
      'mary.chebet@npsc.go.ke',
      '+254720334871',
      '2026-08-12T10:20:00',
      '2026-08-13T07:58:00',
    ),
  ),
  commission(
    'parlsc',
    'Parliamentary Service Commission',
    'federated',
    ['act-s32-8'],
    '2026-08-01T14:10:00',
    officer(
      'Esther Wambui',
      'e.wambui@parliament.go.ke',
      '+254712660415',
      '2026-08-01T14:30:00',
      '2026-08-03T09:02:00',
    ),
  ),
  commission(
    'psc',
    'Public Service Commission',
    'hosted',
    ['act-s32-5', 'regs-r5-e', 'regs-r5-f'],
    '2026-08-03T09:14:00',
    officer(
      'Grace Muthoni',
      'grace.muthoni@publicservice.go.ke',
      '+254722418305',
      '2026-08-03T09:40:00',
      '2026-08-04T08:12:00',
    ),
  ),
  commission(
    'senate',
    'Senate Committee on Ethics',
    'hosted',
    ['act-s32-3'],
    '2026-09-04T11:05:00',
    null,
  ),
  commission(
    'tsc',
    'Teachers Service Commission',
    'hosted',
    ['act-s32-10'],
    '2026-08-05T10:00:00',
    officer(
      'Nancy Macharia',
      'n.macharia@tsc.go.ke',
      '+254722555010',
      '2026-08-05T10:20:00',
      '2026-08-06T09:15:00',
    ),
  ),
  commission(
    'wpab',
    'Witness Protection Advisory Board',
    'hosted',
    ['act-s32-14'],
    '2026-09-23T09:50:00',
    null,
  ),
];
