import { PLATFORM_ADMIN } from '@adili/roles';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiProblemResponse,
  ApiQueryParameters,
  CurrentPrincipal,
  type Principal,
  Roles,
  schemaRef,
  TENANT_KEY,
  ZodValidationPipe,
} from '@adili/api-kit';

import { HelpService } from './help.service.js';
import {
  type CorpusImportResult,
  type CorpusPassageView,
  type HelpArticle,
  type HelpPassage,
  type HelpSearchQuery,
  helpSearchQuery,
} from './representation.js';

const NOT_VISIBLE = 'Not found, or not visible to the caller';

const ApiSlugParam = () =>
  ApiParam({ name: 'slug', schema: { type: 'string', pattern: TENANT_KEY.source } });

const ApiArticleIdParam = () =>
  ApiParam({ name: 'articleId', schema: { type: 'string', format: 'uuid' } });

const articleList = { type: 'array', items: schemaRef('HelpArticle') } as const;

/**
 * Help (spec 11): search over the law and help articles for declarants, article authoring for
 * Commission administrators (read by reporting officers) and for platform administrators, and the
 * statutory corpus import.
 */
@ApiTags('help')
@Controller('v1')
export class HelpController {
  constructor(private readonly help: HelpService) {}

  @Get('help/search')
  @ApiOperation({
    operationId: 'searchHelp',
    summary: 'Full-text search over the legal corpus and help articles in force',
    description:
      "Declarants (by the person_id claim): the Act and Regulations, the platform's published articles and those of the declarant's own Commissions, in force on `date`. Passages tagged with the section or item type the declarant is on rank higher. Deterministic: no AI. Other callers get 404.",
  })
  @ApiQueryParameters(helpSearchQuery)
  @ApiOkResponse({
    description: 'Passages, best first',
    schema: { type: 'array', items: schemaRef('HelpPassage') },
  })
  @ApiProblemResponse(400, 'Query failed validation')
  @ApiProblemResponse(404, NOT_VISIBLE)
  search(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(helpSearchQuery)) query: HelpSearchQuery,
  ): Promise<HelpPassage[]> {
    return this.help.search(principal, query);
  }

  @Get('commissions/:slug/help/articles')
  @ApiSlugParam()
  @ApiOperation({
    operationId: 'listHelpArticles',
    summary: "The Commission's help articles, published or not",
    description: "The Commission's administrators and reporting officers. Anyone else gets 404.",
  })
  @ApiOkResponse({ description: 'Articles, last updated first', schema: articleList })
  @ApiProblemResponse(404, NOT_VISIBLE)
  listCommissionArticles(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
  ): Promise<HelpArticle[]> {
    return this.help.listCommissionArticles(principal, slug);
  }

  @Post('commissions/:slug/help/articles')
  @ApiSlugParam()
  @ApiOperation({
    operationId: 'createHelpArticle',
    summary: 'Create a Commission help article',
    description:
      "The Commission's administrators. Its reporting officers get 403; anyone else 404. A published article reaches the Commission's declarants' help search and records `help.article.published.v1`.",
  })
  @ApiBody({ required: true, schema: schemaRef('HelpArticleInput') })
  @ApiCreatedResponse({ description: 'Created', schema: schemaRef('HelpArticle') })
  @ApiProblemResponse(400, 'Request failed validation')
  @ApiProblemResponse(403, 'A reporting officer, who reads articles but does not edit them')
  @ApiProblemResponse(404, NOT_VISIBLE)
  createCommissionArticle(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Body() body: unknown,
  ): Promise<HelpArticle> {
    return this.help.createCommissionArticle(principal, slug, body);
  }

  @Put('commissions/:slug/help/articles/:articleId')
  @ApiSlugParam()
  @ApiArticleIdParam()
  @ApiOperation({
    operationId: 'updateHelpArticle',
    summary: 'Update, publish or unpublish a Commission help article',
    description:
      "The Commission's administrators; as create. Publishing an unpublished article records `help.article.published.v1`.",
  })
  @ApiBody({ required: true, schema: schemaRef('HelpArticleInput') })
  @ApiOkResponse({ description: 'Updated', schema: schemaRef('HelpArticle') })
  @ApiProblemResponse(400, 'Request failed validation')
  @ApiProblemResponse(403, 'A reporting officer, who reads articles but does not edit them')
  @ApiProblemResponse(404, NOT_VISIBLE)
  updateCommissionArticle(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Param('articleId') articleId: string,
    @Body() body: unknown,
  ): Promise<HelpArticle> {
    return this.help.updateCommissionArticle(principal, slug, articleId, body);
  }

  @Delete('commissions/:slug/help/articles/:articleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiSlugParam()
  @ApiArticleIdParam()
  @ApiOperation({
    operationId: 'deleteHelpArticle',
    summary: 'Delete a Commission help article',
    description: "The Commission's administrators; as create.",
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiProblemResponse(403, 'A reporting officer, who reads articles but does not edit them')
  @ApiProblemResponse(404, NOT_VISIBLE)
  deleteCommissionArticle(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Param('articleId') articleId: string,
  ): Promise<void> {
    return this.help.deleteCommissionArticle(principal, slug, articleId);
  }

  @Get('help/articles')
  @Roles(PLATFORM_ADMIN)
  @ApiOperation({
    operationId: 'listPlatformHelpArticles',
    summary: "The platform's help articles, published or not, for every Commission's declarants",
    description: 'platform-admin only.',
  })
  @ApiOkResponse({ description: 'Articles, last updated first', schema: articleList })
  @ApiProblemResponse(403, 'Not a platform admin')
  listPlatformArticles(@CurrentPrincipal() principal: Principal): Promise<HelpArticle[]> {
    return this.help.listPlatformArticles(principal);
  }

  @Post('help/articles')
  @Roles(PLATFORM_ADMIN)
  @ApiOperation({
    operationId: 'createPlatformHelpArticle',
    summary: 'Create a platform help article',
    description:
      "platform-admin only. A published article reaches every declarant's help search and records `help.article.published.v1`.",
  })
  @ApiBody({ required: true, schema: schemaRef('HelpArticleInput') })
  @ApiCreatedResponse({ description: 'Created', schema: schemaRef('HelpArticle') })
  @ApiProblemResponse(400, 'Request failed validation')
  @ApiProblemResponse(403, 'Not a platform admin')
  createPlatformArticle(
    @CurrentPrincipal() principal: Principal,
    @Body() body: unknown,
  ): Promise<HelpArticle> {
    return this.help.createPlatformArticle(principal, body);
  }

  @Put('help/articles/:articleId')
  @Roles(PLATFORM_ADMIN)
  @ApiArticleIdParam()
  @ApiOperation({
    operationId: 'updatePlatformHelpArticle',
    summary: 'Update, publish or unpublish a platform help article',
    description: 'platform-admin only.',
  })
  @ApiBody({ required: true, schema: schemaRef('HelpArticleInput') })
  @ApiOkResponse({ description: 'Updated', schema: schemaRef('HelpArticle') })
  @ApiProblemResponse(400, 'Request failed validation')
  @ApiProblemResponse(403, 'Not a platform admin')
  @ApiProblemResponse(404, 'No such platform article')
  updatePlatformArticle(
    @CurrentPrincipal() principal: Principal,
    @Param('articleId') articleId: string,
    @Body() body: unknown,
  ): Promise<HelpArticle> {
    return this.help.updatePlatformArticle(principal, articleId, body);
  }

  @Delete('help/articles/:articleId')
  @Roles(PLATFORM_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiArticleIdParam()
  @ApiOperation({
    operationId: 'deletePlatformHelpArticle',
    summary: 'Delete a platform help article',
    description: 'platform-admin only.',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiProblemResponse(403, 'Not a platform admin')
  @ApiProblemResponse(404, 'No such platform article')
  deletePlatformArticle(
    @CurrentPrincipal() principal: Principal,
    @Param('articleId') articleId: string,
  ): Promise<void> {
    return this.help.deletePlatformArticle(principal, articleId);
  }

  @Get('help/corpus')
  @Roles(PLATFORM_ADMIN)
  @ApiOperation({
    operationId: 'listCorpusPassages',
    summary: 'The imported statutory corpus: every wording with its period and version',
    description: 'platform-admin only. Read-only: statutory text changes only by import.',
  })
  @ApiOkResponse({
    description: 'Wordings by source, citation and effective date',
    schema: { type: 'array', items: schemaRef('CorpusPassage') },
  })
  @ApiProblemResponse(403, 'Not a platform admin')
  corpus(@CurrentPrincipal() principal: Principal): Promise<CorpusPassageView[]> {
    return this.help.corpus(principal);
  }

  @Post('help/corpus/import')
  @Roles(PLATFORM_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'importCorpus',
    summary: 'Re-import the statutory corpus files deployed with the service',
    description:
      'platform-admin only. Idempotent: the same files import as a no-op (`skipped`). An amended wording supersedes the earlier one from its effective date.',
  })
  @ApiOkResponse({
    description: 'What the import changed',
    schema: schemaRef('CorpusImportResult'),
  })
  @ApiProblemResponse(403, 'Not a platform admin')
  importCorpus(): Promise<CorpusImportResult> {
    return this.help.importCorpus();
  }
}
