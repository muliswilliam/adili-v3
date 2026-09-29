export {
  allocate,
  allocateReference,
  type CounterKey,
  type NumberingExecutor,
} from './allocate.js';
export { ALPHABET, checkCharacter, hasValidCheckCharacter } from './check-character.js';
export {
  format,
  InvalidReferenceError,
  type InvalidReferenceReason,
  type ParsedReference,
  parse,
  type ReferenceParts,
} from './reference.js';
export { numberingCounters, numberingSchema } from './schema.js';
export { defineScheme, type NumberingScheme, NCR, numberingSchemes, OFR, RPT } from './schemes.js';
