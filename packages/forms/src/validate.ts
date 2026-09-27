import { Ajv2020, type AnySchema, type ErrorObject } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

/** A problem with one field, shaped like the `errors` of an RFC 9457 validation problem. */
export interface FormValidationError {
  /** Dotted path to the field, e.g. `partIII.reason` or `scope.years.0`; empty for the root. */
  path: string;
  message: string;
}

export type FormValidationResult<T> =
  { ok: true; value: T } | { ok: false; errors: FormValidationError[] };

const ajv = new Ajv2020({ allErrors: true });
// ajv-formats is CommonJS; its function is also exported as `default`, which TypeScript can see.
addFormats.default(ajv);

/** Compiles a form's JSON Schema into a validator that reports every problem by field path. */
export function compileForm<T>(schema: AnySchema): (document: unknown) => FormValidationResult<T> {
  const validate = ajv.compile<T>(schema);
  return (document: unknown): FormValidationResult<T> => {
    if (validate(document)) return { ok: true, value: document as T };
    return { ok: false, errors: (validate.errors ?? []).map(toFieldError) };
  };
}

// Ajv reports a missing or unexpected property against its parent object; the path names the
// property itself, so a form can put the message on that field. The fixture check in
// packages/schemas/scripts/validate-forms.mjs maps paths the same way; keep them in step.
function toFieldError(error: ErrorObject): FormValidationError {
  const segments = error.instancePath.split('/').slice(1).map(unescapePointer);
  if (error.keyword === 'required') {
    return {
      path: [...segments, (error.params as { missingProperty: string }).missingProperty].join('.'),
      message: 'is required',
    };
  }
  if (error.keyword === 'additionalProperties') {
    return {
      path: [...segments, (error.params as { additionalProperty: string }).additionalProperty].join(
        '.',
      ),
      message: 'is not allowed',
    };
  }
  return { path: segments.join('.'), message: error.message ?? 'is invalid' };
}

function unescapePointer(segment: string): string {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}
