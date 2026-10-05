import { Injectable } from '@nestjs/common';
import { notFoundIfInvisible, PLATFORM_TENANT, type Principal } from '@adili/api-kit';
import { type Database, InjectDatabase, withPerson, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { and, asc, desc, eq, isNull, type SQL } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { Clock } from '../clock.js';
import type { DeclarationsSchema } from '../db/schema.js';
import type { Transaction } from '../db/transaction.js';
import { personOf } from '../drafts/access.js';
import { validationProblem } from '../drafts/problems.js';
import { isSectionKey, sectionKind } from '../drafts/sections.js';
import { isUuid } from '../guards.js';
import { nairobiDate } from '../obligations/dates.js';
import { articleEditTenant, articleReadTenant } from './access.js';
import type { CorpusTag } from './corpus.js';
import { CorpusImporter } from './corpus-importer.js';
import {
  helpArticleCreated,
  helpArticleDeleted,
  helpArticlePublished,
  helpArticleUpdated,
  type HelpArticleWrittenData,
} from './events.js';
import {
  type CorpusImportResult,
  type CorpusPassageView,
  type HelpArticle,
  type HelpArticleInput,
  helpArticleInputSchema,
  type HelpPassage,
  type HelpPassageDetail,
  type HelpPassageQuery,
  type HelpSearchQuery,
} from './representation.js';
import { passageById, retrieve } from './retrieval.js';
import { corpusPassages, helpArticles } from './schema.js';

type ArticleRow = typeof helpArticles.$inferSelect;

/** Whose articles a route works on: a Commission's (`tenant`), or the platform's (null). */
interface Owner {
  /** The RLS tenant of the transaction. */
  context: string;
  /** The articles' `tenant`: the Commission's slug, or null for platform articles. */
  tenant: string | null;
}

const platformOwner: Owner = { context: PLATFORM_TENANT, tenant: null };
const commissionOwner = (slug: string): Owner => ({ context: slug, tenant: slug });

/**
 * The help module (spec 11): search over the statutory corpus and help articles, Commission and
 * platform article authoring, and the corpus import.
 */
@Injectable()
export class HelpService {
  constructor(
    @InjectDatabase() private readonly db: Database<DeclarationsSchema>,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
    private readonly importer: CorpusImporter,
  ) {}

  /**
   * The passages in force that best answer a declarant's question: the law, the platform's
   * articles and those of the declarant's own Commissions (row-level security).
   */
  async search(principal: Principal, query: HelpSearchQuery): Promise<HelpPassage[]> {
    const person = personOf(principal);
    const boost: CorpusTag[] = [];
    // The query schema checked the key already; every section kind is a corpus tag, so this
    // compiles only while that holds.
    if (query.sectionKey && isSectionKey(query.sectionKey)) {
      boost.push(sectionKind(query.sectionKey) satisfies CorpusTag);
    }
    if (query.itemType) boost.push(query.itemType);
    const passages = await withPerson(this.db, person, (tx) =>
      retrieve(tx, {
        question: query.q,
        language: query.language,
        date: query.date ?? nairobiDate(this.clock.now()),
        boost,
        limit: query.limit,
      }),
    );
    return passages.map(({ id, source, citation, title, snippet, language }) => ({
      id,
      source,
      citation,
      title,
      snippet,
      language,
    }));
  }

  /**
   * One passage or article in full for the portal's help pages (#549), with help search's
   * visibility: the law, the platform's published articles and those of the declarant's own
   * Commissions, in force on `date` (today by default). Anything else is not found.
   */
  async passage(
    principal: Principal,
    passageId: string,
    query: HelpPassageQuery,
  ): Promise<HelpPassageDetail> {
    const person = personOf(principal);
    const found = await withPerson(this.db, person, (tx) =>
      passageById(tx, {
        id: passageId,
        language: query.language,
        date: query.date ?? nairobiDate(this.clock.now()),
      }),
    );
    const { tenant, commission, ...detail } = notFoundIfInvisible(found);
    // The read model holds every Commission (as `commissionOf` in disclosures): a gap is a
    // transient fault to retry, not a reason to hide the article.
    if (tenant !== null && commission === null) {
      throw new Error(`No Commission reference for ${tenant}`);
    }
    return { ...detail, commission };
  }

  listCommissionArticles(principal: Principal, slug: string): Promise<HelpArticle[]> {
    return this.list(principal, commissionOwner(articleReadTenant(principal, slug)));
  }

  createCommissionArticle(principal: Principal, slug: string, body: unknown): Promise<HelpArticle> {
    return this.create(principal, commissionOwner(articleEditTenant(principal, slug)), body);
  }

  updateCommissionArticle(
    principal: Principal,
    slug: string,
    articleId: string,
    body: unknown,
  ): Promise<HelpArticle> {
    return this.update(
      principal,
      commissionOwner(articleEditTenant(principal, slug)),
      articleId,
      body,
    );
  }

  deleteCommissionArticle(principal: Principal, slug: string, articleId: string): Promise<void> {
    return this.delete(principal, commissionOwner(articleEditTenant(principal, slug)), articleId);
  }

  listPlatformArticles(principal: Principal): Promise<HelpArticle[]> {
    return this.list(principal, platformOwner);
  }

  createPlatformArticle(principal: Principal, body: unknown): Promise<HelpArticle> {
    return this.create(principal, platformOwner, body);
  }

  updatePlatformArticle(
    principal: Principal,
    articleId: string,
    body: unknown,
  ): Promise<HelpArticle> {
    return this.update(principal, platformOwner, articleId, body);
  }

  deletePlatformArticle(principal: Principal, articleId: string): Promise<void> {
    return this.delete(principal, platformOwner, articleId);
  }

  /** Every stored wording of the statutory corpus, with its period and version. */
  async corpus(principal: Principal): Promise<CorpusPassageView[]> {
    const rows = await withTenant(
      this.db,
      { tenant: PLATFORM_TENANT, subject: principal.subject },
      (tx) =>
        tx
          .select({
            id: corpusPassages.id,
            source: corpusPassages.source,
            citation: corpusPassages.citation,
            title: corpusPassages.title,
            tags: corpusPassages.tags,
            effectiveFrom: corpusPassages.effectiveFrom,
            effectiveTo: corpusPassages.effectiveTo,
            version: corpusPassages.version,
          })
          .from(corpusPassages)
          .orderBy(
            asc(corpusPassages.source),
            asc(corpusPassages.citation),
            asc(corpusPassages.effectiveFrom),
          ),
    );
    return rows;
  }

  /** Re-imports the deployed corpus files; a no-op when they are the version already stored. */
  importCorpus(principal: Principal): Promise<CorpusImportResult> {
    return this.importer.run({ trigger: 'request', by: principal.subject });
  }

  private async list(principal: Principal, owner: Owner): Promise<HelpArticle[]> {
    const rows = await this.inTenant(owner, principal.subject, (tx) =>
      tx
        .select()
        .from(helpArticles)
        .where(ownedBy(owner))
        .orderBy(desc(helpArticles.updatedAt), asc(helpArticles.id)),
    );
    return rows.map(toArticle);
  }

  private async create(principal: Principal, owner: Owner, body: unknown): Promise<HelpArticle> {
    const input = parseArticle(body);
    const row = await this.inTenant(owner, principal.subject, async (tx) => {
      const [created] = await tx
        .insert(helpArticles)
        .values({ id: uuidv7(), tenant: owner.tenant, ...input, updatedBy: principal.subject })
        .returning();
      if (!created) throw new Error('insert returned no row');
      await this.events.record(tx, helpArticleCreated(written(created, principal)));
      if (created.published) {
        await this.events.record(
          tx,
          helpArticlePublished({ articleId: created.id, tenant: owner.tenant }),
        );
      }
      return created;
    });
    return toArticle(row);
  }

  private async update(
    principal: Principal,
    owner: Owner,
    articleId: string,
    body: unknown,
  ): Promise<HelpArticle> {
    const row = await this.inTenant(owner, principal.subject, async (tx) => {
      const current = notFoundIfInvisible(await findArticle(tx, owner, articleId));
      const input = parseArticle(body);
      const [updated] = await tx
        .update(helpArticles)
        .set({ ...input, version: current.version + 1, updatedBy: principal.subject })
        .where(eq(helpArticles.id, current.id))
        .returning();
      if (!updated) throw new Error('update returned no row');
      await this.events.record(tx, helpArticleUpdated(written(updated, principal)));
      if (updated.published && !current.published) {
        await this.events.record(
          tx,
          helpArticlePublished({ articleId: updated.id, tenant: owner.tenant }),
        );
      }
      return updated;
    });
    return toArticle(row);
  }

  private async delete(principal: Principal, owner: Owner, articleId: string): Promise<void> {
    await this.inTenant(owner, principal.subject, async (tx) => {
      const current = notFoundIfInvisible(await findArticle(tx, owner, articleId));
      await tx.delete(helpArticles).where(eq(helpArticles.id, current.id));
      await this.events.record(tx, helpArticleDeleted(written(current, principal)));
    });
  }

  private inTenant<T>(
    owner: Owner,
    subject: string,
    work: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    return withTenant(this.db, { tenant: owner.context, subject }, work);
  }
}

/** The owner's articles only: a Commission's transaction can also read published platform ones. */
function ownedBy(owner: Owner): SQL {
  return owner.tenant === null
    ? isNull(helpArticles.tenant)
    : eq(helpArticles.tenant, owner.tenant);
}

async function findArticle(
  tx: Transaction,
  owner: Owner,
  articleId: string,
): Promise<ArticleRow | undefined> {
  if (!isUuid(articleId)) return undefined;
  const [row] = await tx
    .select()
    .from(helpArticles)
    .where(and(eq(helpArticles.id, articleId), ownedBy(owner)))
    .for('update');
  return row;
}

/** The audit record of a write to `row` by `principal`: ids, version and published only. */
function written(row: ArticleRow, principal: Principal): HelpArticleWrittenData {
  return {
    articleId: row.id,
    tenant: row.tenant,
    version: row.version,
    published: row.published,
    by: principal.subject,
  };
}

function parseArticle(body: unknown): HelpArticleInput {
  const parsed = helpArticleInputSchema.safeParse(body);
  if (parsed.success) return parsed.data;
  throw validationProblem(
    parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  );
}

function toArticle(row: ArticleRow): HelpArticle {
  return {
    id: row.id,
    tenant: row.tenant,
    title: row.title,
    bodyEn: row.bodyEn,
    bodySw: row.bodySw,
    tags: row.tags,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    published: row.published,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}
