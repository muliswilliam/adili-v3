import type { z } from 'zod';

import {
  disclosureLevelSchema,
  verificationResultSchema,
  verificationStatusSchema,
} from './verification/representation.js';

/** Named schemas of the verification-api's OpenAPI document (`#/components/schemas/<name>`). */
export const OPENAPI_SCHEMAS: Record<string, z.ZodType> = {
  VerificationStatus: verificationStatusSchema,
  DisclosureLevel: disclosureLevelSchema,
  VerificationResult: verificationResultSchema,
};
