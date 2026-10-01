import { HttpStatus } from '@nestjs/common';
import { ProblemException } from '@adili/api-kit';

/** The services issuance depends on: Gotenberg, OpenBao, object storage. */
export type IssuanceDependency = 'renderer' | 'signer' | 'storage';

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
};

/** 502 for callers: the dependency by name, never its error. Nothing was issued; retry later. */
export function dependencyProblem(error: IssuanceDependencyUnavailable): ProblemException {
  return new ProblemException({
    type: `${error.dependency}-unavailable`,
    title: 'Document could not be issued',
    status: HttpStatus.BAD_GATEWAY,
    detail: `${DETAIL[error.dependency]} Nothing was issued; try again.`,
  });
}
