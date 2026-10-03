import type {
  CorpusImportResult,
  CorpusPassage,
  CorpusPassageText,
  DeclarationsClient,
  HelpArticle,
  HelpArticleInput,
  HelpLanguage,
  HelpPassage,
  QuestionThemeCount,
} from './declarations/client';
import { callService, type ServiceResult, type ValidationProblem } from './service-call';

/**
 * The help pages' reads and writes against the declarations service (spec 11 FE-4): help
 * articles for a Commission's staff or for platform admins, the statutory corpus, the help search
 * as declarants get it, and the question themes. Pure: the caller injects the client (see
 * `help.ts` for the server functions that call these as the signed-in user).
 */

/** Whose articles: one Commission's (its administrators and reporting officers) or the platform's. */
export type HelpScope = { kind: 'commission'; slug: string } | { kind: 'platform' };

/** The declarations service's problems: a 400 lists the fields that failed. */
export type HelpProblem = ValidationProblem;

export type HelpResult<T> = ServiceResult<T, HelpProblem>;

/** `GET /v1/commissions/{slug}/help/articles` or `GET /v1/help/articles`: last updated first. */
export function loadHelpArticles(
  client: DeclarationsClient,
  scope: HelpScope,
): Promise<HelpResult<HelpArticle[]>> {
  return callService(() =>
    scope.kind === 'commission'
      ? client.GET('/v1/commissions/{slug}/help/articles', {
          params: { path: { slug: scope.slug } },
        })
      : client.GET('/v1/help/articles'),
  );
}

export interface SaveHelpArticle {
  /** Null for a new article. */
  articleId: string | null;
  /** One per new article, reused on retry, so a retried create gets the same article. */
  idempotencyKey: string;
  input: HelpArticleInput;
}

/** Creates (POST, idempotent) or updates (PUT) an article; publishing is its `published` flag. */
export function saveHelpArticle(
  client: DeclarationsClient,
  scope: HelpScope,
  { articleId, idempotencyKey, input }: SaveHelpArticle,
): Promise<HelpResult<HelpArticle>> {
  const header = { 'Idempotency-Key': idempotencyKey };
  return callService(() => {
    if (scope.kind === 'commission') {
      const slug = scope.slug;
      return articleId === null
        ? client.POST('/v1/commissions/{slug}/help/articles', {
            params: { path: { slug }, header },
            body: input,
          })
        : client.PUT('/v1/commissions/{slug}/help/articles/{articleId}', {
            params: { path: { slug, articleId } },
            body: input,
          });
    }
    return articleId === null
      ? client.POST('/v1/help/articles', { params: { header }, body: input })
      : client.PUT('/v1/help/articles/{articleId}', {
          params: { path: { articleId } },
          body: input,
        });
  });
}

/**
 * `GET /v1/help/search/preview`: the help search as the scope's declarants get it (the
 * Commission's, or every declarant for the platform), so staff check a published article is
 * found.
 */
export function searchAsDeclarants(
  client: DeclarationsClient,
  scope: HelpScope,
  { q, language }: { q: string; language: HelpLanguage },
): Promise<HelpResult<HelpPassage[]>> {
  return callService(() =>
    client.GET('/v1/help/search/preview', {
      params: {
        query: { q, language, ...(scope.kind === 'commission' ? { commission: scope.slug } : {}) },
      },
    }),
  );
}

/** `GET /v1/help/corpus`: every stored wording by source, citation and effective date. */
export function loadCorpus(client: DeclarationsClient): Promise<HelpResult<CorpusPassage[]>> {
  return callService(() => client.GET('/v1/help/corpus'));
}

/** `GET /v1/help/corpus/{passageId}`: one wording with its English and Kiswahili text. */
export function loadCorpusPassage(
  client: DeclarationsClient,
  passageId: string,
): Promise<HelpResult<CorpusPassageText>> {
  return callService(() =>
    client.GET('/v1/help/corpus/{passageId}', { params: { path: { passageId } } }),
  );
}

/** `POST /v1/help/corpus/import`: loads the corpus files deployed with the service. */
export function importStatutoryCorpus(
  client: DeclarationsClient,
): Promise<HelpResult<CorpusImportResult>> {
  return callService(() => client.POST('/v1/help/corpus/import'));
}

/** `GET /v1/commissions/{slug}/help/themes?month`: one month's counts, the most asked first. */
export function loadQuestionThemes(
  client: DeclarationsClient,
  slug: string,
  month: string,
): Promise<HelpResult<QuestionThemeCount[]>> {
  return callService(() =>
    client.GET('/v1/commissions/{slug}/help/themes', {
      params: { path: { slug }, query: { month } },
    }),
  );
}
