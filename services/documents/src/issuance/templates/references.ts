import {
  type DeclarationType,
  declarationSchemes,
  InvalidReferenceError,
  parse,
} from '@adili/numbering/references';
import { z } from 'zod';

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

/** The issuing Commission as the declarations service names it (`CommissionRef`). */
export const commissionRefSchema = z.strictObject({
  slug: z.string().min(1).max(20),
  /** As in the reference numbers, e.g. `PSC`. */
  issuerCode: z.string().regex(/^[A-Z0-9]{2,20}$/),
  name: z.string().trim().min(1).max(200),
});
