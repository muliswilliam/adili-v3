import { z } from 'zod';

/** ADR-011: `DC{I|B|F}-<ISSUER>-<YEAR>-<7 digits>-<check>`. */
export const DECLARATION_REFERENCE = /^DC[IBF]-[A-Z][A-Z0-9]{1,19}-[0-9]{4}-[0-9]{7}-[0-9A-Z]$/;

export const declarationReferenceSchema = z
  .string()
  .regex(DECLARATION_REFERENCE)
  .meta({
    description:
      'ADR-011: DC{I|B|F}-<ISSUER>-<YEAR>-<7 digits>-<check>, allocated at the first submission and kept by later versions',
    examples: ['DCB-TSC-2027-0012345-K'],
  });
