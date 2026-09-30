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
