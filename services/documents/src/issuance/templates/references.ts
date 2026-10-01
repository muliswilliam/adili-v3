import {
  type DeclarationType,
  declarationSchemes,
  InvalidReferenceError,
  parse,
} from '@adili/numbering/references';

/** The declaration types, as the reference schemes name them. */
export const DECLARATION_TYPES = Object.keys(declarationSchemes) as [
  DeclarationType,
  ...DeclarationType[],
];

const DECLARATION_SCHEMES = Object.values(declarationSchemes);

/** A valid ADR-011 declaration reference number, e.g. `DCB-PSC-2027-0000001-1`. */
export function isDeclarationReference(reference: string): boolean {
  try {
    parse(reference, DECLARATION_SCHEMES);
    return true;
  } catch (error) {
    if (error instanceof InvalidReferenceError) return false;
    throw error;
  }
}
