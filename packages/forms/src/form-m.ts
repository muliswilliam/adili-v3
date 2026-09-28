import schema from '@adili/schemas/forms/form-m.v1.json' with { type: 'json' };

import type { FormMV1 } from './form-m.v1.gen.js';
import {
  compileFieldProblems,
  type FieldProblem,
  formValidator,
  type FormValidationError,
  jsonPointer,
} from './validate.js';

const problems = compileFieldProblems(schema);

/**
 * Validates a compliance report (Form M, Regs r.25(2)) against `form-m.v1`. Errors have dotted
 * paths, the `errors` of the problem details a federated submission gets back.
 */
export const validateFormM = formValidator<FormMV1>(problems);

/**
 * The sections of the prescribed Form M: Part I, Part II sections 1-5 (initial, biennial, final,
 * clarifications, access requests), Part B complaints (sections 6-7) and Part III.
 */
export const FORM_M_SECTIONS = [
  { key: 'partI', at: ['partI'] },
  { key: 'initial', at: ['partII', 'initial'] },
  { key: 'biennial', at: ['partII', 'biennial'] },
  { key: 'final', at: ['partII', 'final'] },
  { key: 'clarifications', at: ['partII', 'clarifications'] },
  { key: 'accessRequests', at: ['partII', 'accessRequests'] },
  { key: 'complaints', at: ['partII', 'complaints'] },
  { key: 'partIII', at: ['partIII'] },
] as const;

export type FormMSectionKey = (typeof FORM_M_SECTIONS)[number]['key'];

/** A schema problem on a Form M section, for the console's section cards. */
export interface FormMIssue {
  sectionKey: FormMSectionKey;
  /** JSON pointer within the section, e.g. `/nonFilers/0/actionTaken`; empty for the section. */
  path: string;
  /** The JSON Schema keyword that failed, e.g. `required`, `enum` or `minimum`. */
  code: string;
  message: string;
}

export interface FormMProblems {
  /** Problems placed on the Form M section that shows them. */
  issues: FormMIssue[];
  /** Problems outside the sections: the schema version, platform `meta`, a missing part. */
  report: FormValidationError[];
}

/** Validates a compliance report and places every problem on its Form M section and field. */
export function formMIssues(document: unknown): FormMProblems {
  const found: FormMProblems = { issues: [], report: [] };
  for (const problem of problems(document)) {
    const issue = toIssue(problem);
    if (issue) found.issues.push(issue);
    else found.report.push({ path: problem.segments.join('.'), message: problem.message });
  }
  return found;
}

function toIssue({ segments, code, message }: FieldProblem): FormMIssue | undefined {
  const section = FORM_M_SECTIONS.find(({ at }) => at.every((field, i) => segments[i] === field));
  if (!section) return undefined;
  return {
    sectionKey: section.key,
    path: jsonPointer(segments.slice(section.at.length)),
    code,
    message,
  };
}
