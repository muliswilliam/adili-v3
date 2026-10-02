import { PLATFORM_TENANT } from '@adili/api-kit';
import { LAW_ENFORCEMENT_TENANT } from '@adili/roles';

import {
  type AccessPolicy,
  type CommissionFacts,
  DirectoryClient,
  DirectoryUnavailable,
} from '../directory/directory-client.js';
import { directoryUnavailable } from '../problems.js';

/**
 * The active Commission `slug` names, as the directory holds it: what a request or a certified
 * copy is addressed to. `unknown()` (the caller's problem: 400 at its field, or 404) when the
 * directory has no such Commission, or for the reserved tenant keys `platform` and `lea` (the
 * row-level security contexts of cross-tenant work and of law enforcement officers), which are no
 * Commission; 503
 * `directory-unavailable` when the directory cannot be reached.
 */
export async function responsibleCommission(
  directory: DirectoryClient,
  slug: string,
  unknown: () => Error,
): Promise<CommissionFacts> {
  if (slug === PLATFORM_TENANT || slug === LAW_ENFORCEMENT_TENANT) throw unknown();
  let commission;
  try {
    commission = await directory.findCommission(slug);
  } catch (error) {
    if (error instanceof DirectoryUnavailable) throw directoryUnavailable();
    throw error;
  }
  if (commission === null) throw unknown();
  return commission;
}

/**
 * The access periods of the Commission's policy in force (spec 10, user decision 3), read as a
 * request's clock starts; 503 `directory-unavailable` when the directory cannot be reached.
 */
export async function accessPolicyOf(
  directory: DirectoryClient,
  slug: string,
): Promise<AccessPolicy> {
  try {
    return await directory.accessPolicy(slug);
  } catch (error) {
    if (error instanceof DirectoryUnavailable) throw directoryUnavailable();
    throw error;
  }
}
