import type { DeclarationV1 } from './declaration.v1.gen.js';

/**
 * The capture sections other than the per-person statements: the declaration.v1 fields each
 * holds, and whether paths inside it keep the field name (household contents are
 * `{ spouses, children }`, so they do; bio and other contents are the field itself).
 *
 * Free of imports with values, so scripts/generate-validators.ts can read it to build each
 * section's schema, and declaration.ts uses it to place problems on the same sections.
 */
export const FIXED_SECTION_FIELDS = {
  bio: { fields: ['officer'], keepsFieldName: false },
  household: { fields: ['spouses', 'children'], keepsFieldName: true },
  other: { fields: ['otherInformation'], keepsFieldName: false },
} as const satisfies Record<
  string,
  { fields: readonly [keyof DeclarationV1, ...(keyof DeclarationV1)[]]; keepsFieldName: boolean }
>;

export type FixedSectionKey = keyof typeof FIXED_SECTION_FIELDS;

export const FIXED_SECTION_KEYS = [
  'bio',
  'household',
  'other',
] as const satisfies readonly FixedSectionKey[];
