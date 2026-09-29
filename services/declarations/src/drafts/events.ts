import type { NewEvent } from '@adili/events';

import type { ObligationType } from '../obligations/engine.js';

/**
 * Events the declarations service publishes about declaration drafts (spec 05). Identifiers and
 * states only: no section contents, amounts or names (ADR-013 §3). The `tenant` extension is the
 * Commission's slug; the subject is the declaration.
 */

export const DECLARATION_DRAFT_STARTED = 'declaration.draft-started.v1';

export interface DeclarationDraftStartedData extends Record<string, unknown> {
  declarationId: string;
  obligationId: string;
  type: ObligationType;
}

export function declarationDraftStarted(
  tenant: string,
  data: DeclarationDraftStartedData,
): NewEvent<DeclarationDraftStartedData> {
  return { type: DECLARATION_DRAFT_STARTED, subject: data.declarationId, tenant, data };
}
