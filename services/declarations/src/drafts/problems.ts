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

/** A schema's issues as the fields at fault of a validation problem: each at its dotted path. */
export function fieldErrors(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): { path: string; message: string }[] {
  return issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
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

/** 409: no draft can be started for a filed or cancelled obligation, live draft or not. */
export function obligationClosed(status: string): ProblemException {
  return new ProblemException({
    type: 'obligation-closed',
    title: 'Obligation filed or cancelled',
    status: HttpStatus.CONFLICT,
    detail: `No declaration can be started for a ${status} obligation.`,
  });
}

/** 400: a statement category is declared nil and lists items (S8). */
export function nilConflictsWithItems(
  errors: { path: string; message: string }[],
): ProblemException {
  return new ProblemException({
    type: 'nil-conflicts-with-items',
    title: 'Nil conflicts with items',
    status: HttpStatus.BAD_REQUEST,
    detail: 'A category declared as having nothing to declare cannot list items.',
    errors,
  });
}

/** 400: a bio save changed fields the roster fills, given as JSON pointers. */
export function identityLockedField(pointers: string[]): ProblemException {
  return new ProblemException({
    type: 'identity-locked-field',
    title: 'Locked field changed',
    status: HttpStatus.BAD_REQUEST,
    detail:
      "Names, reporting entity, designation, personnel file number and Commission come from the Commission's roster and cannot be changed here.",
    errors: pointers.map((pointer) => ({
      path: pointer.slice(1).replaceAll('/', '.'),
      message: 'Comes from the roster; ask your Commission to correct it',
    })),
  });
}

/** 428: a section save without `If-Match`. */
export function ifMatchRequired(): ProblemException {
  return new ProblemException({
    type: 'if-match-required',
    title: 'If-Match required',
    status: HttpStatus.PRECONDITION_REQUIRED,
    detail: 'Send the draft version you read (its ETag) as If-Match.',
  });
}

/** 503: the roster record could not be read from the directory to pre-fill a new draft. */
export function directoryUnavailable(): ProblemException {
  return new ProblemException({
    type: 'directory-unavailable',
    title: 'Roster unavailable',
    status: HttpStatus.SERVICE_UNAVAILABLE,
    detail: 'The roster record could not be read to pre-fill the declaration. Try again.',
  });
}

/** 409: the upload is not one the caller may link (unknown, another Commission's or declarant's). */
export function uploadNotFound(uploadId: string): ProblemException {
  return new ProblemException({
    type: 'upload-not-found',
    title: 'Upload not found',
    status: HttpStatus.CONFLICT,
    detail: `There is no upload ${uploadId} for this Commission.`,
  });
}

/** 409: the upload has not passed its checks. */
export function uploadNotClean(): ProblemException {
  return new ProblemException({
    type: 'upload-not-clean',
    title: 'Upload not clean',
    status: HttpStatus.CONFLICT,
    detail:
      'This file has not passed the security scan (still scanning, infected or rejected) and was not attached.',
  });
}

/** 409: the upload was made for another purpose. */
export function uploadWrongPurpose(): ProblemException {
  return new ProblemException({
    type: 'upload-wrong-purpose',
    title: 'Not a declaration attachment',
    status: HttpStatus.CONFLICT,
    detail: 'This file was not uploaded as a declaration attachment.',
  });
}

/** 409: the upload is attached to an item already. */
export function uploadAlreadyLinked(): ProblemException {
  return new ProblemException({
    type: 'upload-already-linked',
    title: 'Upload already attached',
    status: HttpStatus.CONFLICT,
    detail: 'This file is already attached to an item. Upload it again to attach it here.',
  });
}

/** 503: documents did not answer, so the file could not be `checked`, `attached` or `read`. */
export function documentsUnavailable(action: 'checked' | 'attached' | 'read'): ProblemException {
  return new ProblemException({
    type: 'documents-unavailable',
    title: 'Documents unavailable',
    status: HttpStatus.SERVICE_UNAVAILABLE,
    detail: `The file could not be ${action}. Try again.`,
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

/** 503: the ai-gateway did not take a document reading (spec 05b); nothing was recorded. */
export function aiGatewayUnavailable(): ProblemException {
  return new ProblemException({
    type: 'ai-gateway-unavailable',
    title: 'Document reading unavailable',
    status: HttpStatus.SERVICE_UNAVAILABLE,
    detail: 'The document could not be sent to be read. Try again.',
  });
}
