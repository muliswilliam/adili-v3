import type { NewEvent } from '@adili/events';

/**
 * Events of the Form K request's own status changes that are not steps of the access register
 * (packages/events access contracts): the workflow closing the representations window, and the
 * request going ahead with the officer it names still unidentified on day five. Each is the
 * change's audit record, written in its transaction (ADR-008). Ids only.
 */

export const ACCESS_REQUEST_WINDOW_CLOSED = 'access.request.window-closed.v1';
export const ACCESS_REQUEST_OFFICER_UNRESOLVED = 'access.request.officer-unresolved.v1';

/** What every status change carries; the subject is the request. */
export interface AccessRequestStatusChangedData extends Record<string, unknown> {
  requestId: string;
  reference: string;
  /** The Commission's slug (also the CloudEvents `tenant` extension). */
  tenant: string;
  /** The declarant, once the officer named is resolved; null before. */
  personId: string | null;
  /** The request's status after the change. */
  status: 'under-decision' | 'officer-unresolved';
  /** ISO 8601. */
  at: string;
}

/** The window closed: the request is `under-decision`. */
export function accessRequestWindowClosed(
  data: AccessRequestStatusChangedData & { status: 'under-decision' },
): NewEvent<AccessRequestStatusChangedData> {
  return { type: ACCESS_REQUEST_WINDOW_CLOSED, subject: data.requestId, tenant: data.tenant, data };
}

/** Day five with the officer unidentified: the request is `officer-unresolved`. */
export function accessRequestOfficerUnresolved(
  data: AccessRequestStatusChangedData & { status: 'officer-unresolved' },
): NewEvent<AccessRequestStatusChangedData> {
  return {
    type: ACCESS_REQUEST_OFFICER_UNRESOLVED,
    subject: data.requestId,
    tenant: data.tenant,
    data,
  };
}
