import {
  type CommissionFacts,
  type DirectoryClient,
  DirectoryUnavailable,
} from '../directory/directory-client.js';
import { directoryUnavailable } from '../problems.js';

/** The Commission as Part I names it; 503 while the directory cannot be reached. */
export async function commissionOf(
  directory: DirectoryClient,
  tenant: string,
): Promise<CommissionFacts> {
  try {
    return await directory.getCommission(tenant);
  } catch (error) {
    if (!(error instanceof DirectoryUnavailable)) throw error;
    throw directoryUnavailable();
  }
}

/** Every active Commission; 503 while the directory cannot be reached. */
export async function activeCommissions(directory: DirectoryClient): Promise<CommissionFacts[]> {
  try {
    return await directory.listCommissions();
  } catch (error) {
    if (!(error instanceof DirectoryUnavailable)) throw error;
    throw directoryUnavailable();
  }
}
