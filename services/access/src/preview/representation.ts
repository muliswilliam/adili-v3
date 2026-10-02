import { z } from 'zod';

import { scopeSchema } from '../scope.js';

/**
 * The scope preview (spec 10, decision 1): what a scope holds of the declarant's declarations,
 * for the access officer before deciding, in counts only. Never content: not a name, an amount or
 * a text of a declaration or clarification. The contract: packages/schemas/internal/access.yaml
 * is generated from these schemas.
 */

const count = z.int().min(0);

export const scopePreviewYearSchema = z.object({
  year: z.int().meta({ description: "A year of the scope: the statement dates' year" }),
  declarations: count.meta({
    description: "The declarant's declarations at the Commission that year (versions in force)",
  }),
  sections: z
    .object({
      bio: count.optional(),
      income: count.optional(),
      assets: count.optional(),
      liabilities: count.optional(),
      other: count.optional(),
    })
    .meta({
      description:
        "Per section of the scope (absent: not in it): `bio` the persons whose particulars would go out; `income`, `assets`, `liabilities` the entries of the included persons' statements; `other` the material changes, directorships, memberships, pending cases and a written statement",
    }),
  spouses: count
    .nullable()
    .meta({ description: 'The spouses anything would go out about; null when not included' }),
  children: count
    .nullable()
    .meta({ description: 'The children anything would go out about; null when not included' }),
  clarifications: count.nullable().meta({
    description:
      "The clarifications issued on that year's declarations a grant would disclose; null when the scope does not include clarifications",
  }),
});
export type ScopePreviewYear = z.infer<typeof scopePreviewYearSchema>;

export const scopePreviewSchema = z
  .object({
    scope: scopeSchema.meta({ description: 'The scope previewed' }),
    declarantOnboarded: z.boolean().meta({
      description:
        'Whether the declarant has an account: one without (served in writing, spec 10 decision 2) has filed no declaration on Adili, so the scope holds nothing',
    }),
    empty: z.boolean().meta({
      description:
        'Nothing within the scope: a grant of it issues the nil letter (no declarations held within the granted scope) instead of an access package',
    }),
    declarations: count.meta({ description: 'The declarations the scope holds, in all its years' }),
    clarifications: count.nullable().meta({
      description:
        'The clarifications a grant would disclose with them; null when the scope does not include clarifications',
    }),
    years: z.array(scopePreviewYearSchema).meta({
      description: 'Every year of the scope, ascending, with zero counts for a year with none',
    }),
  })
  .meta({
    description:
      "What a scope holds of the declarant's declarations, counted for the access officer before deciding: never content. Every preview is audited with its legal basis",
  });
export type ScopePreview = z.infer<typeof scopePreviewSchema>;
