import { FORM_K_SECTIONS, type FormKSection } from '@adili/forms';
import { z } from 'zod';

/**
 * What a request asks to see and a grant allows (access.yaml `Scope`, form-k.v1 `scope`): the
 * declarations of these years (statement dates), the officer's own statement plus, when
 * included, the spouses' and the children's, these sections and, when included, the
 * clarifications the declarant gave on those declarations. A grant's scope is the requested one
 * or narrower, never wider.
 */

/** The parts of a declaration a scope names (access.yaml `Section`). */
export const SECTIONS = FORM_K_SECTIONS;
export type Section = FormKSection;

export const sectionSchema = z.enum(SECTIONS);

/** Strict: any other field is a 400 at its path. */
export const scopeSchema = z.strictObject({
  years: z.array(z.int().min(2025)).min(1).max(50),
  includeSpouses: z.boolean(),
  includeChildren: z.boolean(),
  sections: z.array(sectionSchema).min(1),
  includeClarifications: z.boolean().meta({
    description:
      'The clarifications the declarant gave on the disclosed declarations (Act s.36(1), Regulation 22(1)): Form K only, always false for a law enforcement request',
  }),
});

export type Scope = z.infer<typeof scopeSchema>;

/**
 * Whether `granted` asks for nothing `requested` does not: no other year or section, and no
 * household member or clarifications the request left out.
 */
export function isWithinScope(granted: Scope, requested: Scope): boolean {
  const years = new Set(requested.years);
  const sections = new Set<Section>(requested.sections);
  return (
    granted.years.every((year) => years.has(year)) &&
    granted.sections.every((section) => sections.has(section)) &&
    (!granted.includeSpouses || requested.includeSpouses) &&
    (!granted.includeChildren || requested.includeChildren) &&
    (!granted.includeClarifications || requested.includeClarifications)
  );
}
