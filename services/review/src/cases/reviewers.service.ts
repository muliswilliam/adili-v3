import { Injectable } from '@nestjs/common';
import { type Principal } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { REVIEWER, SUPERVISOR } from '@adili/roles';
import { and, count, eq, isNotNull, ne } from 'drizzle-orm';

import type { ReviewSchema } from '../db/schema.js';
import {
  DirectoryClient,
  DirectoryUnavailable,
  type StaffMember,
} from '../directory/directory-client.js';
import { upstreamUnavailable } from '../internal-api/upstream.js';
import { queueTenant, requireSupervisor } from './access.js';
import type { ReviewerList } from './representation.js';
import { reviewCases } from './schema.js';

/**
 * The reviewers and supervisors of a Commission a supervisor can give a case to (spec 07a), as
 * the directory has its staff, each with the open cases they hold here: the reassign dialog and
 * the queue's assignee filter list them.
 */
@Injectable()
export class ReviewersService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly directory: DirectoryClient,
  ) {}

  async list(principal: Principal, slug: string): Promise<ReviewerList> {
    const tenant = queueTenant(principal, slug);
    requireSupervisor(principal);
    const [reviewers, supervisorStaff] = await this.staff(tenant);
    const held = await withTenant(this.db, { tenant, subject: principal.subject }, (tx) =>
      tx
        .select({ subject: reviewCases.assignee, count: count() })
        .from(reviewCases)
        .where(
          and(
            eq(reviewCases.tenant, tenant),
            isNotNull(reviewCases.assignee),
            ne(reviewCases.status, 'determined'),
          ),
        )
        .groupBy(reviewCases.assignee),
    );
    const open = new Map(held.map((row) => [row.subject, row.count]));
    const supervisors = new Set(supervisorStaff.map((member) => member.subject));
    const members = new Map(
      [...reviewers, ...supervisorStaff].map((member) => [member.subject, member]),
    );
    return {
      items: [...members.values()]
        .map(({ subject, name }) => ({
          subject,
          name,
          supervisor: supervisors.has(subject),
          openCases: open.get(subject) ?? 0,
        }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.subject.localeCompare(b.subject)),
    };
  }

  /** The Commission's reviewers and its supervisors; a directory outage is a 502. */
  private async staff(tenant: string): Promise<[StaffMember[], StaffMember[]]> {
    try {
      return await Promise.all([
        this.directory.listStaff(tenant, REVIEWER),
        this.directory.listStaff(tenant, SUPERVISOR),
      ]);
    } catch (error) {
      if (error instanceof DirectoryUnavailable) {
        throw upstreamUnavailable(
          'directory',
          "The Commission's reviewers could not be read from the directory. Try again shortly.",
        );
      }
      throw error;
    }
  }
}
