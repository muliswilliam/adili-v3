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

const RECEIPT = 'The number is also the acknowledgement receipt number.';

/**
 * Declarations: issuer is the responsible Commission's tenant key upper-cased (`issuerCode`),
 * period the declaration year. Allocated at submission (ADR-011 §3). `DCI-PSC-2027-0000001-Z`.
 */
export const DCI = defineScheme({
  code: 'DCI',
  name: 'Initial declaration',
  description: `Declaration made within 30 days of appointment, covering the year before appointment. ${RECEIPT}`,
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
  description: `Declaration made every two years, with a statement date of 1 November and filed by 31 December. ${RECEIPT}`,
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
  description: `Declaration made within 30 days of leaving public office. ${RECEIPT}`,
  legalBasis: 'Act s.34(3)',
  issuer: true,
  period: true,
  periodName: 'Declaration year',
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

/** Schemes this package knows; later slices add theirs (CLR, CMP...) the same way. */
export const numberingSchemes: readonly NumberingScheme[] = Object.freeze([OFR, DCI, DCB, DCF]);

/** The registered scheme with `code`, if any. */
export function findScheme(
  code: string,
  schemes: readonly NumberingScheme[] = numberingSchemes,
): NumberingScheme | undefined {
  return schemes.find((scheme) => scheme.code === code);
}
