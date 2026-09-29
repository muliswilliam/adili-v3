/**
 * A reference-number scheme from the numbering registry (ADR-011 §2):
 * `<CODE>[-<ISSUER>][-<PERIOD>]-<SEQUENCE>-<CHECK>`. Schemes are data; a service registers the
 * ones it issues by passing them to `parse` and `allocateReference`.
 */
export interface NumberingScheme {
  /** Record type code, three capital letters (`OFR`, `DCB`, `CLR`...). */
  readonly code: string;
  /** Whether numbers carry the issuer's short code (`TSC`, `CPSB047`). */
  readonly issuer: boolean;
  /** Whether numbers carry a four-digit period (declaration year, financial year end...). */
  readonly period: boolean;
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
  return Object.freeze({ ...scheme });
}

/**
 * Officer reference: permanent and person-level, not tied to a tenant, so no issuer or period.
 * `OFR-0482913-L`.
 */
export const OFR = defineScheme({ code: 'OFR', issuer: false, period: false, sequenceDigits: 7 });

/**
 * Clarification request (Act s.35): issued by the Responsible Commission, numbered per Commission
 * and calendar year of issue. `CLR-PSC-2028-0000451-3`.
 */
export const CLR = defineScheme({ code: 'CLR', issuer: true, period: true, sequenceDigits: 7 });

/**
 * Compliance determination (spec 08): numbered by the Responsible Commission when a supervisor
 * approves it, per Commission and calendar year of approval. `CMP-PSC-2027-0000001-7`.
 */
export const CMP = defineScheme({ code: 'CMP', issuer: true, period: true, sequenceDigits: 7 });

/**
 * Administrative action (spec 08, the enforcement ladder): a notice to comply, warning, salary
 * stoppage or disciplinary referral, numbered by the Responsible Commission when an officer
 * approves it, per Commission and calendar year of approval. `ADM-PSC-2027-0000001-4`.
 */
export const ADM = defineScheme({ code: 'ADM', issuer: true, period: true, sequenceDigits: 7 });

/** Schemes this package knows; later slices add theirs (DCB, RFL...) the same way. */
export const numberingSchemes: readonly NumberingScheme[] = [OFR, CLR, CMP, ADM];
