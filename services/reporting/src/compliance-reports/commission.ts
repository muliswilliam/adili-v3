import { HttpStatus } from '@nestjs/common';
import { ProblemException } from '@adili/api-kit';

import {
  type CommissionFacts,
  type DirectoryClient,
  DirectoryUnavailable,
} from '../directory/directory-client.js';

/** The Commission as Part I names it; 503 while the directory cannot be reached. */
export async function commissionOf(
  directory: DirectoryClient,
  tenant: string,
): Promise<CommissionFacts> {
  try {
    return await directory.getCommission(tenant);
  } catch (error) {
    if (!(error instanceof DirectoryUnavailable)) throw error;
    throw new ProblemException({
      type: 'directory-unavailable',
      title: 'Upstream service unavailable',
      status: HttpStatus.SERVICE_UNAVAILABLE,
      detail: 'The Commission directory cannot be reached. Try again shortly.',
    });
  }
}
