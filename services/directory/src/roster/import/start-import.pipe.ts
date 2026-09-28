import { HttpStatus } from '@nestjs/common';
import { ProblemException, ZodValidationPipe } from '@adili/api-kit';
import { ZodError } from 'zod';

import { type StartRosterImportBody, startRosterImportBody } from './representation.js';

/**
 * Validates `startRosterImport`'s body. Failures are 400 problem details as for any body, with
 * `rowIndex` added to errors about a row of a batch, so an HR system can point at the row.
 */
export class StartImportValidationPipe extends ZodValidationPipe<typeof startRosterImportBody> {
  constructor() {
    super(startRosterImportBody);
  }

  override transform(value: unknown): StartRosterImportBody {
    try {
      return super.transform(value);
    } catch (error) {
      if (!(error instanceof ZodError)) throw error;
      throw new ProblemException({
        type: 'about:blank',
        title: 'Validation failed',
        status: HttpStatus.BAD_REQUEST,
        errors: error.issues.map((issue) => {
          const [field, index] = issue.path;
          return {
            path: issue.path.join('.'),
            message: issue.message,
            ...(field === 'rows' && typeof index === 'number' ? { rowIndex: index } : {}),
          };
        }),
      });
    }
  }
}
