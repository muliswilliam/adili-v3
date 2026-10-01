/**
 * A reference-number scheme from the numbering registry (ADR-011 §2):
 * `<CODE>[-<ISSUER>][-<PERIOD>]-<SEQUENCE>-<CHECK>`. Schemes are data; a service registers the
 * ones it issues by passing them to `parse` and `allocateReference`.
 *
 * Every scheme carries the glossary entry of its type code (ADR-011 §6), so a reference chip,
 * a document footer or the reference-data API can explain a number from this single source.
 */
export interface NumberingScheme {
  /** Record type code, three capital letters (`OFR`, `DCB`, `CLR`...). */
  readonly code: string;
  /** What the record is, e.g. `Biennial declaration`. */
  readonly name: string;
  /** One plain-language sentence or two on the record. */
  readonly description: string;
  /** Where the record comes from in law, e.g. `Act s.34(2)`, or `Adili Online`. */
  readonly legalBasis: string;
  /** Whether numbers carry the issuer's short code (`TSC`, `CPSB047`). */
  readonly issuer: boolean;
  /** Whether numbers carry a four-digit period (declaration year, financial year end...). */
  readonly period: boolean;
  /** What the period means for this scheme, e.g. `Declaration year`. Only with a period. */
  readonly periodName?: string;
  /** Zero-padded width of the sequence. */
  readonly sequenceDigits: number;
}

export function defineScheme(scheme: NumberingScheme): NumberingScheme {
  if (!/^[A-Z]{3}$/.test(scheme.code)) {
    throw new RangeError(`scheme code must be three capital letters: ${scheme.code}`);
  }
  if (!Number.isInteger(scheme.sequenceDigits) || scheme.sequenceDigits < 1) {
    throw new RangeError(`sequenceDigits must be a positive integer: ${scheme.sequenceDigits}`);
  }
  for (const field of ['name', 'description', 'legalBasis'] as const) {
    if (scheme[field].trim() === '') throw new RangeError(`${scheme.code} needs a ${field}`);
  }
  if (scheme.period !== (scheme.periodName !== undefined && scheme.periodName.trim() !== '')) {
    throw new RangeError(`${scheme.code} needs a periodName exactly when it has a period`);
  }
  return Object.freeze({ ...scheme });
}

/**
 * Officer reference: permanent and person-level, not tied to a tenant, so no issuer or period.
 * `OFR-0482913-L`.
 */
export const OFR = defineScheme({
  code: 'OFR',
  name: 'Officer reference',
  description:
    'A permanent number for each officer, used instead of the national ID when contacting the helpdesk.',
  legalBasis: 'Adili Online',
  issuer: false,
  period: false,
  sequenceDigits: 7,
});

/**
 * The sentence every declaration scheme's glossary entry ends with (docs/glossary.md, ADR-011):
 * the acknowledgement slip carries the same number, so there is no separate receipt number.
 */
const SAME_NUMBER_ON_SLIP = 'The number is also the acknowledgement receipt number.';

/**
 * Declarations: issuer is the responsible Commission's tenant key upper-cased (`issuerCode`),
 * period the declaration year. Allocated at submission (ADR-011 §3). `DCI-PSC-2027-0000001-Z`.
 */
export const DCI = defineScheme({
  code: 'DCI',
  name: 'Initial declaration',
  description: `Declaration made within 30 days of appointment, covering the year before appointment. ${SAME_NUMBER_ON_SLIP}`,
  legalBasis: 'Act s.34(1)',
  issuer: true,
  period: true,
  periodName: 'Declaration year',
  sequenceDigits: 7,
});

/** `DCB-TSC-2027-0012345-A`. */
export const DCB = defineScheme({
  code: 'DCB',
  name: 'Biennial declaration',
  description: `Declaration made every two years, with a statement date of 1 November and filed by 31 December. ${SAME_NUMBER_ON_SLIP}`,
  legalBasis: 'Act s.34(2)',
  issuer: true,
  period: true,
  periodName: 'Declaration year',
  sequenceDigits: 7,
});

