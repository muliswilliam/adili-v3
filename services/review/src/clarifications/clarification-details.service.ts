import { Injectable } from '@nestjs/common';
import { type Database, InjectDatabase, type TenantContext, withTenant } from '@adili/data-access';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { clarifications, reviewCases } from '../cases/schema.js';
import type { ReviewSchema } from '../db/schema.js';
import { REQUIREMENT_LABELS } from './labels.js';
import type { ClarificationDetails } from './representation.js';

/**
 * A Commission's clarifications as the reporting service lists them in Form M section 4 (spec 09
 * #220): the officer asked and the kinds of requirement asked for, in general terms, never the
 * request's text. A clarification the Commission does not hold is left out.
 */
@Injectable()
export class ClarificationDetailsService {
  constructor(@InjectDatabase() private readonly db: Database<ReviewSchema>) {}

  async details(
    read: TenantContext,
    clarificationIds: string[],
  ): Promise<{ items: ClarificationDetails[] }> {
    const rows = await withTenant(this.db, read, (tx) =>
      tx
        .select({
          clarificationId: clarifications.id,
          reference: clarifications.reference,
          items: clarifications.items,
          name: reviewCases.declarantName,
          designation: reviewCases.designation,
          identifier: reviewCases.personnelFileNumber,
        })
        .from(clarifications)
        .innerJoin(reviewCases, eq(reviewCases.id, clarifications.caseId))
        .where(
          and(inArray(clarifications.id, clarificationIds), eq(clarifications.tenant, read.tenant)),
        )
        .orderBy(asc(clarifications.id)),
    );
    return {
      items: rows.map(({ items, designation, ...row }) => ({
        ...row,
        designation: designation ?? '',
        requirementLabels: [...new Set(items.map((item) => REQUIREMENT_LABELS[item.requirement]))],
      })),
    };
  }
}
