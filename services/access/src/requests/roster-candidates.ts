import { DirectoryClient, DirectoryUnavailable } from '../directory/directory-client.js';
import { directoryUnavailable } from '../problems.js';
import type { RosterCandidates } from './officer-representation.js';

/**
 * The Commission's roster records matching `search` (a personnel file number's beginning or part
 * of a name), as the access officer chooses the officer a Form K or a law enforcement request
 * names: only an `onboarded` record can be chosen. 503 `directory-unavailable` when the
 * directory cannot be reached.
 */
export async function rosterCandidates(
  directory: DirectoryClient,
  tenant: string,
  search: string,
): Promise<RosterCandidates> {
  let found;
  try {
    found = await directory.searchRoster(tenant, search);
  } catch (error) {
    if (error instanceof DirectoryUnavailable) throw directoryUnavailable();
    throw error;
  }
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