/** `DCF-JSC-2028-0000042-4`. */
export const DCF = defineScheme({
  code: 'DCF',
  name: 'Final declaration',
  description: `Declaration made within 30 days of leaving public office. ${SAME_NUMBER_ON_SLIP}`,
  legalBasis: 'Act s.34(3)',
  issuer: true,
  period: true,
  periodName: 'Declaration year',
  sequenceDigits: 7,
});

/**
 * Clarification request (Act s.35): issued by the Responsible Commission, numbered per Commission
 * and calendar year of issue. `CLR-PSC-2028-0000451-3`.
 */
export const CLR = defineScheme({
  code: 'CLR',
  name: 'Clarification request',
  description:
    "A Commission's written request for missing information or an explanation of an inconsistency. The declarant must reply within 30 days.",
  legalBasis: 'Act s.35',
  issuer: true,
  period: true,
  periodName: 'Year of issue',
  sequenceDigits: 7,
});

/**
 * Compliance determination (spec 08): numbered by the Responsible Commission when a supervisor
 * approves it, per Commission and calendar year of approval. `CMP-PSC-2027-0000001-7`.
 */
export const CMP = defineScheme({
  code: 'CMP',
  name: 'Compliance determination',
  description:
    "The Commission's decision on whether a declaration is compliant, non-compliant or needs further action.",
  legalBasis: 'Act s.35; Regs r.20',
  issuer: true,
  period: true,
  periodName: 'Year of approval',
  sequenceDigits: 7,
});

/**
 * Administrative action (spec 08, the enforcement ladder): a notice to comply, warning, salary
 * stoppage or disciplinary referral, numbered by the Responsible Commission when an officer
 * approves it, per Commission and calendar year of approval. `ADM-PSC-2027-0000001-4`.
 */
export const ADM = defineScheme({
  code: 'ADM',
  name: 'Administrative action',
  description:
    'Action for non-compliance: notice to comply, warning, salary stoppage pending compliance, disciplinary proceedings.',
  legalBasis: 'Admin Mechanisms (2026)',
  issuer: true,
  period: true,
  periodName: 'Year of approval',
  sequenceDigits: 7,
});

/**
 * Referral to EACC (spec 08, Regs r.20): numbered by the Responsible Commission when a supervisor
 * approves it, per Commission and calendar year of approval. `RFL-PSC-2027-0000001-7`.
 */
export const RFL = defineScheme({
  code: 'RFL',
  name: 'Referral',
  description:
    'A matter sent to EACC for investigation, e.g. undeclared or unexplained assets, or two missed cycles.',
  legalBasis: 'Regs r.20(1)(c), r.20(2)',
  issuer: true,
  period: true,
  periodName: 'Year of approval',
  sequenceDigits: 7,
});

/**
 * The kinds of declaration the Act requires (s.34): the one vocabulary for declaration and
 * obligation types across services, events, templates and front ends.
 */
export const DECLARATION_TYPES = ['initial', 'biennial', 'final'] as const;

export type DeclarationType = (typeof DECLARATION_TYPES)[number];

/** The scheme a declaration of each type is numbered in. */
export const declarationSchemes: Readonly<Record<DeclarationType, NumberingScheme>> = Object.freeze(
  { initial: DCI, biennial: DCB, final: DCF },
);

/** Schemes this package knows; later slices add theirs (ARQ...) the same way. */
export const numberingSchemes: readonly NumberingScheme[] = Object.freeze([
  OFR,
  DCI,
  DCB,
  DCF,
  CLR,
  CMP,
  ADM,
  RFL,
]);

/** The registered scheme with `code`, if any. */
export function findScheme(
  code: string,
  schemes: readonly NumberingScheme[] = numberingSchemes,
): NumberingScheme | undefined {
  return schemes.find((scheme) => scheme.code === code);
}
