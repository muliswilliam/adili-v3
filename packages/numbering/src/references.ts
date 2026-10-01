/**
 * Formatting, parsing and the scheme registry without the database: safe for browser bundles
 * (the portal's reference chip) and anything else that never allocates.
 */
export { ALPHABET, checkCharacter, hasValidCheckCharacter } from './check-character.js';
export {
  format,
  InvalidReferenceError,
  type InvalidReferenceReason,
  issuerCode,
  type ParsedReference,
  parse,
  type ReferenceParts,
} from './reference.js';
export {
  ADM,
  CLR,
  CMP,
  DCB,
  DCF,
  DCI,
  DECLARATION_TYPES,
  type DeclarationType,
  declarationSchemes,
  defineScheme,
  findScheme,
  NCR,
  type NumberingScheme,
  numberingSchemes,
  OFR,
  RFL,
  RPT,
} from './schemes.js';
