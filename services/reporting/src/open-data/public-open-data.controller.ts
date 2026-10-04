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
  type HeadersObject,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  DECORATORS,
} from '@nestjs/swagger';
import {
  byClientIp,
  PROBLEM_CONTENT_TYPE,
  ProblemException,
  Public,
  RATE_LIMIT_HEADERS,
  RateLimit,
  schemaRef,
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
  PUBLIC_CACHE_CONTROL,
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
const tableNameParam = z.enum(OPEN_DATA_TABLES);
interface TableParam {
  name: OpenDataTableName;
  csv: boolean;
}

const RELEASE = ':fy/:kind/:version';
const TABLE = `${RELEASE}/tables/:table`;

const ApiReleaseParams = () =>
  applyDecorators(
    ApiParam({
      name: 'fy',
      description: 'Financial year start year, e.g. 2027 for 1 July 2027 to 30 June 2028',
      schema: { type: 'integer', minimum: FIRST_FINANCIAL_YEAR },
    }),
    ApiParam({
      name: 'kind',
      description:
        '`annual` (published on NCR approval) or `snapshot` (published mid-year by EACC)',
      schema: { type: 'string', enum: [...RELEASE_KINDS] },
    }),
    ApiParam({
      name: 'version',
      description: '1, 2, ... per financial year and kind; a corrected release is the next version',
      schema: { type: 'integer', minimum: 1 },
    }),
  );

const ApiTableParam = () => ApiParam({ name: 'table', schema: schemaRef('OpenDataTable') });

const NOT_FOUND = 'No published or withdrawn release has this year, kind and version.';

/** Any origin may read every response of the public API, errors and 429s included. */
const CORS_HEADER: HeadersObject = {
  'Access-Control-Allow-Origin': {
    description: 'Any origin may read the public open-data API (also on errors and 429)',
    schema: { type: 'string', enum: ['*'] },
  },
};

/** The cache headers of a 200 or 304 (`setCacheHeaders`). */
const CACHE_HEADERS: HeadersObject = {
  ETag: {
    description: "Strong entity tag, the body's SHA-256 in quotes",
    schema: { type: 'string' },
  },
  'Last-Modified': {
    description: 'When the release last changed (built, published or withdrawn)',
    schema: { type: 'string' },
  },
  'Cache-Control': { schema: { type: 'string', enum: [PUBLIC_CACHE_CONTROL] } },
};

/** The headers of a public 200: cache, CORS and the client IP's budget. */
const OK_HEADERS: HeadersObject = { ...CACHE_HEADERS, ...CORS_HEADER, ...RATE_LIMIT_HEADERS };

/**
 * What every public route answers besides its 200 and its own problems: 304 for a current copy,
 * and the CORS header on the 429 `@RateLimit` documents. Above `@RateLimit`, so it applies after
 * it and adds to its 429.
 */
const ApiPublicResponses = () =>
  applyDecorators(
    ApiResponse({
      status: HttpStatus.NOT_MODIFIED,
      description: "The client's copy (If-None-Match, or If-Modified-Since) is current; no body",
      headers: { ...CACHE_HEADERS, ...CORS_HEADER },
    }),
    ApiResponse({
      status: HttpStatus.TOO_MANY_REQUESTS,
      headers: {
        ...CORS_HEADER,
        ...RATE_LIMIT_HEADERS,
        'Retry-After': {
          description: 'Seconds until the next request would be allowed',
          schema: { type: 'integer' },
        },
      },
    }),
  );

/** A problem answer of the public API, readable cross-origin. */
const ApiPublicProblemResponse = (status: number, description: string) =>
  ApiResponse({
    status,
    description,
    headers: CORS_HEADER,
    content: { [PROBLEM_CONTENT_TYPE]: { schema: schemaRef('ProblemDetails') } },
  });

const CSV_DESCRIPTION =
  'Header row of the columns, the marker column as `_suppressed` (`true`/`false`); a suppressed or not-collected figure is an empty cell (`notCollected` in the JSON tells them apart). RFC 4180, CRLF line ends, UTF-8.';

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
  @ApiPublicResponses()
  @RateLimit(OPEN_DATA_RATE_LIMIT, { key: byClientIp })
  @ApiOperation({
    operationId: 'listOpenDataReleases',
    summary: 'Published and withdrawn releases (public; cached; rate-limited)',
    description:
      "Spec 09b S8. No token; any origin (`Access-Control-Allow-Origin: *`); a budget per client IP. The latest year first, then by kind and the latest version first. Previews are never listed. The ETag is the body's SHA-256: `If-None-Match` (or `If-Modified-Since`) with a current copy gets 304.",
  })
  @ApiOkResponse({
    description: 'Releases',
    headers: OK_HEADERS,
    schema: { type: 'array', items: schemaRef('PublicOpenDataRelease') },
  })
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
  @ApiPublicResponses()
  @RateLimit(OPEN_DATA_RATE_LIMIT, { key: byClientIp })
  @ApiReleaseParams()
  @ApiOperation({
    operationId: 'getOpenDataRelease',
    summary: 'A release with its tables, hashes and manifest verification link (public)',
    description:
      'Spec 09b S7, S8. A published or withdrawn release (a preview is 404); a withdrawn one carries when and why, and the version correcting it once published. Cached and conditional as `listOpenDataReleases`.',
  })
  @ApiOkResponse({
    description: 'Release',
    headers: OK_HEADERS,
    schema: schemaRef('PublicOpenDataRelease'),
  })
  @ApiPublicProblemResponse(400, 'A path parameter is malformed')
  @ApiPublicProblemResponse(404, NOT_FOUND)
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
  @ApiPublicResponses()
  @RateLimit(OPEN_DATA_RATE_LIMIT, { key: byClientIp })
  @ApiReleaseParams()
  @ApiTableParam()
  @ApiOperation({
    operationId: 'getOpenDataTable',
    summary:
      'A table as JSON or CSV by the Accept header; suppressed cells are null with a marker (public)',
    description:
      "Spec 09b S7, S8. The table's file as stored, byte for byte: its SHA-256 is the release's `sha256Json` or `sha256Csv` and the ETag. `text/csv` rated above `application/json` in Accept gives CSV, otherwise JSON (`Vary: Accept`); Accept naming neither is 406. Also served for a withdrawn release. Cached and conditional as `listOpenDataReleases`.",
  })
  @ApiOkResponse({
    description: 'Table',
    headers: { ...OK_HEADERS, Vary: { schema: { type: 'string', enum: ['Accept'] } } },
    content: {
      'application/json': { schema: schemaRef('OpenDataTableFile') },
      'text/csv': { schema: { type: 'string', description: CSV_DESCRIPTION } },
    },
  })
  @ApiPublicProblemResponse(400, 'A path parameter is malformed')
  @ApiPublicProblemResponse(404, NOT_FOUND)
  @ApiPublicProblemResponse(406, 'Accept names neither application/json nor text/csv')
  @ApiPublicProblemResponse(
    503,
    'Problem type `storage-unavailable`; object storage could not be reached',
  )
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
    return await this.tableFile(
      { fy, kind, version },
      table.name,
      format,
      headers,
      reply,
      !table.csv,
    );
  }

  @Get(`${TABLE}.csv`)
  @ApiPublicResponses()
  @RateLimit(OPEN_DATA_RATE_LIMIT, { key: byClientIp })
  @ApiReleaseParams()
  @ApiTableParam()
  @ApiOperation({
    operationId: 'getOpenDataTableCsv',
    summary: 'A table as CSV, whatever the Accept header (public; a download link)',
    description:
      'Spec 09b S8. As `getOpenDataTable` in CSV, with `Content-Disposition: attachment` and a file name of the year, kind, version and table.',
  })
  @ApiOkResponse({
    description: 'Table as CSV',
    headers: {
      ...OK_HEADERS,
      'Content-Disposition': {
        schema: {
          type: 'string',
          example: 'attachment; filename="adili-open-data-2027-annual-v1-filing-by-commission.csv"',
        },
      },
    },
    content: { 'text/csv': { schema: { type: 'string', description: CSV_DESCRIPTION } } },
  })
  @ApiPublicProblemResponse(400, 'A path parameter is malformed')
  @ApiPublicProblemResponse(404, NOT_FOUND)
  @ApiPublicProblemResponse(
    503,
    'Problem type `storage-unavailable`; object storage could not be reached',
  )
  async tableCsv(
    @Param('fy', new ZodValidationPipe(fyParam)) fy: number,
    @Param('kind', new ZodValidationPipe(kindParam)) kind: PublicReleaseKey['kind'],
    @Param('version', new ZodValidationPipe(versionParam)) version: number,
    @Param('table', new ZodValidationPipe(tableNameParam)) table: OpenDataTableName,
    @Headers() headers: PublicRequestHeaders,
    @Res({ passthrough: true }) reply: PublicReply,
  ): Promise<Buffer | undefined> {
    return await this.tableFile({ fy, kind, version }, table, 'csv', headers, reply, false);
  }

  /** The table's file in `format`, or 304; a CSV as an attachment named after the table. */
  private async tableFile(
    key: PublicReleaseKey,
    table: OpenDataTableName,
    format: FileFormat,
    headers: PublicRequestHeaders,
    reply: PublicReply,
    variesByAccept: boolean,
  ): Promise<Buffer | undefined> {
    const file = await found(async () => {
      try {
        return await this.openData.table(key, table, format);
      } catch (error) {
        if (error instanceof OpenDataStorageUnavailable) throw storageUnavailable();
        throw error;
      }
    });
    if (format === 'csv') {
      reply.header(
        'content-disposition',
        `attachment; filename="adili-open-data-${String(key.fy)}-${key.kind}-v${String(key.version)}-${table}.csv"`,
      );
    }
    return served(headers, reply, file, format, { variesByAccept });
  }

  /** CORS preflight of a cross-origin script sending conditional or `Accept` headers. */
  @Options(['', RELEASE, TABLE, `${TABLE}.csv`])
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
