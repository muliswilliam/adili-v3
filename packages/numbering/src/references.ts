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
  DCB,
  DCF,
  DCI,
  type DeclarationType,
  declarationSchemes,
  defineScheme,
  findScheme,
  type NumberingScheme,
  numberingSchemes,
  OFR,
} from './schemes.js';
