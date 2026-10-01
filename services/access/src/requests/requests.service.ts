import { Inject, Injectable } from '@nestjs/common';
import { PLATFORM_TENANT, type Principal } from '@adili/api-kit';
import { DATABASE, FieldCipher, withTenant } from '@adili/data-access';
import type { AccessRequestReceivedData } from '@adili/events/contracts';
import { validateFormK } from '@adili/forms';
import { allocateReference, ARQ } from '@adili/numbering';
import { v7 as uuidv7 } from 'uuid';

import { applicantPersonId } from '../access.js';
import { addDays, Clock, nairobiYear } from '../clock.js';
import { config } from '../config.js';
import type { AccessDatabase } from '../db/database.js';
import {
  type CommissionFacts,
  DirectoryClient,
  DirectoryUnavailable,
} from '../directory/directory-client.js';
import { badRequest, directoryUnavailable } from '../problems.js';
import { AccessRegister } from '../register/access-register.js';
import { toRegisterEntry } from '../register/representation.js';
import { sealFormK, withoutMeta } from './form-k.js';
import { type AccessRequest, toAccessRequest } from './representation.js';
import { accessRequests } from './schema.js';

/**
 * Form K access requests (spec 10, Act s.36(1), Regs r.22): what applicants file and read.
 */
@Injectable()
export class RequestsService {
  constructor(
    @Inject(DATABASE) private readonly db: AccessDatabase,
    private readonly directory: DirectoryClient,
    private readonly cipher: FieldCipher,
    private readonly register: AccessRegister,
    private readonly clock: Clock,
  ) {}

  /**
   * Receives a Form K (S2): validates it against `form-k.v1` (400 with the paths at fault),
   * allocates its `ARQ` reference at receipt (the acknowledgement is the legal act of receipt)
   * and stores it `submitted` with the encrypted document, the `received` register entry and its
   * event, all in one transaction of the Commission's context.
   */
  async submit(principal: Principal, body: unknown): Promise<AccessRequest> {
    const personId = applicantPersonId(principal);
    const validated = validateFormK(body);
    if (!validated.ok) {
      throw badRequest('The document is not a valid Form K.', validated.errors);
    }
    const formK = withoutMeta(validated.value);
    const commission = await this.commission(formK.responsibleCommission);

    const id = uuidv7();
    const now = this.clock.now();
    const decisionDeadlineAt = addDays(now, config.ACCESS_DECISION_DAYS);
    // Sealed before the transaction: the reference counter stays locked only for the inserts.
    const sealed = await sealFormK(this.cipher, commission.slug, id, formK);
    const applicant = { subject: principal.subject, name: formK.partI.name };

    const { row, entry } = await withTenant(
      this.db,
      { tenant: commission.slug, subject: principal.subject },
      async (tx) => {
        const reference = await allocateReference(tx, ARQ, {
          issuer: commission.issuerCode,
          period: nairobiYear(now),
        });
        const [inserted] = await tx
          .insert(accessRequests)
          .values({
            id,
            tenant: commission.slug,
            commissionName: commission.name,
            reference,
            applicantPersonId: personId,
            applicantSubject: principal.subject,
            applicantName: formK.partI.name,
            // Passport applicants pending manual verification are held from #250 on.
            applicantIdentityStatus: 'verified',
            ...sealed,
            officerSought: {
              name: formK.partII.name,
              entity: formK.partII.entity,
              workStation: formK.partII.workStation,
              ...(formK.partII.personnelFileNumber === undefined
                ? {}
                : { personnelFileNumber: formK.partII.personnelFileNumber }),
            },
            scope: formK.scope,
            status: 'submitted',
            submittedAt: now,
            decisionDeadlineAt,
          })
          .returning();
        if (!inserted) throw new Error('The access request was not written');
        const eventData = {
          decisionDeadlineAt: decisionDeadlineAt.toISOString(),
        } satisfies Pick<AccessRequestReceivedData, 'decisionDeadlineAt'>;
        const received = await this.register.record(tx, {
          tenant: commission.slug,
          subjectKind: 'access-request',
          subjectId: id,
          reference,
          personId: null,
          kind: 'received',
          actor: applicant,
          at: now,
          eventData,
        });
        return { row: inserted, entry: received };
      },
    );

    return toAccessRequest(
      row,
      { ...formK, meta: { reference: row.reference, submittedAt: row.submittedAt.toISOString() } },
      [toRegisterEntry(entry)],
    );
  }

  /** The Responsible Commission Form K names; 400 at `responsibleCommission` when there is none. */
  private async commission(slug: string): Promise<CommissionFacts> {
    const unknown = () =>
      badRequest('The document is not a valid Form K.', [
        { path: 'responsibleCommission', message: 'is not a Responsible Commission' },
      ]);
    if (slug === PLATFORM_TENANT) throw unknown();
    try {
      const commission = await this.directory.findCommission(slug);
      if (commission === null) throw unknown();
      return commission;
    } catch (error) {
      if (error instanceof DirectoryUnavailable) throw directoryUnavailable();
      throw error;
    }
  }
}
