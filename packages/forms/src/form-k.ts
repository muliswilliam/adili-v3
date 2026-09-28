import schema from '@adili/schemas/forms/form-k.v1.json' with { type: 'json' };

import type { FormKV1 } from './form-k.v1.gen.js';
import { compileForm } from './validate.js';

/** Validates a Form K document (Regs r.22(1)) against `form-k.v1`. */
export const validateFormK = compileForm<FormKV1>(schema);
