import type { z } from 'zod';

import { iprsPersonSchema, lookupIprsPersonSchema } from './iprs/iprs-person.js';

/**
 * Named schemas of the integration-gateway's OpenAPI document (`#/components/schemas/<name>`).
 */
export const OPENAPI_SCHEMAS: Record<string, z.ZodType> = {
  LookupIprsPerson: lookupIprsPersonSchema,
  IprsPerson: iprsPersonSchema,
};
