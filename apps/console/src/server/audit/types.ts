import type { components } from './api.gen';

type Schemas = components['schemas'];

/** The audit service's representations (audit.yaml). */
export type AuditEventSummary = Schemas['AuditEventSummary'];
export type AuditEventPage = Schemas['AuditEventPage'];
export type AuditEvent = Schemas['AuditEvent'];
export type AuditChainPage = Schemas['AuditChainPage'];
export type AuditChain = AuditChainPage['items'][number];
export type AuditChainVerification = Schemas['AuditChainVerification'];
export type AuditKind = AuditEventSummary['kind'];

export const AUDIT_KINDS = [
  'read',
  'write',
  'verification',
  'auth',
] as const satisfies readonly AuditKind[];
