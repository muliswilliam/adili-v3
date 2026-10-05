import { PLATFORM_TENANT } from '@adili/api-kit';
import { AUDIT_READ, type AuditReadData, type EventEnvelope } from '@adili/events';
import {
  AUDIT_DEMO_SWITCH,
  type DemoSwitchData,
  VERIFICATION_AUDITED,
  type VerificationAuditedData,
} from '@adili/events/contracts';

import type { ActorType, AuditKind, AuditOutcome } from './schema.js';

/**
 * What the trail files about an event, read from its envelope alone: the same envelope always
 * gives the same record, so the verifier can read it again and compare it with what is stored.
 */
export interface AuditRecord {
  /** The chain the event joins (ADR-008): the tenant whose data it is about, else `platform`. */
  tenant: string;
  kind: AuditKind;
  action: string;
  actorType: ActorType;
  actorId: string;
  actorClientId: string | null;
  actorTenant: string | null;
  actorRoles: string[];
  onBehalfOf: string | null;
  resourceType: string;
  resourceId: string | null;
  subjectPersonId: string | null;
  outcome: AuditOutcome;
  legalBasis: string | null;
  legalReference: string | null;
  recipient: string | null;
  requestMethod: string | null;
  requestRoute: string | null;
  traceparent: string | null;
}

/** OAuth clients users sign in through; any other client's token is a service's. */
const USER_CLIENTS = new Set(['portal', 'console', 'verify']);

