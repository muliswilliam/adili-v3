import { Injectable } from '@nestjs/common';
import type { Principal } from '@adili/api-kit';

import { IdentityProvisioning } from '../identity/identity-provisioning.js';
import { CommissionsService } from './commissions.service.js';
import type { InternalCommissionStaff, StaffRole } from './representation.js';

/**
 * A Commission's staff by role, for services that write to them (spec 09: the Form M reminders to
 * its supervisors and commission admins, the chase of a late report to its reporting officers;
 * spec 10: the reminders to its access officers): the enabled accounts holding the role with a
 * verified email, as the identity provider has them.
 */
@Injectable()
export class CommissionStaffService {
  constructor(
    private readonly commissions: CommissionsService,
    private readonly identity: IdentityProvisioning,
  ) {}

  /** The staff of Commission `slug` holding `role`; 404 when acting for another, or unknown. */
  async withRole(
    principal: Principal,
    tenant: string,
    slug: string,
    role: StaffRole,
  ): Promise<InternalCommissionStaff> {
    await this.commissions.internalRef(principal, tenant, slug);
    return { items: await this.identity.listStaffWithRole(slug, role) };
  }
}
