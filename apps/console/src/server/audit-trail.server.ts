import type { AuditClient } from './audit/client.server';
import type {
  AuditChainPage,
  AuditChainVerification,
  AuditEvent,
  AuditEventPage,
  AuditKind,
} from './audit/types';
import { callService, type ServiceResult } from './service-call';

/**
 * The auditor's reads of the audit trail (ADR-008), folded into results the pages can switch on.
 * Pure: the caller injects the client (see `audit-trail.ts` for the server functions that call
 * these as the signed-in auditor). The service admits auditors only and audits every read.
 */

export interface AuditEventFilters {
  tenant?: string;
  actor?: string;
  subjectPersonId?: string;
  action?: string;
  kind?: AuditKind;
  /** First day, `YYYY-MM-DD`, from its start in Nairobi. */
  from?: string;
  /** Last day, `YYYY-MM-DD`, to its end in Nairobi. */
  to?: string;
  cursor?: string;
}

/** A Nairobi calendar day's start (UTC+3, no daylight saving) as an instant. */
export function nairobiDayStart(day: string): string {
  return new Date(`${day}T00:00:00+03:00`).toISOString();
}

/** The instant after a Nairobi calendar day ends. */
export function nairobiDayEnd(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00+03:00`) + 86_400_000).toISOString();
}

export function listAuditEvents(
  client: AuditClient,
  { from, to, ...filters }: AuditEventFilters,
  limit: number,
): Promise<ServiceResult<AuditEventPage>> {
  return callService(() =>
    client.GET('/v1/audit/events', {
      params: {
        query: {
          ...filters,
          ...(from ? { from: nairobiDayStart(from) } : {}),
          ...(to ? { to: nairobiDayEnd(to) } : {}),
          limit,
        },
      },
    }),
  );
}

/**
 * An audit event as the drawer shows it: its data as published, pretty-printed (a free-form
 * object, which server functions cannot carry as is).
 */
export type AuditEventView = Omit<AuditEvent, 'data'> & { dataJson: string };

export async function getAuditEvent(
  client: AuditClient,
  eventId: string,
): Promise<ServiceResult<AuditEventView>> {
  const result = await callService(() =>
    client.GET('/v1/audit/events/{eventId}', { params: { path: { eventId } } }),
  );
  if (!result.ok) return result;
  const { data, ...event } = result.data;
  return { ok: true, data: { ...event, dataJson: JSON.stringify(data, null, 2) } };
}

export function listAuditChains(
  client: AuditClient,
  query: { tenant?: string; limit: number },
): Promise<ServiceResult<AuditChainPage>> {
  return callService(() => client.GET('/v1/audit/chains', { params: { query } }));
}

export function verifyAuditChain(
  client: AuditClient,
  tenant: string,
  chainDay: string,
): Promise<ServiceResult<AuditChainVerification>> {
  return callService(() =>
    client.GET('/v1/audit/chains/{tenant}/{chainDay}/verification', {
      params: { path: { tenant, chainDay } },
    }),
  );
}
