import { checkCharacter, hasValidCheckCharacter } from './check-character.js';
import { ARQ, findScheme, LEA, type NumberingScheme, numberingSchemes } from './schemes.js';

export interface ReferenceParts {
  issuer?: string;
  period?: number;
  sequence: number;
}

export interface ParsedReference extends ReferenceParts {
  /** Scheme code, e.g. `OFR`. */
  scheme: string;
  checkCharacter: string;
}

export type InvalidReferenceReason = 'malformed' | 'unknown-scheme' | 'bad-check-character';

/** A string that is not a valid reference number of a known scheme. */
export class InvalidReferenceError extends Error {
  override readonly name = 'InvalidReferenceError';

  constructor(
    readonly reason: InvalidReferenceReason,
    readonly reference: string,
  ) {
    super(`Invalid reference (${reason}): ${reference}`);
  }
}

/** A tenant key upper-cased: the issuer is always the issuing tenant (ADR-011 §2). */
const ISSUER = /^[A-Z][A-Z0-9]{1,19}$/;
/**
 * A tenant key, as `TENANT_KEY` in `@adili/api-kit` defines it. Repeated, not imported: this
 * package is a leaf that the browser bundles (packages/ui, the portal, the verify app) import,
 * and api-kit's entry point pulls in Nest. `reference.test.ts` keeps the two in step.
 */
export const TENANT_KEY = /^[a-z][a-z0-9]{1,19}$/;
const PERIOD = /^\d{4}$/;

/** The issuer code of a tenant: its key upper-cased (`tsc` to `TSC`, `cpsb047` to `CPSB047`). */
export function issuerCode(tenantKey: string): string {
  if (!TENANT_KEY.test(tenantKey)) throw new RangeError(`invalid tenant key: ${tenantKey}`);
  return tenantKey.toUpperCase();
}

/** Formats a reference number and appends its check character. */
export function format(scheme: NumberingScheme, parts: ReferenceParts): string {
  if (!isSequence(parts.sequence, scheme)) {
    throw new RangeError(`sequence out of range for ${scheme.code}: ${parts.sequence}`);
  }
  const sequence = String(parts.sequence).padStart(scheme.sequenceDigits, '0');
  const body = [scheme.code, ...keySegments(scheme, parts), sequence].join('-');
  return `${body}-${checkCharacter(body)}`;
}

/**
 * The issuer and period segments of `scheme`, validated: a `TypeError` when a part the scheme
 * needs is missing or one it does not take is given, a `RangeError` when a part is malformed.
 */
export function keySegments(
  scheme: NumberingScheme,
  key: Pick<ReferenceParts, 'issuer' | 'period'>,
): string[] {
  const segments: string[] = [];
  if (scheme.issuer) {
    if (key.issuer === undefined) throw new TypeError(`${scheme.code} numbers need an issuer`);
    if (!ISSUER.test(key.issuer)) throw new RangeError(`invalid issuer: ${key.issuer}`);
    segments.push(key.issuer);
  } else if (key.issuer !== undefined) {
    throw new TypeError(`${scheme.code} numbers have no issuer`);
  }
  if (scheme.period) {
    if (key.period === undefined) throw new TypeError(`${scheme.code} numbers need a period`);
    if (!PERIOD.test(String(key.period))) throw new RangeError(`invalid period: ${key.period}`);
    segments.push(String(key.period));
  } else if (key.period !== undefined) {
    throw new TypeError(`${scheme.code} numbers have no period`);
  }
  return segments;
}

/**
 * Splits a reference number into its parts, verifying the shape against its scheme and the
 * check character. Throws `InvalidReferenceError`.
 */
export function parse(
  reference: string,
  schemes: readonly NumberingScheme[] = numberingSchemes,
): ParsedReference {
  const segments = reference.split('-');
  const code = segments[0] ?? '';
  if (!/^[A-Z]{3}$/.test(code)) throw new InvalidReferenceError('malformed', reference);
  const scheme = findScheme(code, schemes);
  if (!scheme) throw new InvalidReferenceError('unknown-scheme', reference);

  const expected = 3 + Number(scheme.issuer) + Number(scheme.period);
  if (segments.length !== expected) throw new InvalidReferenceError('malformed', reference);
  const rest = segments.slice(1);
  const issuer = scheme.issuer ? rest.shift() : undefined;
  const period = scheme.period ? rest.shift() : undefined;
  const [sequence, check] = rest as [string, string];
  const sequenceShape = new RegExp(`^\\d{${scheme.sequenceDigits}}$`);
  if (
    (issuer !== undefined && !ISSUER.test(issuer)) ||
    (period !== undefined && !PERIOD.test(period)) ||
    !sequenceShape.test(sequence) ||
    !isSequence(Number(sequence), scheme) ||
    !/^[0-9A-Z]$/.test(check)
  ) {
    throw new InvalidReferenceError('malformed', reference);
  }
  if (!hasValidCheckCharacter(reference)) {
    throw new InvalidReferenceError('bad-check-character', reference);
  }
  return {
    scheme: scheme.code,
    issuer,
    period: period === undefined ? undefined : Number(period),
    sequence: Number(sequence),
    checkCharacter: check,
  };
}

function isSequence(value: number, scheme: NumberingScheme): boolean {
  return Number.isInteger(value) && value >= 1 && value < 10 ** scheme.sequenceDigits;
}

/**
 * ADR-011: the shape of an access grant's reference, a Form K request's (`ARQ`) or a
 * law-enforcement request's (`LEA`), e.g. `ARQ-PSC-2028-0000012-N`: the pattern contracts
 * publish. `isGrantReference` also verifies the check character.
 */
export const GRANT_REFERENCE_PATTERN = /^(ARQ|LEA)-[A-Z][A-Z0-9]{1,19}-[0-9]{4}-[0-9]{7}-[0-9A-Z]$/;

/** The schemes an access grant is numbered in: Form K (`ARQ`) and law enforcement (`LEA`). */
export const GRANT_SCHEMES: readonly NumberingScheme[] = [ARQ, LEA];

/**
 * Whether `reference` is a valid access grant reference: an `ARQ` or `LEA` number of the right
 * shape whose check character verifies.
 */
export function isGrantReference(reference: string): boolean {
  try {
    parse(reference, GRANT_SCHEMES);
    return true;
  } catch (error) {
    if (error instanceof InvalidReferenceError) return false;
    throw error;
  }
}
