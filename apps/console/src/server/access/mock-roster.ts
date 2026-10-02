/**
 * The PSC roster the access mocks search (Form K and law enforcement requests alike), by name or
 * personnel file number as the access service does: names "Ouma" and "Kamau" have several
 * records, one of them not onboarded; Samuel Kiprotich Rotich and Beatrice Achieng Otieno have
 * not onboarded either (requests resolved to them are served in writing).
 */
import type { RosterCandidate } from './types';

export const MOCK_ROSTER_IDS = {
  josephine: 'a11d0000-0000-4000-8000-000000000001',
  peterOuma: 'a11d0000-0000-4000-8000-000000000002',
  josephineAdhiambo: 'a11d0000-0000-4000-8000-000000000003',
  grace: 'a11d0000-0000-4000-8000-000000000004',
  peterKamau: 'a11d0000-0000-4000-8000-000000000005',
  graceAtieno: 'a11d0000-0000-4000-8000-000000000006',
  esther: 'a11d0000-0000-4000-8000-000000000007',
  lilian: 'a11d0000-0000-4000-8000-000000000008',
  samuel: 'a11d0000-0000-4000-8000-000000000009',
  beatrice: 'a11d0000-0000-4000-8000-000000000010',
} as const;

/** The PSC's roster records the access officer finds when identifying an officer. */
export const MOCK_ROSTER: RosterCandidate[] = [
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
  candidate(
    MOCK_ROSTER_IDS.samuel,
    '20118802',
    'Samuel Kiprotich Rotich',
    'Assistant Director, Land Valuation',
    'Ministry of Lands and Physical Planning',
    false,
  ),
  candidate(
    MOCK_ROSTER_IDS.beatrice,
    '20125517',
    'Beatrice Achieng Otieno',
    'Senior Procurement Officer',
    'State Department for Public Works',
    false,
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

/** The records matching `q` (a file number's beginning or part of a name), by full name. */
export function searchMockRoster(q: string): RosterCandidate[] {
  const text = q.trim().toLowerCase();
  return MOCK_ROSTER.filter(
    (each) =>
      each.personnelFileNumber.toLowerCase().startsWith(text) ||
      each.fullName.toLowerCase().includes(text),
  )
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
    .slice(0, 20);
}
