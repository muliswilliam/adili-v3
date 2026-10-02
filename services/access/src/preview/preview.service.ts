import { Inject, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, type ReadAudit } from '@adili/api-kit';
import { DATABASE, withTenant } from '@adili/data-access';
import { eq } from 'drizzle-orm';

import { ownCommissionTenant } from '../access.js';
import type { AccessDatabase } from '../db/database.js';
import {
  DeclarationsClient,
  DeclarationsUnavailable,
} from '../declarations/declarations-client.js';
import { leaRequests } from '../lea/schema.js';
import { problem, upstreamUnavailable } from '../problems.js';
import { accessRequests } from '../requests/schema.js';
import { ReviewClient, ReviewUnavailable } from '../review/review-client.js';
import { isWithinScope, type Scope } from '../scope.js';
import type { ScopePreview } from './representation.js';

/** What a preview counts for: a resolved request, its declarant and the provision it rests on. */
interface PreviewTarget {
  tenant: string;
  reference: string;
  legalBasis: 'act-s36-1' | 'act-s36-2';
  /** The declarant's person; null when the officer resolved to has no account. */
  personId: string | null;
  requested: Scope;
}

/**
 * The scope preview (spec 10, decision 1): before deciding a Form K or law enforcement request,
 * the Commission's access officer (or, reading, its supervisor) sees what the requested scope, or
 * a narrower one they are weighing, holds of the declarant's declarations: per year, section and
 * included household member kind, and the clarifications, in counts only. Declarations and review
 * count (each audits it with the legal basis and the reference); the preview itself is audited
 * here alike. An empty preview means a grant issues the nil letter.
 */
@Injectable()
export class PreviewService {
  constructor(
    @Inject(DATABASE) private readonly db: AccessDatabase,
    private readonly declarations: DeclarationsClient,
    private readonly review: ReviewClient,
  ) {}

  /** A Form K request's preview: of the requested scope, or `scope` within it. */
  async formK(
    principal: Principal,
    requestId: string,
    scope: Scope | null,
    audit: ReadAudit,
  ): Promise<ScopePreview> {
    const tenant = ownCommissionTenant(principal);
    const row = notFoundIfInvisible(
      await withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
        const [found] = await tx
          .select()
          .from(accessRequests)
          .where(eq(accessRequests.id, requestId));
        return found;
      }),
    );
    if (row.status === 'granted' || row.status === 'partially-granted' || row.status === 'denied') {
      throw problem('request-decided', 'The request is decided: there is nothing left to preview.');
    }
    if (row.status === 'withdrawn' || row.status === 'cannot-identify') {
      throw problem('request-closed', 'The request is closed.');
    }
    if (row.resolvedRosterRecordId === null) {
      throw problem(
        'not-under-decision',
        'The officer named is not identified yet: there is no declarant to preview.',
      );
    }
    return this.preview(
      principal,
      {
        tenant,
        reference: row.reference,
        legalBasis: 'act-s36-1',
        personId: row.resolvedPersonId,
        requested: row.scope,
      },
      scope,
      audit,
    );
  }

  /**
   * A law enforcement request's preview, once verified (the officer sought identified). Its scope
   * never includes clarifications, so a scope that does exceeds the request.
   */
  async lea(
    principal: Principal,
    requestId: string,
    scope: Scope | null,
    audit: ReadAudit,
  ): Promise<ScopePreview> {
    const tenant = ownCommissionTenant(principal);
    const row = notFoundIfInvisible(
      await withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
        const [found] = await tx.select().from(leaRequests).where(eq(leaRequests.id, requestId));
        return found;
      }),
    );
    if (row.status === 'granted' || row.status === 'denied') {
      throw problem('request-decided', 'The request is decided: there is nothing left to preview.');
    }
    if (row.status === 'withdrawn') throw problem('request-closed', 'The request is closed.');
    if (row.status !== 'verified' || row.resolvedRosterRecordId === null) {
      throw problem(
        'not-under-decision',
        'The request is not verified yet: there is no declarant to preview.',
      );
    }
    return this.preview(
      principal,
      {
        tenant,
        reference: row.reference,
        legalBasis: 'act-s36-2',
        personId: row.resolvedPersonId,
        requested: row.scope,
      },
      scope,
      audit,
    );
  }

  private async preview(
    principal: Principal,
    target: PreviewTarget,
    asked: Scope | null,
    audit: ReadAudit,
  ): Promise<ScopePreview> {
    const scope = asked ?? target.requested;
    if (!isWithinScope(scope, target.requested)) {
      throw problem(
        'scope-exceeds-request',
        'The scope asks for a year, section, household member or clarifications the request did not.',
      );
    }
    audit.resource({ tenant: target.tenant, subjectPersonId: target.personId });
    audit.disclosure({
      basis: target.legalBasis,
      reference: target.reference,
      recipient: principal.subject,
    });

    const years = [...new Set(scope.years)].sort((a, b) => a - b);
    const sections = [...new Set(scope.sections)];
    const withClarifications = scope.includeClarifications;
    if (target.personId === null) {
      return previewOf(
        scope,
        false,
        withClarifications,
        years.map((year) => ({
          year,
          declarations: 0,
          sections: Object.fromEntries(sections.map((section) => [section, 0])),
          spouses: scope.includeSpouses ? 0 : null,
          children: scope.includeChildren ? 0 : null,
          clarifications: withClarifications ? 0 : null,
        })),
      );
    }

    const asking = {
      personId: target.personId,
      tenant: target.tenant,
      viewerSubject: principal.subject,
      grantReference: target.reference,
      legalBasis: target.legalBasis,
      includeSpouses: scope.includeSpouses,
      includeChildren: scope.includeChildren,
      sections,
    };
    let counted;
    try {
      counted = await this.declarations.countDisclosure({ ...asking, years });
    } catch (error) {
      if (error instanceof DeclarationsUnavailable) {
        throw upstreamUnavailable(
          'declarations-unavailable',
          "The declarant's declarations cannot be counted right now. Try again shortly.",
        );
      }
      throw error;
    }
    const references = counted.years.flatMap((year) => year.declarationReferences);
    const clarificationsOf = new Map<string, number>();
    if (withClarifications && references.length > 0) {
      try {
        const counts = await this.review.countClarifications({
          ...asking,
          legalBasis: 'act-s36-1',
          declarationReferences: references,
        });
        for (const each of counts)
          clarificationsOf.set(each.declarationReference, each.clarifications);
      } catch (error) {
        if (error instanceof ReviewUnavailable) {
          throw upstreamUnavailable(
            'review-unavailable',
            "The declarant's clarifications cannot be counted right now. Try again shortly.",
          );
        }
        throw error;
      }
    }
    return previewOf(
      scope,
      true,
      withClarifications,
      counted.years.map((year) => ({
        year: year.year,
        declarations: year.declarations,
        sections: year.sections,
        spouses: year.spouses,
        children: year.children,
        clarifications: withClarifications
          ? year.declarationReferences.reduce(
              (sum, reference) => sum + (clarificationsOf.get(reference) ?? 0),
              0,
            )
          : null,
      })),
    );
  }
}

function previewOf(
  scope: Scope,
  declarantOnboarded: boolean,
  withClarifications: boolean,
  years: ScopePreview['years'],
): ScopePreview {
  const declarations = years.reduce((sum, year) => sum + year.declarations, 0);
  return {
    scope,
    declarantOnboarded,
    empty: declarations === 0,
    declarations,
    clarifications: withClarifications
      ? years.reduce((sum, year) => sum + (year.clarifications ?? 0), 0)
      : null,
    years,
  };
}
