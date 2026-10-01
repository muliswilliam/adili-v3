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
