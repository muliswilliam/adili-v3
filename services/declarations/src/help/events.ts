import { PLATFORM_TENANT } from '@adili/api-kit';
import type { NewEvent } from '@adili/events';

/**
 * Events of the help module (spec 11). Identifiers only: no title or body. The `tenant`
 * extension is the Commission's slug, or `platform` for a platform article.
 */

export const HELP_ARTICLE_PUBLISHED = 'help.article.published.v1';

export interface HelpArticlePublishedData extends Record<string, unknown> {
  articleId: string;
  /** The Commission's slug; null for a platform article. */
  tenant: string | null;
}

/** An article became published: it now reaches help search (and the assistant). */
export function helpArticlePublished(
  data: HelpArticlePublishedData,
): NewEvent<HelpArticlePublishedData> {
  return {
    type: HELP_ARTICLE_PUBLISHED,
    subject: data.articleId,
    tenant: data.tenant ?? PLATFORM_TENANT,
    data,
  };
}

export const HELP_ARTICLE_CREATED = 'help.article.created.v1';
export const HELP_ARTICLE_UPDATED = 'help.article.updated.v1';
export const HELP_ARTICLE_DELETED = 'help.article.deleted.v1';

/**
 * A write to an article: the audit record of the create, update or delete (ADR-008), with the
 * version it produced and whether it is published after it. Ids only, never the title or body.
 */
export interface HelpArticleWrittenData extends Record<string, unknown> {
  articleId: string;
  /** The Commission's slug; null for a platform article. */
  tenant: string | null;
  /** The article's version after the write; for a delete, the version deleted. */
  version: number;
  published: boolean;
  /** The subject of the administrator who wrote it. */
  by: string;
}

function articleEvent(
  type: string,
  data: HelpArticleWrittenData,
): NewEvent<HelpArticleWrittenData> {
  return { type, subject: data.articleId, tenant: data.tenant ?? PLATFORM_TENANT, data };
}

export function helpArticleCreated(data: HelpArticleWrittenData): NewEvent<HelpArticleWrittenData> {
  return articleEvent(HELP_ARTICLE_CREATED, data);
}

export function helpArticleUpdated(data: HelpArticleWrittenData): NewEvent<HelpArticleWrittenData> {
  return articleEvent(HELP_ARTICLE_UPDATED, data);
}

export function helpArticleDeleted(data: HelpArticleWrittenData): NewEvent<HelpArticleWrittenData> {
  return articleEvent(HELP_ARTICLE_DELETED, data);
}

export const CORPUS_IMPORTED = 'help.corpus.imported.v1';

/** What started a corpus import: `db:migrate`, the service's boot, or a platform admin's request. */
export type CorpusImportTrigger = 'migrate' | 'boot' | 'request';

/**
 * An import that changed the statutory corpus (ADR-008); an import of the version already stored
 * changes nothing and records nothing. Filed under the platform: the corpus has no tenant.
 */
export interface CorpusImportedData extends Record<string, unknown> {
  /** The corpus version imported: the hash of the corpus files. */
  version: string;
  inserted: number;
  updated: number;
  removed: number;
  trigger: CorpusImportTrigger;
  /** The subject of the platform admin who asked for it; null for `migrate` and `boot`. */
  by: string | null;
}

export function corpusImported(data: CorpusImportedData): NewEvent<CorpusImportedData> {
  return { type: CORPUS_IMPORTED, subject: data.version, tenant: PLATFORM_TENANT, data };
}
