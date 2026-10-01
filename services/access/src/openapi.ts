import type { z } from 'zod';

import { decisionSchema, groundSchema, outcomeSchema, packageSchema } from './decision.js';
import { registerEntrySchema } from './register/representation.js';
import {
  accessRequestSchema,
  accessRequestStatusSchema,
  formKSchema,
} from './requests/representation.js';
import { scopeSchema, sectionSchema } from './scope.js';

/**
 * Named schemas of the access service's OpenAPI document (`#/components/schemas/<name>`). The
 * operations and schemas not implemented yet stay in packages/schemas/drafts/access.yaml, which
 * may reference these.
 */
export const OPENAPI_SCHEMAS: Record<string, z.ZodType> = {
  AccessRequestStatus: accessRequestStatusSchema,
  Outcome: outcomeSchema,
  Ground: groundSchema,
  Section: sectionSchema,
  Scope: scopeSchema,
  Decision: decisionSchema,
  Package: packageSchema,
  FormK: formKSchema,
  AccessRequest: accessRequestSchema,
  RegisterEntry: registerEntrySchema,
};
