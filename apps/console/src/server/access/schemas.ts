import { REGULATION_24_GROUNDS, SCOPE_SECTIONS, type ScopeSection } from '@adili/ui';
import { z } from 'zod';

/**
 * The BFF's checks of what the access screens send, shared by the Form K and the law
 * enforcement server functions so both read a scope, grounds and reasons alike. The bounds are
 * access.yaml's; the access service has the final say, and its 400 maps back to the forms.
 */

/** access.yaml `DecisionInput.reasons`: 1 to 4,000 characters. */
export const DECISION_REASONS_MAX = 4000;

/** access.yaml `Scope`: at least one year and one section; the declarant is always included. */
export const scopeSchema = z.strictObject({
  years: z.array(z.int().min(2025)).min(1).max(50),
  includeSpouses: z.boolean(),
  includeChildren: z.boolean(),
  sections: z
    .array(z.enum(SCOPE_SECTIONS as [ScopeSection, ...ScopeSection[]]))
    .min(1)
    .max(SCOPE_SECTIONS.length),
});

/** Regulation 24's grounds, each at most once. */
export const groundsSchema = z
  .array(z.enum(REGULATION_24_GROUNDS))
  .max(REGULATION_24_GROUNDS.length);

/** The decision as the form sends it; the access service applies the rules between fields. */
export const decisionInputSchema = z.strictObject({
  outcome: z.enum(['grant', 'partial-grant', 'deny']),
  grantedScope: scopeSchema.nullable().optional(),
  grounds: groundsSchema.optional(),
  reasons: z.string().trim().min(1).max(DECISION_REASONS_MAX),
});

/** access.yaml `WrittenNotice`: the day a written notice was served, `YYYY-MM-DD`. */
export const writtenNoticeSchema = z.strictObject({ notifiedOn: z.iso.date() });

/** access.yaml `RepresentationsInput`, as the officer enters representations received in writing. */
export const representationsInputSchema = z.strictObject({
  stance: z.enum(['object', 'consent', 'context']),
  text: z.string().trim().max(8000),
  attachments: z.array(z.uuid()).max(10),
});
