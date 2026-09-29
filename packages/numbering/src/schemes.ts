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
 * Compliance report (Form M, Regs r.25(2)): numbered when the Responsible Commission submits it
 * to EACC, per Commission and financial year (its start year). `RPT-PSC-2027-0000001-4`.
 */
export const RPT = defineScheme({ code: 'RPT', issuer: true, period: true, sequenceDigits: 7 });

/**
 * National consolidated report (spec 09): numbered when an EACC supervisor approves it, per
 * financial year (its start year), issued by EACC. `NCR-EACC-2027-0000001-Q`.
 */
export const NCR = defineScheme({ code: 'NCR', issuer: true, period: true, sequenceDigits: 7 });

/** Schemes this package knows; later slices add theirs (DCB, CLR...) the same way. */
export const numberingSchemes: readonly NumberingScheme[] = [OFR, RPT, NCR];
