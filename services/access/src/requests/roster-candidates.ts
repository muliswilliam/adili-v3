import type { ReadAudit } from '@adili/api-kit';

import { DirectoryClient, DirectoryUnavailable } from '../directory/directory-client.js';
import { directoryUnavailable } from '../problems.js';
import type { RosterCandidates } from './officer-representation.js';

/**
 * The Commission's roster records matching `search` (a personnel file number's beginning or part
 * of a name), as the access officer chooses the officer a Form K or a law enforcement request
 * names, or the declarant of a written self-access application: only an `onboarded` record can
 * be chosen. The read is audited with the records it returned (ADR-008: searches that return
 * declarant records). 503 `directory-unavailable` when the directory cannot be reached.
 */
export async function rosterCandidates(
  directory: DirectoryClient,
  tenant: string,
  search: string,
  audit: ReadAudit,
): Promise<RosterCandidates> {
  let found;
  try {
    found = await directory.searchRoster(tenant, search);
  } catch (error) {
    if (error instanceof DirectoryUnavailable) throw directoryUnavailable();
    throw error;
  }
  audit.resource({ tenant, ids: found.map((record) => record.id) });
  return {
    items: found.map((record) => ({
      id: record.id,
      personnelFileNumber: record.personnelFileNumber,
      fullName: record.fullName,
      designation: record.designation,
      reportingEntity: record.reportingEntityName,
      state: record.state,
      onboarded: record.personId !== null,
    })),
  };
}
