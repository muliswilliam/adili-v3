import { Inject, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, PLATFORM_TENANT, type Principal } from '@adili/api-kit';
import { DATABASE, withPerson, withTenant } from '@adili/data-access';
import { and, desc, eq } from 'drizzle-orm';

import { declarantPersonId } from '../access.js';
import { Clock } from '../clock.js';
import type { AccessDatabase } from '../db/database.js';
import { DirectoryClient, DirectoryUnavailable } from '../directory/directory-client.js';
import { directoryUnavailable, notFound } from '../problems.js';
import { CertifiedCopyIssuance } from './certified-copy-issuance.js';
import {
  type CertifiedCopy,
  type CertifiedCopyRequest,
  toCertifiedCopy,
} from './representation.js';
import { certifiedCopies } from './schema.js';

/**
 * A declarant's certified copies of their own submitted versions (spec 10 S13, Administrative
 * Mechanism 32): asked for in the portal, issued by `CertifiedCopyWorkflow`, read through the
 * person axis (someone else's copy is 404).
 */
@Injectable()
export class CertifiedCopiesService {
  constructor(
    @Inject(DATABASE) private readonly db: AccessDatabase,
    private readonly directory: DirectoryClient,
    private readonly issuance: CertifiedCopyIssuance,
    private readonly clock: Clock,
  ) {}

  /**
   * Orders a certified copy of the declarant's version at the Commission it was filed with: the
   * copy is `pending` until the workflow has it issued, or `failed` if declarations has no such
   * submitted version of theirs. Asking again returns the same copy (a failed one tried again).
   * An unknown Commission is 404; the directory unreachable is 503.
   */
  async request(principal: Principal, input: CertifiedCopyRequest): Promise<CertifiedCopy> {
    const personId = declarantPersonId(principal);
    const commission = await this.commission(input.commission);
    const copy = await withTenant(
      this.db,
      { tenant: commission.slug, subject: principal.subject },
      (tx) =>
        this.issuance.order(tx, {
          tenant: commission.slug,
          commissionName: commission.name,
          personId,
          declarationId: input.declarationId,
          version: input.version,
          requestedBy: { subject: principal.subject, name: principal.name },
          applicationId: null,
          at: this.clock.now(),
        }),
    );
    return toCertifiedCopy(copy);
  }

  /** The declarant's certified copies, latest asked for first, whichever way they were asked. */
  async list(principal: Principal): Promise<CertifiedCopy[]> {
    const personId = declarantPersonId(principal);
    const rows = await withPerson(this.db, { personId, subject: principal.subject }, (tx) =>
      tx
        .select()
        .from(certifiedCopies)
        .where(eq(certifiedCopies.personId, personId))
        .orderBy(desc(certifiedCopies.requestedAt), desc(certifiedCopies.id)),
    );
    return rows.map(toCertifiedCopy);
  }

  /** One of the declarant's certified copies; anyone else's is 404. */
  async get(principal: Principal, copyId: string): Promise<CertifiedCopy> {
    const personId = declarantPersonId(principal);
    const [row] = await withPerson(this.db, { personId, subject: principal.subject }, (tx) =>
      tx
        .select()
        .from(certifiedCopies)
        .where(and(eq(certifiedCopies.id, copyId), eq(certifiedCopies.personId, personId))),
    );
    return toCertifiedCopy(notFoundIfInvisible(row));
  }

  private async commission(slug: string): Promise<{ slug: string; name: string }> {
    if (slug === PLATFORM_TENANT) throw notFound();
    let commission;
    try {
      commission = await this.directory.findCommission(slug);
    } catch (error) {
      if (error instanceof DirectoryUnavailable) throw directoryUnavailable();
      throw error;
    }
    if (commission === null) throw notFound();
    return commission;
  }
}
