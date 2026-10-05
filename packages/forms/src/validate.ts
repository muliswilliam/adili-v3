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

/**
 * A form's validator as scripts/generate-validators.ts writes it: ajv standalone code, compiled
 * when the package is built rather than at module load, since ajv compiles with `new Function`
 * and the apps' CSP forbids that.
 */
export interface PrecompiledValidator {
  (document: unknown): boolean;
  errors?: AjvError[] | null;
}

/** The fields of an ajv `ErrorObject` this module reads. */
interface AjvError {
  instancePath: string;
  keyword: string;
  params: Record<string, unknown>;
  message?: string;
}

/** Reports every problem a form's validator finds by dotted field path. */
export function formValidator<T>(
  validate: PrecompiledValidator,
): (document: unknown) => FormValidationResult<T> {
  const problems = fieldProblems(validate);
  return (document: unknown): FormValidationResult<T> => {
    const found = problems(document);
    if (found.length === 0) return { ok: true, value: document as T };
    return {
      ok: false,
      errors: found.map(({ segments, message }) => ({ path: segments.join('.'), message })),
    };
  };
}

/** Like formValidator, but keeps each problem's segments and keyword for callers that place it. */
export function fieldProblems(
  validate: PrecompiledValidator,
): (document: unknown) => FieldProblem[] {
  return (document: unknown) =>
    validate(document)
      ? []
      : (validate.errors ?? []).slice(0, MAX_REPORTED_ERRORS).map(toFieldProblem);
}

// Ajv reports a missing or unexpected property against its parent object; the path names the
// property itself, so a form can put the message on that field.
function toFieldProblem(error: AjvError): FieldProblem {
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

/**
 * Problems split into those `place` puts on a section of the form and the rest, by dotted path,
 * for the fields outside any section.
 */
export function placeProblems<Issue>(
  problems: FieldProblem[],
  place: (problem: FieldProblem) => Issue | undefined,
): { placed: Issue[]; unplaced: FormValidationError[] } {
  const placed: Issue[] = [];
  const unplaced: FormValidationError[] = [];
  for (const problem of problems) {
    const issue = place(problem);
    if (issue === undefined)
      unplaced.push({ path: problem.segments.join('.'), message: problem.message });
    else placed.push(issue);
  }
  return { placed, unplaced };
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
