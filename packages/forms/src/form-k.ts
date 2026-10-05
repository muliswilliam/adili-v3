import type { FormKV1 } from './form-k.v1.gen.js';
import { formK } from './form-k.v1.validate.gen.js';
import { formValidator } from './validate.js';

/** Validates a Form K document (Regs r.22(1)) against `form-k.v1`. */
export const validateFormK = formValidator<FormKV1>(formK);

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
