import { callService, type ServiceResult } from './service-call';
import type { SupportClient } from './support/client.server';
import type { PersonSummary } from './support/types';

/**
 * The helpdesk's person lookup by officer reference (spec 03): account metadata only, never
 * roster contents. Pure: the caller injects the client (see `account-support.ts`). The directory
 * admits the helpdesk and platform admins and audits every lookup.
 */
export function findPerson(
  client: SupportClient,
  ofr: string,
): Promise<ServiceResult<PersonSummary>> {
  return callService(() => client.GET('/v1/persons', { params: { query: { ofr } } }));
}
