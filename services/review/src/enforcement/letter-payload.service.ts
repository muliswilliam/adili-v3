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
import {
  type ActionStep,
  administrativeActions,
  enforcementLadders,
  type SubjectKind,
} from './schema.js';

/** review.yaml `ActionLetterPayload`: the fields `notice-to-comply.v1` and `warning.v1` render. */
export interface ActionLetterPayload {
  declarantName: string;
  personnelFileNumber: string;
  commission: { name: string; issuerCode: string };
  reference: string;
  step: ActionStep;
  stepLabel: string;
  subjectKind: SubjectKind;
  subjectReference: string;
  whatToDo: 'file-declaration' | 'respond-to-clarification';
  issuedAt: string;
  actBy: string;
  respondUrl: string;
}

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
            isNotNull(administrativeActions.windowEndsAt),
          ),
        ),
    );
    const { action, ladder } = notFoundIfInvisible(found);
    if (action.reference === null || action.issuedAt === null || action.windowEndsAt === null) {
      throw new Error(`Action ${actionId} is issued without a reference or window`);
    }
    const commission = await withUpstream(() => this.directory.getCommission(tenant));
    return {
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
      actBy: action.windowEndsAt.toISOString(),
      respondUrl: portalNoticeUrl(actionId),
    };
  }
}
