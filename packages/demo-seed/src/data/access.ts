import { CURRENT_CYCLE } from './personas.js';

/**
 * The access requests the demo shows (#620, spec 10), each told apart from the others by its
 * `marker`: a phrase in the reason the applicant (or the agency) gives, which the seed looks for
 * before filing again.
 */

/** Where a Form K request is taken to. */
export type FormKOutcome =
  /** Resolved and the declarant notified: their window for representations is open. */
  | 'awaiting-representations'
  /** The declarant consented; granted, the watermarked, signed access package issued. */
  | 'granted'
  /** The declarant consented; denied on a Regulation 24 ground, with reasons. */
  | 'denied';

export interface FormKPlan {
  marker: string;
  commission: string;
  /** The declarant the request is about: a persona's or a synthetic officer's `demo_key`. */
  declarantKey: string;
  /** Their national ID, to find their roster row (`fixtureRoster`). */
  nationalId: string;
  occupation: string;
  informationSought: string;
  reason: string;
  outcome: FormKOutcome;
  /** The declarant's representations when they consent. */
  consent?: string;
  /** The access officer's decision, for `granted` and `denied`. */
  decision?: {
    grounds: (
      'public-interest' | 'prejudice-proceeding' | 'frivolous-vexatious' | 'not-objectives'
    )[];
    reasons: string;
  };
}

const SCOPE = {
  years: [CURRENT_CYCLE],
  includeSpouses: false,
  includeChildren: false,
  sections: ['income', 'assets', 'liabilities'] as ('income' | 'assets' | 'liabilities')[],
  includeClarifications: false,
};

export const FORM_K_SCOPE = SCOPE;

/** PSC's Form K requests, filed by the `applicant` demo account (Njoki Wambua, a journalist). */
export const PSC_FORM_K: readonly FormKPlan[] = [
  {
    marker: 'agrovet input subsidies',
    commission: 'psc',
    declarantKey: 'kiprono',
    nationalId: '22607781',
    occupation: 'Investigative journalist',
    informationSought: `The officer's declared income, assets and liabilities for ${String(CURRENT_CYCLE)}.`,
    reason:
      'Reporting on agrovet input subsidies in the Rift Valley, where suppliers linked to public officers have been named.',
    outcome: 'awaiting-representations',
  },
  {
    marker: 'county health facility upgrades',
    commission: 'psc',
    declarantKey: 'otieno',
    nationalId: '30194427',
    occupation: 'Investigative journalist',
    informationSought: `The officer's declared income, assets and liabilities for ${String(CURRENT_CYCLE)}.`,
    reason:
      'Reporting on procurement for county health facility upgrades, for a public interest story on how officers declare their interests.',
    outcome: 'granted',
    consent: 'I have nothing to hide and consent to the disclosure.',
    decision: {
      grounds: [],
      reasons:
        'The applicant is an accredited journalist with a stated public interest purpose, and the declarant consented. Granted for the requested scope.',
    },
  },
  {
    marker: 'pending disciplinary matter',
    commission: 'psc',
    declarantKey: 'amina',
    nationalId: '31552094',
    occupation: 'Investigative journalist',
    informationSought: `The officer's declared assets for ${String(CURRENT_CYCLE)}.`,
    reason:
      'Following up a pending disciplinary matter involving the officer, reported by a source in the department.',
    outcome: 'denied',
    consent: 'I consent, although the matter the applicant describes is before the Commission.',
    decision: {
      grounds: ['prejudice-proceeding'],
      reasons:
        'The matter the applicant describes is before the Commission in disciplinary proceedings. Disclosing the declaration now would prejudice those proceedings (Regulation 24). The applicant may apply again once they conclude.',
    },
  },
];

/**
 * The law enforcement request: DCI asks for Kiprono's declaration in a tax investigation. Kiprono
 * never sees it (product decision, 2026-10-05; #614).
 */
export const LEA_REQUEST = {
  marker: 'DCI/ECU/2026/0417',
  commission: 'psc',
  declarantKey: 'kiprono',
  nationalId: '22607781',
  reason:
    'Investigation into tax evasion and undeclared income from agricultural supply contracts. The declaration is needed to compare declared income with KRA returns.',
  caseReference: 'DCI/ECU/2026/0417',
  scope: SCOPE,
  verifyNote:
    'Request received from the DCI account on the platform; case reference and reason stated. Officer identified on the PSC roster.',
  decision: {
    reasons:
      'A law enforcement request with a stated case and reason (Regulation 23). Granted for the requested scope; the declarant is told.',
  },
} as const;

/**
 * The JSC grant whose package the verify app shows as expired: JSC runs the demo's short package
 * validity (`DEMO_WINDOW_TENANTS=jsc`), PSC its legal download window.
 */
export const EXPIRED_PACKAGE_MARKER = 'judicial training budgets';
