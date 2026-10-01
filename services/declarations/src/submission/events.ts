import { DECLARATION_SUBMITTED, type DeclarationSubmittedData, type NewEvent } from '@adili/events';

/**
 * Events the declarations service publishes about submission (spec 06). Identifiers, dates and
 * flags only: no contents, amounts or names (ADR-013 §3). The `tenant` extension is the
 * Commission's slug; the subject is the declaration. The contract lives in `@adili/events`, as
 * other services consume it.
 */

export { DECLARATION_SUBMITTED, type DeclarationSubmittedData };

export function declarationSubmitted(
  tenant: string,
  data: DeclarationSubmittedData,
): NewEvent<DeclarationSubmittedData> {
  return { type: DECLARATION_SUBMITTED, subject: data.declarationId, tenant, data };
}

/**
 * A submitted declaration was reopened for amendment: the version in force is copied into
 * editable sections and stays in force until the amendment is submitted as the next version.
 */
export const DECLARATION_AMENDMENT_STARTED = 'declaration.amendment-started.v1';

export interface DeclarationAmendmentStartedData extends Record<string, unknown> {
  declarationId: string;
  /** The version in force the amendment started from. */
  fromVersion: number;
}

export function declarationAmendmentStarted(
  tenant: string,
  data: DeclarationAmendmentStartedData,
): NewEvent<DeclarationAmendmentStartedData> {
  return { type: DECLARATION_AMENDMENT_STARTED, subject: data.declarationId, tenant, data };
}

/** An amendment in progress was discarded: the declaration is back to the version in force. */
export const DECLARATION_AMENDMENT_DISCARDED = 'declaration.amendment-discarded.v1';

export interface DeclarationAmendmentDiscardedData extends Record<string, unknown> {
  declarationId: string;
  /** The version in force, which the declaration is back to. */
  version: number;
}

export function declarationAmendmentDiscarded(
  tenant: string,
  data: DeclarationAmendmentDiscardedData,
): NewEvent<DeclarationAmendmentDiscardedData> {
  return { type: DECLARATION_AMENDMENT_DISCARDED, subject: data.declarationId, tenant, data };
}
