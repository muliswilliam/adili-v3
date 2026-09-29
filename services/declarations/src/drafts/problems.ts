import { HttpStatus } from '@nestjs/common';
import { ProblemException } from '@adili/api-kit';

/** The problems the drafts routes answer with, each built in one place. */

/** 409: the declaration is past the draft (or amending), so it cannot be `edited` or `discarded`. */
export function declarationNotDraft(action: 'edited' | 'discarded'): ProblemException {
  return new ProblemException({
    type: 'declaration-not-draft',
    title: 'Not a draft',
    status: HttpStatus.CONFLICT,
    detail: `Only a draft declaration can be ${action}.`,
  });
}

/** 409: the statement's person was taken out of the household; it is kept, but not editable. */
export function sectionArchived(): ProblemException {
  return new ProblemException({
    type: 'section-archived',
    title: 'Section archived',
    status: HttpStatus.CONFLICT,
    detail: 'This person was removed from the household; add them back to edit it.',
  });
}

/** 412: the draft was saved elsewhere since the client read it (`If-Match`). */
export function versionMismatch(): ProblemException {
  return new ProblemException({
    type: 'draft-version-mismatch',
    title: 'Draft changed elsewhere',
    status: HttpStatus.PRECONDITION_FAILED,
    detail: 'The draft was saved from somewhere else since you read it. Reload to continue.',
  });
}

/** 400 with the fields at fault. */
export function validationProblem(errors: { path: string; message: string }[]): ProblemException {
  return new ProblemException({
    type: 'about:blank',
    title: 'Validation failed',
    status: HttpStatus.BAD_REQUEST,
    errors,
  });
}

/** The unique constraint a failed query violated, looking through Drizzle's error wrapper. */
export function violatedUniqueConstraint(error: unknown): string | undefined {
  for (let cause = error; cause instanceof Error; cause = cause.cause) {
    if ('code' in cause && cause.code === '23505' && 'constraint' in cause) {
      return typeof cause.constraint === 'string' ? cause.constraint : undefined;
    }
  }
  return undefined;
}
