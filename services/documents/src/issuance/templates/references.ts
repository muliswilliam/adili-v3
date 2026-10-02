import {
  type DeclarationType,
  declarationSchemes,
  InvalidReferenceError,
  type NumberingScheme,
  parse,
} from '@adili/numbering/references';
import { z } from 'zod';

/** The declaration types, as the reference schemes name them. */
export const DECLARATION_TYPES = Object.keys(declarationSchemes) as [
  DeclarationType,
  ...DeclarationType[],
];

const DECLARATION_SCHEMES = Object.values(declarationSchemes);

/** Whether `reference` is a valid ADR-011 number of one of `schemes`, check character included. */
export function isReferenceOf(reference: string, schemes: readonly NumberingScheme[]): boolean {
  try {
    parse(reference, schemes);
    return true;
  } catch (error) {
    if (error instanceof InvalidReferenceError) return false;
    throw error;
  }
}

/** A valid ADR-011 declaration reference number, e.g. `DCB-PSC-2027-0000001-1`. */
export function isDeclarationReference(reference: string): boolean {
  return isReferenceOf(reference, DECLARATION_SCHEMES);
}

/** The scheme of a valid declaration reference number, e.g. `Initial declaration`. */
export function declarationSchemeOf(reference: string): NumberingScheme {
  const { scheme } = parse(reference, DECLARATION_SCHEMES);
  const found = DECLARATION_SCHEMES.find((each) => each.code === scheme);
  if (!found) throw new Error(`${reference} is not a declaration reference number`);
  return found;
}

/** The issuing Commission as the declarations service names it (`CommissionRef`). */
export const commissionRefSchema = z.strictObject({
  slug: z.string().min(1).max(20),
  /** As in the reference numbers, e.g. `PSC`. */
  issuerCode: z.string().regex(/^[A-Z0-9]{2,20}$/),
  name: z.string().trim().min(1).max(200),
});
