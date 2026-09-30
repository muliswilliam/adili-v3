import { PLATFORM_TENANT } from '@adili/api-kit';
import { Injectable } from '@nestjs/common';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { asc, eq } from 'drizzle-orm';

import { Clock } from '../../clock.js';
import { commissions } from '../../commissions/schema.js';
import type { DirectorySchema } from '../../db/schema.js';
import type { ListOnboardingCommissionsQuery, OnboardingCommission } from '../representation.js';
import { ONBOARDING_SUBJECT } from '../sessions.repository.js';
import { selectOnboardingCommissions, toOnboardingCommission } from './onboarding-commission.js';

/** How long a replica serves the Commission list before reading it again. */
export const COMMISSION_LIST_TTL_MS = 60 * 1000;

/**
 * The public Commission list of the onboarding flow: every active Commission with whether it
 * has imported a roster, ordered by name. The list is small (about 160) and read on every
 * visit, so each replica keeps it for a minute (by the module clock) and searches it in memory.
 */
@Injectable()
export class OnboardingCommissionsService {
  private cached: { list: OnboardingCommission[]; until: number } | undefined;

  constructor(
    @InjectDatabase() private readonly db: Database<DirectorySchema>,
    private readonly clock: Clock,
  ) {}

  async list({ search }: ListOnboardingCommissionsQuery): Promise<OnboardingCommission[]> {
    const list = await this.all();
    if (!search) return list;
    const needle = search.toLowerCase();
    return list.filter(
      (commission) =>
        commission.name.toLowerCase().includes(needle) ||
        commission.issuerCode.toLowerCase() === needle,
    );
  }

  private async all(): Promise<OnboardingCommission[]> {
    const now = this.clock.now().getTime();
    if (this.cached && this.cached.until > now) return this.cached.list;
    const rows = await withTenant(
      this.db,
      { tenant: PLATFORM_TENANT, subject: ONBOARDING_SUBJECT },
      (tx) =>
        selectOnboardingCommissions(tx)
          .where(eq(commissions.status, 'active'))
          .orderBy(asc(commissions.name)),
    );
    const list = rows.map(toOnboardingCommission);
    this.cached = { list, until: now + COMMISSION_LIST_TTL_MS };
    return list;
  }
}
