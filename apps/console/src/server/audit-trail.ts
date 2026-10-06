import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { withViewerClient } from './as-viewer.server';
import { auditClient, auditPersonsClient } from './audit/client.server';
import { AUDIT_KINDS } from './audit/types';
import type { AuditChainPage, AuditChainVerification, AuditEventPage } from './audit/types';
import {
  type AuditEventView,
  getAuditEvent,
  getAuditPersonName,
  listAuditChains,
  listAuditEvents,
  verifyAuditChain,
} from './audit-trail.server';
import type { ServiceResult } from './service-call';

/**
 * Server functions for the auditor's audit trail pages (ADR-008), called as the signed-in
 * auditor: the audit service refuses anyone else (403) and audits every read. Tokens stay on the
 * server.
 */

/** Rows per page of events. */
const EVENTS_PAGE_SIZE = 25;
/** Chains listed on the integrity tab: the last fortnight of a few dozen tenants. */
const CHAINS_LIMIT = 200;

const tenantKey = z.string().regex(/^[a-z][a-z0-9]{1,19}$/);
const day = z.iso.date();

export const auditEventsInput = z.object({
  tenant: tenantKey.optional(),
  actor: z.string().trim().min(1).max(200).optional(),
  subjectPersonId: z.uuid().optional(),
  action: z.string().trim().min(1).max(200).optional(),
  kind: z.enum(AUDIT_KINDS).optional(),
  from: day.optional(),
  to: day.optional(),
  cursor: z.string().min(1).max(500).optional(),
});

export const getAuditEvents = createServerFn({ method: 'GET' })
  .validator(auditEventsInput)
  .handler(({ data }): Promise<ServiceResult<AuditEventPage>> =>
    withViewerClient(auditClient, (client) => listAuditEvents(client, data, EVENTS_PAGE_SIZE)),
  );

export const getAuditEventDetail = createServerFn({ method: 'GET' })
  .validator(z.object({ eventId: z.uuid() }))
  .handler(({ data }): Promise<ServiceResult<AuditEventView>> =>
    withViewerClient(auditClient, (client) => getAuditEvent(client, data.eventId)),
  );

export const getAuditSubjectName = createServerFn({ method: 'GET' })
  .validator(z.object({ personId: z.uuid() }))
  .handler(({ data }): Promise<ServiceResult<string>> =>
    withViewerClient(auditPersonsClient, (client) => getAuditPersonName(client, data.personId)),
  );

export const getAuditChains = createServerFn({ method: 'GET' })
  .validator(z.object({ tenant: tenantKey.optional() }))
  .handler(({ data }): Promise<ServiceResult<AuditChainPage>> =>
    withViewerClient(auditClient, (client) =>
      listAuditChains(client, { ...data, limit: CHAINS_LIMIT }),
    ),
  );

export const checkAuditChain = createServerFn({ method: 'GET' })
  .validator(z.object({ tenant: tenantKey, chainDay: day }))
  .handler(({ data }): Promise<ServiceResult<AuditChainVerification>> =>
    withViewerClient(auditClient, (client) => verifyAuditChain(client, data.tenant, data.chainDay)),
  );
