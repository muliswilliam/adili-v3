import schema from '@adili/schemas/forms/form-k.v1.json' with { type: 'json' };

import type { FormKV1 } from './form-k.v1.gen.js';
import { compileForm } from './validate.js';

/** Validates a Form K document (Regs r.22(1)) against `form-k.v1`. */
export const validateFormK = compileForm<FormKV1>(schema);

/** A part of a declaration an access scope names (`form-k.v1` `scope.sections`). */
export type FormKSection = FormKV1['scope']['sections'][number];

/**
 * The parts of a declaration an access scope names, in the form's order: the one list every
 * service cutting, checking or printing a scope uses (`form-k.v1` `scope.sections`).
 */
export const FORM_K_SECTIONS = [
  'bio',
  'income',
  'assets',
  'liabilities',
  'other',
] as const satisfies readonly FormKSection[];
