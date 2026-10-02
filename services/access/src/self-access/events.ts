import type { NewEvent } from '@adili/events';

import type { DeliveryMethod } from './schema.js';

/**
 * Events of the access officer's writes on a written self-access application (#303), each the
 * write's audit record in its transaction (ADR-008). The certified copy's issue is the access
 * register's `self-access` step (`access.certified-copy.issued.v1`); recording the application
 * and handing the copy over are not register steps. Ids only: never the representative's name or
 * ID number, nor the identity note.
 */

export const SELF_ACCESS_APPLICATION_RECORDED = 'access.self-access-application.recorded.v1';
export const SELF_ACCESS_APPLICATION_DELIVERED = 'access.self-access-application.delivered.v1';

/** What both carry; the subject is the application. */
export interface SelfAccessApplicationEventData extends Record<string, unknown> {
  applicationId: string;
  /** The certified copy the application ordered. */
  certifiedCopyId: string;
  /** The Commission's slug (also the CloudEvents `tenant` extension). */
  tenant: string;
  /** The declarant. */
  personId: string;
  deliveryMethod: DeliveryMethod;
  /** Token subject of the access officer. */
  actor: string;
  /** ISO 8601. */
  at: string;
}

/** `access.self-access-application.recorded.v1`: recorded, with its copy ordered. */
export interface SelfAccessApplicationRecordedData extends SelfAccessApplicationEventData {
  declarationId: string;
  version: number;
  /** Whether a representative applied for the declarant. */
  byRepresentative: boolean;
}

export function selfAccessApplicationRecorded(
  data: SelfAccessApplicationRecordedData,
): NewEvent<SelfAccessApplicationRecordedData> {
  return {
    type: SELF_ACCESS_APPLICATION_RECORDED,
    subject: data.applicationId,
    tenant: data.tenant,
    data,
  };
}

/** `access.self-access-application.delivered.v1`: the copy was collected or dispatched. */
export function selfAccessApplicationDelivered(
  data: SelfAccessApplicationEventData,
): NewEvent<SelfAccessApplicationEventData> {
  return {
    type: SELF_ACCESS_APPLICATION_DELIVERED,
    subject: data.applicationId,
    tenant: data.tenant,
    data,
  };
}
