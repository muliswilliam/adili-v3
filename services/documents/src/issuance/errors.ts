import { HttpStatus } from '@nestjs/common';
import { ProblemException } from '@adili/api-kit';

/**
 * The services issuance depends on: Gotenberg, OpenBao, object storage, and the review service
 * a letter's payload is pulled from.
 */
export type IssuanceDependency = 'renderer' | 'signer' | 'storage' | 'review';

/** A dependency failed or did not answer in time; nothing was registered. */
export class IssuanceDependencyUnavailable extends Error {
  constructor(
    readonly dependency: IssuanceDependency,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'IssuanceDependencyUnavailable';
  }
}

const DETAIL: Record<IssuanceDependency, string> = {
  renderer: 'The PDF renderer is unavailable.',
  signer: 'The signing service is unavailable.',
  storage: 'Document storage is unavailable.',
  review: "The review service, which holds the letter's fields, is unavailable.",
};

const OUTCOME = {
  issue: { title: 'Document could not be issued', detail: 'Nothing was issued' },
  statusChange: { title: 'Document status could not be changed', detail: 'Nothing changed' },
} as const;

/**
 * 502 for callers: the dependency by name, never its error. Nothing was issued (or, for a
 * supersede or revoke, changed); retry later.
 */
export function dependencyProblem(
  error: IssuanceDependencyUnavailable,
  during: keyof typeof OUTCOME = 'issue',
): ProblemException {
  return new ProblemException({
    type: `${error.dependency}-unavailable`,
    title: OUTCOME[during].title,
    status: HttpStatus.BAD_GATEWAY,
    detail: `${DETAIL[error.dependency]} ${OUTCOME[during].detail}; try again.`,
  });
}
