import type { z } from 'zod';

import {
  auditEventPageSchema,
  auditEventSchema,
  auditEventSummarySchema,
  chainPageSchema,
  chainVerificationSchema,
} from './trail/representation.js';

/** Named schemas of the audit service's OpenAPI document (`#/components/schemas/<name>`). */
export const OPENAPI_SCHEMAS: Record<string, z.ZodType> = {
  AuditEventSummary: auditEventSummarySchema,
  AuditEventPage: auditEventPageSchema,
  AuditEvent: auditEventSchema,
  AuditChainPage: chainPageSchema,
  AuditChainVerification: chainVerificationSchema,
};
