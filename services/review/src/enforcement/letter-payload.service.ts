import { Injectable } from '@nestjs/common';
import { notFoundIfInvisible } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { and, eq, isNotNull } from 'drizzle-orm';

import type { ReviewSchema } from '../db/schema.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { withUpstream } from '../internal-api/upstream.js';
import { systemContext } from '../system-context.js';
import { portalNoticeUrl } from './activities.js';
import { STEP_LABELS, whatToDo } from './ladder-records.js';
import type { ActionLetterPayload } from './representation.js';
import { administrativeActions, enforcementLadders } from './schema.js';

/**
 * The letter payload the documents service pulls when it renders a step's letter
 * (`internalGetActionLetterPayload`): what the declarant failed to do, what to do and by when,
 * and where to respond. Template fields only, of an approved step whose letter is being issued.
 */
@Injectable()
export class ActionLetterPayloadService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly directory: DirectoryClient,
  ) {}

  async payload(tenant: string, actionId: string): Promise<ActionLetterPayload> {
    const [found] = await withTenant(this.db, systemContext(tenant), (tx) =>
      tx
        .select({ action: administrativeActions, ladder: enforcementLadders })
        .from(administrativeActions)
        .innerJoin(enforcementLadders, eq(enforcementLadders.id, administrativeActions.ladderId))
        .where(
          and(
            eq(administrativeActions.id, actionId),
            isNotNull(administrativeActions.reference),
            isNotNull(administrativeActions.issuedAt),
          ),
        ),
    );
    const { action, ladder } = notFoundIfInvisible(found);
    if (action.reference === null || action.issuedAt === null) {
      throw new Error(`Action ${actionId} is issued without a reference`);
    }
    const commission = await withUpstream(() => this.directory.getCommission(tenant));
    return {
      declarantPersonId: action.personId,
      declarantName: ladder.declarantName,
      personnelFileNumber: ladder.personnelFileNumber,
      commission: { name: commission.name, issuerCode: commission.issuerCode },
      reference: action.reference,
      step: action.step,
      stepLabel: STEP_LABELS[action.step],
      subjectKind: ladder.subjectKind,
      subjectReference: ladder.subjectReference,
      whatToDo: whatToDo(ladder),
      issuedAt: action.issuedAt.toISOString(),
      actBy: action.windowEndsAt?.toISOString() ?? null,
      salaryStoppedFrom: action.salaryStopEffectiveDate,
      respondUrl: portalNoticeUrl(actionId),
    };
  }
}
