import {
  applyDecorators,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Options,
  Param,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  DECORATORS,
} from '@nestjs/swagger';
import {
  ApiProblemResponse,
  byClientIp,
  ProblemException,
  Public,
  RateLimit,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import { OPEN_DATA_RATE_LIMIT } from '../config.js';
import { FIRST_FINANCIAL_YEAR } from '../financial-year.js';
import { notFound, storageUnavailable } from '../problems.js';
import { CONTENT_TYPES, type FileFormat } from './files.js';
import { OpenDataStorageUnavailable } from './open-data-files.js';
import {
  ALLOWED_REQUEST_HEADERS,
  entityTag,
  isNotModified,
  preferredFormat,
  PublicCorsGuard,
  type PublicReply,
  type PublicRequestHeaders,
  setCacheHeaders,
} from './public-http.js';
import {
  type CacheableBody,
  jsonBody,
  PublicOpenDataService,
  type PublicReleaseKey,
} from './public-open-data.service.js';
import { ReleaseNotFound } from './representation.js';
import { RELEASE_KINDS } from './schema.js';
import { OPEN_DATA_TABLES, type OpenDataTableName } from './tables.js';

const fyParam = z.coerce.number().int().min(FIRST_FINANCIAL_YEAR);
const kindParam = z.enum(RELEASE_KINDS);
const versionParam = z.coerce.number().int().min(1);

/** `{table}` or `{table}.csv`: the table, and CSV when the suffix asks for it. */
const tableParam = z
  .string()
  .transform((value) =>
    value.endsWith('.csv')
      ? { name: value.slice(0, -'.csv'.length), csv: true }
      : { name: value, csv: false },
  )
  .pipe(z.object({ name: z.enum(OPEN_DATA_TABLES), csv: z.boolean() }));
interface TableParam {
  name: OpenDataTableName;
  csv: boolean;
}

const RELEASE = ':fy/:kind/:version';
const TABLE = `${RELEASE}/tables/:table`;

const ApiReleaseParams = () =>
  applyDecorators(
    ApiParam({ name: 'fy', schema: { type: 'integer', minimum: FIRST_FINANCIAL_YEAR } }),
    ApiParam({ name: 'kind', schema: { type: 'string', enum: [...RELEASE_KINDS] } }),
    ApiParam({ name: 'version', schema: { type: 'integer', minimum: 1 } }),
  );

const NOT_FOUND = 'No published or withdrawn release has this year, kind and version.';

/**
 * The public open-data API (spec 09b S8): published and withdrawn releases and their tables as
 * JSON or CSV, for anyone without a token (`@Public()`, so no security requirement in the
 * contract), any origin (CORS `*`), within a per client IP budget. Responses carry an entity
 * tag and when they last changed, are cached publicly for an hour, and a conditional request
 * for a current copy gets 304. A withdrawn release says so, when and why, and its files are
 * still served.
 */
@ApiTags('open-data')
@Public()
@UseGuards(PublicCorsGuard)
@Controller('open-data/v1/releases')
export class PublicOpenDataController {
  constructor(private readonly openData: PublicOpenDataService) {}

  @Get()
  @RateLimit(OPEN_DATA_RATE_LIMIT, { key: byClientIp })
  @ApiOperation({
    operationId: 'listOpenDataReleases',
    summary: 'Published and withdrawn releases (public; cached; rate-limited)',
  })
  @ApiOkResponse({ description: 'Releases' })
  async list(
    @Headers() headers: PublicRequestHeaders,
    @Res({ passthrough: true }) reply: PublicReply,
  ): Promise<Buffer | undefined> {
    const { releases, lastModified } = await this.openData.list();
    // An empty list has never changed: dated at the epoch, so it validates like any other.
    return served(
      headers,
      reply,
      { ...jsonBody(releases), lastModified: lastModified ?? new Date(0) },
      'json',
    );
  }

  @Get(RELEASE)
  @RateLimit(OPEN_DATA_RATE_LIMIT, { key: byClientIp })
  @ApiReleaseParams()
  @ApiOperation({
    operationId: 'getOpenDataRelease',
    summary: 'A release with its tables, hashes and manifest verification link (public)',
  })
  @ApiOkResponse({ description: 'Release' })
  @ApiProblemResponse(400, 'A path parameter is malformed')
  @ApiProblemResponse(404, NOT_FOUND)
  async release(
    @Param('fy', new ZodValidationPipe(fyParam)) fy: number,
    @Param('kind', new ZodValidationPipe(kindParam)) kind: PublicReleaseKey['kind'],
    @Param('version', new ZodValidationPipe(versionParam)) version: number,
    @Headers() headers: PublicRequestHeaders,
    @Res({ passthrough: true }) reply: PublicReply,
  ): Promise<Buffer | undefined> {
    const { release, lastModified } = await found(() =>
      this.openData.release({ fy, kind, version }),
    );
    return served(headers, reply, { ...jsonBody(release), lastModified }, 'json');
  }

  @Get(TABLE)
  @RateLimit(OPEN_DATA_RATE_LIMIT, { key: byClientIp })
  @ApiReleaseParams()
  @ApiParam({ name: 'table', schema: { type: 'string', enum: [...OPEN_DATA_TABLES] } })
  @ApiOperation({
    operationId: 'getOpenDataTable',
    summary:
      'A table as JSON or CSV (Accept, or the `.csv` suffix); suppressed cells are null (JSON) or empty (CSV) with a marker (public)',
  })
  @ApiOkResponse({ description: 'Table' })
  @ApiProblemResponse(400, 'A path parameter is malformed')
  @ApiProblemResponse(404, NOT_FOUND)
  @ApiProblemResponse(406, 'Accept names neither application/json nor text/csv')
  @ApiProblemResponse(503, 'Object storage could not be reached')
  async table(
    @Param('fy', new ZodValidationPipe(fyParam)) fy: number,
    @Param('kind', new ZodValidationPipe(kindParam)) kind: PublicReleaseKey['kind'],
    @Param('version', new ZodValidationPipe(versionParam)) version: number,
    @Param('table', new ZodValidationPipe(tableParam)) table: TableParam,
    @Headers() headers: PublicRequestHeaders,
    @Res({ passthrough: true }) reply: PublicReply,
  ): Promise<Buffer | undefined> {
    const format = table.csv ? 'csv' : preferredFormat(headers.accept);
    if (format === undefined) throw notAcceptable();
    const file = await found(async () => {
      try {
        return await this.openData.table({ fy, kind, version }, table.name, format);
      } catch (error) {
        if (error instanceof OpenDataStorageUnavailable) throw storageUnavailable();
        throw error;
      }
    });
    if (format === 'csv') {
      reply.header(
        'content-disposition',
        `attachment; filename="adili-open-data-${String(fy)}-${kind}-v${String(version)}-${table.name}.csv"`,
      );
    }
    return served(headers, reply, file, format, { variesByAccept: !table.csv });
  }

  /** CORS preflight of a cross-origin script sending conditional or `Accept` headers. */
  @Options(['', RELEASE, TABLE])
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiExcludeEndpoint()
  preflight(@Res({ passthrough: true }) reply: PublicReply): void {
    reply.header('access-control-allow-methods', 'GET, HEAD, OPTIONS');
    reply.header('access-control-allow-headers', ALLOWED_REQUEST_HEADERS);
    reply.header('access-control-max-age', 86_400);
  }
}

// No bearer requirement in the contract for this public controller.
Reflect.defineMetadata(DECORATORS.API_SECURITY, [], PublicOpenDataController);

/** The body with its cache headers, or 304 and none when the client's copy is current. */
function served(
  headers: PublicRequestHeaders,
  reply: PublicReply,
  content: CacheableBody,
  format: FileFormat,
  options: { variesByAccept?: boolean } = {},
): Buffer | undefined {
  const etag = entityTag(content.sha256);
  setCacheHeaders(reply, { etag, lastModified: content.lastModified, ...options });
  if (isNotModified(headers, etag, content.lastModified)) {
    reply.status(HttpStatus.NOT_MODIFIED);
    return undefined;
  }
  reply.header('content-type', CONTENT_TYPES[format]);
  return content.body;
}

async function found<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ReleaseNotFound) throw notFound(NOT_FOUND);
    throw error;
  }
}

function notAcceptable(): ProblemException {
  return new ProblemException({
    type: 'about:blank',
    title: 'Not Acceptable',
    status: HttpStatus.NOT_ACCEPTABLE,
    detail: 'A table is served as application/json or text/csv.',
  });
}
