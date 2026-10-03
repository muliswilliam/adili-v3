import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { BODY_MAX, TITLE_MAX } from '../components/help/model';
import { withViewerClient } from './as-viewer.server';
import { commissionSlug } from './commission-slug';
import type {
  CorpusImportResult,
  CorpusPassage,
  CorpusPassageText,
  HelpArticle,
  HelpPassage,
  QuestionThemeCount,
} from './declarations/client';
import { helpClient } from './declarations/help-client.server';
import { HELP_TAGS } from './declarations/help-tags';
import {
  type HelpResult,
  importStatutoryCorpus,
  loadCorpus,
  loadCorpusPassage,
  loadHelpArticles,
  loadQuestionThemes,
  saveHelpArticle,
  searchAsDeclarants,
} from './help.server';

/**
 * Server functions for the help pages (spec 11 FE-4), called as the signed-in user: the
 * declarations service decides who may read or write (a Commission's admins and reporting
 * officers, or platform admins). Tokens stay on the server.
 */

const asHelpViewer = <T>(work: (client: ReturnType<typeof helpClient>) => Promise<HelpResult<T>>) =>
  withViewerClient(helpClient, work);

const helpScope = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('commission'), slug: commissionSlug }),
  z.object({ kind: z.literal('platform') }),
]);

const isoDate = z.iso.date();

/** Bounds as the contract's `HelpArticleInput` has them; the service validates the rest. */
export const helpArticleInput = z.object({
  title: z.string().max(TITLE_MAX),
  bodyEn: z.string().max(BODY_MAX),
  bodySw: z.string().max(BODY_MAX).nullable(),
  tags: z.array(z.enum(HELP_TAGS)).max(20),
  effectiveFrom: isoDate,
  effectiveTo: isoDate.nullable(),
  published: z.boolean(),
});

export const listHelpArticles = createServerFn({ method: 'GET' })
  .validator(z.object({ scope: helpScope }))
  .handler(({ data }): Promise<HelpResult<HelpArticle[]>> =>
    asHelpViewer((client) => loadHelpArticles(client, data.scope)),
  );

export const saveArticleInput = z.object({
  scope: helpScope,
  articleId: z.uuid().nullable(),
  idempotencyKey: z.uuid(),
  input: helpArticleInput,
});

/** Creates or updates an article, and with `published` publishes or unpublishes it. */
export const saveArticle = createServerFn({ method: 'POST' })
  .validator(saveArticleInput)
  .handler(({ data }): Promise<HelpResult<HelpArticle>> =>
    asHelpViewer((client) => saveHelpArticle(client, data.scope, data)),
  );

export const previewSearchInput = z.object({
  scope: helpScope,
  q: z.string().trim().min(2).max(200),
  language: z.enum(['en', 'sw']),
});

/** The help search as the scope's declarants get it. */
export const previewHelpSearch = createServerFn({ method: 'GET' })
  .validator(previewSearchInput)
  .handler(({ data }): Promise<HelpResult<HelpPassage[]>> =>
    asHelpViewer((client) => searchAsDeclarants(client, data.scope, data)),
  );

export const listCorpus = createServerFn({ method: 'GET' }).handler(
  (): Promise<HelpResult<CorpusPassage[]>> => asHelpViewer(loadCorpus),
);

export const getCorpusPassage = createServerFn({ method: 'GET' })
  .validator(z.object({ passageId: z.uuid() }))
  .handler(({ data }): Promise<HelpResult<CorpusPassageText>> =>
    asHelpViewer((client) => loadCorpusPassage(client, data.passageId)),
  );

export const importCorpus = createServerFn({ method: 'POST' }).handler(
  (): Promise<HelpResult<CorpusImportResult>> => asHelpViewer(importStatutoryCorpus),
);

export const getQuestionThemes = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: commissionSlug }))
  .handler(({ data }): Promise<HelpResult<QuestionThemeCount[]>> =>
    asHelpViewer((client) => loadQuestionThemes(client, data.slug)),
  );
