import type { Principal } from '@adili/api-kit';

import {
  DeclarationsClient,
  DeclarationsUnavailable,
  type PulledVersion,
} from '../declarations/declarations-client.js';
import { declarationsUnavailable } from './upstream.js';
import { VIEW_DECLARATIONS_BUDGET_MS, within } from './view-budget.js';

/** The case keys a reviewer's read of the version under review needs. */
export interface ViewedCase {
  id: string;
  tenant: string;
  declarationId: string;
  currentVersion: number;
}

/**
 * The version under review as declarations gives it, read for the viewer and the case (audited
 * there) within the view's budget: the case view and the Registry tab. Declarations not
 * answering in time, being unreachable, or not having the version is review's 502
 * `declarations-unavailable`.
 */
export async function pullViewedVersion(
  declarations: DeclarationsClient,
  principal: Principal,
  row: ViewedCase,
): Promise<PulledVersion> {
  let pulled: PulledVersion | null;
  try {
    pulled = await within(
      VIEW_DECLARATIONS_BUDGET_MS,
      () =>
        declarations.getVersionDocument(row.declarationId, row.currentVersion, {
          tenant: row.tenant,
          actingSubject: principal.subject,
          caseId: row.id,
        }),
      () => new DeclarationsUnavailable('The declarations service did not answer in time'),
    );
  } catch (error) {
    if (error instanceof DeclarationsUnavailable) throw declarationsUnavailable();
    throw error;
  }
  if (pulled === null) {
    throw declarationsUnavailable(
      'The declarations service does not have the version under review.',
    );
  }
  return pulled;
}