/** The tenant a chain is kept for: the envelope's, else the platform's chain. */
function chainTenant(envelope: EventEnvelope): string {
  return envelope.tenant && envelope.tenant !== '' ? envelope.tenant : PLATFORM_TENANT;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/** `declaration.submitted.v1` -> `declaration.submitted`. */
export function actionOf(type: string): string {
  return type.replace(/\.v\d+$/, '');
}

function base(envelope: EventEnvelope): Pick<AuditRecord, 'tenant' | 'traceparent'> {
  return { tenant: chainTenant(envelope), traceparent: envelope.traceparent ?? null };
}

const NO_REQUEST = { requestMethod: null, requestRoute: null } as const;
const NO_BASIS = { legalBasis: null, legalReference: null, recipient: null } as const;

/** An `audit.read.v1`: who read what, on which basis, through which route. */
function readRecord(envelope: EventEnvelope): AuditRecord {
  const data = envelope.data as Partial<AuditReadData>;
  const actor: Record<string, unknown> = isRecord(data.actor) ? data.actor : {};
  const resource: Record<string, unknown> = isRecord(data.resource) ? data.resource : {};
  const params: Record<string, unknown> = isRecord(resource.params) ? resource.params : {};
  const ids = Array.isArray(resource.ids)
    ? resource.ids.filter((id): id is string => typeof id === 'string')
    : [];
  const subject = stringOrNull(actor.subject) ?? 'anonymous';
  const clientId = stringOrNull(actor.clientId);
  // The resource read: what the handler named, else the last id-like path parameter.
  const paramIds = Object.entries(params)
    .filter(([name, value]) => name !== 'slug' && typeof value === 'string')
    .map(([, value]) => value as string);
  const legalBasis = isRecord(data.legalBasis) ? data.legalBasis : null;
  const request: Record<string, unknown> = isRecord(data.request) ? data.request : {};
  return {
    ...base(envelope),
    kind: 'read',
    action: stringOrNull(data.action) ?? actionOf(envelope.type),
    actorType:
      subject === 'anonymous'
        ? 'anonymous'
        : clientId !== null && USER_CLIENTS.has(clientId)
          ? 'user'
          : 'service',
    actorId: subject,
    actorClientId: clientId,
    actorTenant: stringOrNull(actor.tenant),
    actorRoles: Array.isArray(actor.roles)
      ? actor.roles.filter((role): role is string => typeof role === 'string')
      : [],
    onBehalfOf: stringOrNull(actor.onBehalfOf),
    resourceType: stringOrNull(resource.type) ?? 'unknown',
    resourceId: ids.length > 0 ? ids.join(',') : (paramIds.at(-1) ?? null),
    subjectPersonId: stringOrNull(resource.subjectPersonId),
    outcome: 'success',
    legalBasis: legalBasis ? stringOrNull(legalBasis.basis) : null,
    legalReference: legalBasis ? stringOrNull(legalBasis.reference) : null,
    recipient: stringOrNull(data.recipient),
    requestMethod: stringOrNull(request.method),
    requestRoute: stringOrNull(request.route),
  };
}

/** An `audit.verification.v1`: an anonymous lookup of a code on the public verify API. */
function verificationRecord(envelope: EventEnvelope): AuditRecord {
  const data = envelope.data as Partial<VerificationAuditedData>;
  const origin: Record<string, unknown> = isRecord(data.origin) ? data.origin : {};
  return {
    ...base(envelope),
    ...NO_REQUEST,
    ...NO_BASIS,
    kind: 'verification',
    action: 'document.verified',
    actorType: 'anonymous',
    // Never the address: the coarse network it came from (ADR-010 §5).
    actorId: stringOrNull(origin.network) ?? 'anonymous',
    actorClientId: null,
    actorTenant: null,
    actorRoles: [],
    onBehalfOf: null,
    resourceType: 'document',
    resourceId: stringOrNull(data.verificationId) ?? stringOrNull(envelope.subject),
    subjectPersonId: null,
    outcome: 'success',
  };
}

/** An `audit.demo-switch.v1`: a presenter switched account with the demo role switcher. */
function demoSwitchRecord(envelope: EventEnvelope): AuditRecord {
  const data = envelope.data as Partial<DemoSwitchData>;
  const from = isRecord(data.from) ? data.from : null;
  const to: Record<string, unknown> = isRecord(data.to) ? data.to : {};
  return {
    ...base(envelope),
    ...NO_BASIS,
    kind: 'auth',
    action: 'demo.account-switched',
    actorType: from ? 'user' : 'anonymous',
    actorId: (from && (stringOrNull(from.subject) ?? stringOrNull(from.username))) ?? 'anonymous',
    actorClientId: stringOrNull(data.app),
    actorTenant: from ? stringOrNull(from.tenant) : null,
    actorRoles:
      from && Array.isArray(from.roles)
        ? from.roles.filter((role): role is string => typeof role === 'string')
        : [],
    onBehalfOf: null,
    resourceType: 'account',
    resourceId: stringOrNull(to.username) ?? stringOrNull(envelope.subject),
    subjectPersonId: null,
    outcome: 'success',
    requestMethod: 'POST',
    requestRoute: null,
  };
}

/**
 * Any other event: a domain event, written in its service's outbox in the same transaction as the
 * change it announces (ADR-005), so it is the audit record of that write (ADR-008 Pipeline step
 * 1). Its actor is the producing service; the person it is about, when its data names one.
 */
function writeRecord(envelope: EventEnvelope): AuditRecord {
  const data = envelope.data;
  const action = actionOf(envelope.type);
  return {
    ...base(envelope),
    ...NO_REQUEST,
    ...NO_BASIS,
    kind: 'write',
    action,
    actorType: 'service',
    actorId: envelope.source,
    actorClientId: null,
    actorTenant: null,
    actorRoles: [],
    onBehalfOf: null,
    resourceType: action.split('.')[0] ?? action,
    resourceId: stringOrNull(envelope.subject),
    subjectPersonId: stringOrNull(data.personId) ?? stringOrNull(data.declarantPersonId),
    outcome: 'success',
  };
}

/** The record the trail keeps of `envelope`. */
export function recordOf(envelope: EventEnvelope): AuditRecord {
  switch (envelope.type) {
    case AUDIT_READ:
      return readRecord(envelope);
    case VERIFICATION_AUDITED:
      return verificationRecord(envelope);
    case AUDIT_DEMO_SWITCH:
      return demoSwitchRecord(envelope);
    default:
      return writeRecord(envelope);
  }
}
