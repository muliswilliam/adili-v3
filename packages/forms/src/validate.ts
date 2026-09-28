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

/** A problem with one field before it is given a path: the field's segments and ajv's keyword. */
export interface FieldProblem {
  /** Property names and array indexes from the root to the field; empty for the root. */
  segments: string[];
  /** The JSON Schema keyword that failed, e.g. `required`, `pattern` or `minItems`. */
  code: string;
  message: string;
}

/** A hostile document can fail thousands of times; the caller gets the first ones. */
export const MAX_REPORTED_ERRORS = 50;

// Strict (an unknown keyword throws), but untyped keywords are allowed as in declaration.v1. The
// schemas' lint compiles with the same options (packages/schemas/scripts/validate-forms.mjs).
const ajv = new Ajv2020({ allErrors: true, strictTypes: false });
// ajv-formats is CommonJS; its function is also exported as `default`, which TypeScript can see.
addFormats.default(ajv);

/** Compiles a form's JSON Schema into a validator that reports every problem by field path. */
export function compileForm<T>(schema: AnySchema): (document: unknown) => FormValidationResult<T> {
  return formValidator<T>(compileFieldProblems(schema));
}

/** Reports the problems a compiled form finds by dotted field path. */
export function formValidator<T>(
  problems: (document: unknown) => FieldProblem[],
): (document: unknown) => FormValidationResult<T> {
  return (document: unknown): FormValidationResult<T> => {
    const found = problems(document);
    if (found.length === 0) return { ok: true, value: document as T };
    return {
      ok: false,
      errors: found.map(({ segments, message }) => ({ path: segments.join('.'), message })),
    };
  };
}

/** Like compileForm, but keeps each problem's segments and keyword for callers that place it. */
export function compileFieldProblems(schema: AnySchema): (document: unknown) => FieldProblem[] {
  const validate = ajv.compile(schema);
  return (document: unknown) =>
    validate(document)
      ? []
      : (validate.errors ?? []).slice(0, MAX_REPORTED_ERRORS).map(toFieldProblem);
}

// Ajv reports a missing or unexpected property against its parent object; the path names the
// property itself, so a form can put the message on that field.
function toFieldProblem(error: ErrorObject): FieldProblem {
  const segments = error.instancePath.split('/').slice(1).map(unescapePointer);
  const code = error.keyword;
  if (code === 'required') {
    const { missingProperty } = error.params as { missingProperty: string };
    return { segments: [...segments, missingProperty], code, message: 'is required' };
  }
  if (code === 'additionalProperties') {
    const { additionalProperty } = error.params as { additionalProperty: string };
    return { segments: [...segments, additionalProperty], code, message: 'is not allowed' };
  }
  return { segments, code, message: error.message ?? 'is invalid' };
}

/** A JSON pointer (RFC 6901) to the field the segments name; empty for the root. */
export function jsonPointer(segments: readonly string[]): string {
  return segments
    .map((segment) => `/${segment.replaceAll('~', '~0').replaceAll('/', '~1')}`)
    .join('');
}

function unescapePointer(segment: string): string {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}
