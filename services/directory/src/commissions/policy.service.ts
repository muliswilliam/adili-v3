import { Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, PLATFORM_TENANT } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { PLATFORM_ADMIN } from '@adili/roles';

import { Clock } from '../clock.js';
import type { DirectorySchema } from '../db/schema.js';
import { actingTenantContext } from '../internal-api.js';
import { canSeeCommission, ownTenantContext, tenantContextOf } from './access.js';
import type {
  CreateTenantPolicyVersionBody,
  TenantPolicyHistory,
  TenantPolicyVersion,
} from './policy-representation.js';
import { createPolicyVersion, readCurrentPolicy, readPolicyHistory } from './policy-versions.js';

/**
 * A Commission's policy (spec 04): staff read its versions with the Commission visibility rule,
 * its commission admin (or a platform admin) changes the obligations-start date, and services
 * pull the version in force. Anything outside the caller's view is 404.
 */
@Injectable()
export class PolicyService {
  constructor(
    @InjectDatabase() private readonly db: Database<DirectorySchema>,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
  ) {}

  async history(principal: Principal, slug: string): Promise<TenantPolicyHistory> {
    notFoundIfInvisible(slug, () => canSeeCommission(principal, slug));
    return withTenant(this.db, tenantContextOf(principal), (tx) => readPolicyHistory(tx, slug));
  }

  /**
   * A new version with `body`'s obligations-start date, in force now. Platform admins change any
   * Commission's; a commission admin (the controller admits no one else) only their own.
   */
  async createVersion(
    principal: Principal,
    slug: string,
    body: CreateTenantPolicyVersionBody,
  ): Promise<TenantPolicyVersion> {
    const context = principal.roles.includes(PLATFORM_ADMIN)
      ? { tenant: PLATFORM_TENANT, subject: principal.subject }
      : ownTenantContext(principal, slug);
    return withTenant(this.db, context, (tx) =>
      createPolicyVersion(tx, this.events, {
        tenant: slug,
        obligationsStartDate: body.obligationsStartDate,
        effectiveFrom: this.clock.now(),
        createdBy: principal.subject,
        createdByName: principal.name,
      }),
    );
  }

  /** The version in force, for a service acting for `tenant`. */
  async current(principal: Principal, tenant: string, slug: string): Promise<TenantPolicyVersion> {
    return withTenant(this.db, actingTenantContext(principal, tenant, slug), (tx) =>
      readCurrentPolicy(tx, slug),
    );
  }
}
