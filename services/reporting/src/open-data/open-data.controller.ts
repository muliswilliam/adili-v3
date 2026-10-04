import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  AcceptIdempotencyKey,
  ApiJsonBody,
  ApiProblemResponse,
  CurrentPrincipal,
  type Principal,
  RequireIdempotencyKey,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { z } from 'zod';

import { FIRST_FINANCIAL_YEAR } from '../financial-year.js';
import { OpenDataService } from './open-data.service.js';
import type { OpenDataReleaseDetail, OpenDataReleaseView } from './representation.js';
import { RELEASE_KINDS } from './schema.js';

/**
 * reporting.yaml `buildOpenDataRelease` body: the financial year (start year) and the kind, a
 * snapshot unless said otherwise.
 */
const buildBody = z.strictObject({
  fy: z
    .number()
    .int()
    .min(FIRST_FINANCIAL_YEAR)
    .meta({ description: 'Financial year start year, e.g. 2027 for 1 July 2027 to 30 June 2028' }),
  kind: z.enum(RELEASE_KINDS).default('snapshot').meta({
    description:
      'A mid-year snapshot, or a corrected annual release once the published one is withdrawn',
  }),
});
type BuildBody = z.infer<typeof buildBody>;

/** reporting.yaml `withdrawOpenDataRelease` body: the public reason. */
const withdrawBody = z.strictObject({
  reason: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .meta({ description: 'Shown with the withdrawn release in the public API' }),
});
type WithdrawBody = z.infer<typeof withdrawBody>;

const ApiReleaseIdParam = () =>
  ApiParam({ name: 'releaseId', schema: { type: 'string', format: 'uuid' } });

const SUPERVISOR_ONLY = 'Only an EACC supervisor';
const RELEASE = schemaRef('OpenDataRelease');

const EACC_ONLY = 'Only EACC analysts and supervisors';

const BUILD_DESCRIPTION =
  "eacc-analyst and eacc-supervisor (tenant `eacc`); anyone else 403. Builds the six tables from the year's national consolidated report's aggregates as last built (a report submitted since changes nothing until the NCR is rebuilt) and the projection facts, suppresses every figure over fewer than 10 officers (with complementary suppression), and reconciles the tables' national totals with the NCR's (409 `reconciliation-failed`, `mismatches` listing the totals that differ, is a fault of the table builder; nothing is built). Access requests are the reports' Form M section 5 counts (received, granted, declined), suppressed with each Commission's other counts and reconciled too. Reporting entity types are not collected: `by-entity-type` has no rows and names its filing figures in `notCollected`. `kind` `snapshot` (the default) builds a snapshot of the NCR, draft or approved, or, before the year's NCR is built, a mid-year snapshot of the live projections: every Commission's counts as its Form M would compile now (filing obligations, clarifications and access requests of the year), its status its report's, reconciled with those projections' own national totals and suppressed alike (409 `fy-not-started` for a year that has not started). The release JSON names the source (`national-report` or `live-projections`). `kind` `annual` builds a corrected annual release from the approved NCR (409 `ncr-not-approved` before it is approved) while no annual release of the year is published (409 `annual-release-published`: withdraw it first); unlike the one built on approval it is not published by itself, but deliberately through `publishOpenDataRelease`. The files (JSON and CSV per table, the release JSON) are written to object storage with their SHA-256, and the release is recorded as `preview`, the next version of the year's releases of its kind. The build takes its version before the files are written and records the release once they are, so one of a year and kind runs at a time (409 `release-building`); a build whose files could not be written (503 `storage-unavailable`) records no release and gives its version back. Emits `open-data.release.built.v1` (release id, year, kind, version; no figures). A retry with the same Idempotency-Key replays the build.";

/**
 * EACC's open-data releases (spec 09b): the list, previews and withdrawn included, a release with
 * its tables as built (the preview checked before it is published), and building a mid-year snapshot or a corrected annual release as a preview (EACC analysts and supervisors;
 * everyone else 403); publishing a preview and withdrawing a published release (an EACC
 * supervisor; everyone else 403).
 */
@ApiTags('open-data')
@Controller('v1/eacc/open-data/releases')
export class OpenDataController {
  constructor(private readonly openData: OpenDataService) {}

  @Get()
  @ApiOperation({
    operationId: 'listOpenDataReleasesEacc',
    summary: 'All releases including previews and withdrawn (EACC)',
    description:
      'eacc-analyst and eacc-supervisor (tenant `eacc`); anyone else 403. The latest financial year first, then by kind, the latest version first.',
  })
  @ApiOkResponse({ description: 'Releases', schema: { type: 'array', items: RELEASE } })
  @ApiProblemResponse(403, EACC_ONLY)
  list(@CurrentPrincipal() principal: Principal): Promise<OpenDataReleaseView[]> {
    return this.openData.list(principal);
  }

  @Get(':releaseId')
  @ApiReleaseIdParam()
  @ApiOperation({
    operationId: 'getOpenDataReleaseEacc',
    summary:
      'A release of any status with its six tables as built, suppression applied, and its source (EACC)',
    description:
      "Spec 09b S6: the preview EACC checks before a supervisor publishes it. eacc-analyst and eacc-supervisor (tenant `eacc`); anyone else 403. Any status, a preview included (the public API never serves a preview). `tables` are the release's table files as stored, the same JSON `getOpenDataTable` serves once published. `source` is what the tables were built from and reconciled with at build (`buildOpenDataRelease`): the national consolidated report (its reference if it was approved by then) or, for a snapshot of a year without one, the live projections. A release that exists has reconciled.",
  })
  @ApiOkResponse({
    description: 'The release, who built it, its source and its tables',
    schema: schemaRef('OpenDataReleaseDetail'),
  })
  @ApiProblemResponse(400, 'The release id is not a UUID')
  @ApiProblemResponse(403, EACC_ONLY)
  @ApiProblemResponse(404, 'No release has the id')
  @ApiProblemResponse(503, 'Object storage could not be reached (`storage-unavailable`)')
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('releaseId', new ZodValidationPipe(z.uuid())) releaseId: string,
  ): Promise<OpenDataReleaseDetail> {
    return this.openData.get(principal, releaseId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireIdempotencyKey()
  @ApiOperation({
    operationId: 'buildOpenDataRelease',
    summary:
      'Build a snapshot, or a corrected annual release, for a financial year as a preview (EACC analyst or supervisor)',
    description: BUILD_DESCRIPTION,
  })
  @ApiJsonBody(buildBody)
  @ApiCreatedResponse({ description: 'Built as a preview', schema: RELEASE })
  @ApiProblemResponse(400, 'Body failed validation, or Idempotency-Key missing')
  @ApiProblemResponse(403, EACC_ONLY)
  @ApiProblemResponse(
    409,
    'A snapshot of a year that has not started (`fy-not-started`); for an annual release, the year has no national consolidated report (`ncr-not-built`), it is not approved (`ncr-not-approved`) or an annual release of the year is published (`annual-release-published`); another build of the year and kind is under way (`release-building`); or the tables do not reconcile with their source (`reconciliation-failed`)',
  )
  @ApiProblemResponse(
    503,
    'Object storage could not be reached (`storage-unavailable`), or the directory for a snapshot of the live projections (`directory-unavailable`)',
  )
  build(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(buildBody)) body: BuildBody,
  ): Promise<OpenDataReleaseView> {
    return this.openData.build(principal, body.fy, body.kind);
  }

  @Post(':releaseId/publish')
  @HttpCode(HttpStatus.OK)
  // A retry after a lost answer replays it instead of failing `release-not-preview`.
  @AcceptIdempotencyKey()
  @ApiReleaseIdParam()
  @ApiOperation({
    operationId: 'publishOpenDataRelease',
    summary: 'Publish a preview release (EACC supervisor)',
    description:
      "eacc-supervisor (tenant `eacc`); anyone else, an eacc-analyst included, 403. Issues the release's manifest (year, kind, version, build time, the NCR reference it reconciles with, the publisher, the suppression threshold, and each table's rows, hidden cells and the SHA-256 of its JSON and CSV files, with the release JSON's) through documents as a Public verifiable document (`open-data-manifest`), then marks the release `published` by the caller. Emits `open-data.release.published.v1` (release id, year, kind, version; no figures). An annual release publishes itself the same way when its NCR is approved, `publishedBy` the approver. The release was reconciled with the NCR when it was built. A year has one published annual release at a time: an annual preview is published only once the year's published one is withdrawn (409 `annual-release-published`).",
  })
  @ApiOkResponse({ description: 'Published', schema: RELEASE })
  @ApiProblemResponse(
    400,
    'The release id is not a UUID, or the Idempotency-Key is malformed (`idempotency-key-missing`)',
  )
  @ApiProblemResponse(403, SUPERVISOR_ONLY)
  @ApiProblemResponse(404, 'No release has the id')
  @ApiProblemResponse(
    409,
    'The release is published or withdrawn already (`release-not-preview`), or it is annual and another annual release of the year is published (`annual-release-published`); or a request with the same Idempotency-Key is still running (`idempotency-key-in-use`)',
  )
  @ApiProblemResponse(
    502,
    'The documents service refused the manifest (`manifest-refused`); nothing is published',
  )
  @ApiProblemResponse(
    503,
    'Documents (`documents-unavailable`) or object storage (`storage-unavailable`) could not be reached; nothing is published',
  )
  publish(
    @CurrentPrincipal() principal: Principal,
    @Param('releaseId', new ZodValidationPipe(z.uuid())) releaseId: string,
  ): Promise<OpenDataReleaseView> {
    return this.openData.publish(principal, releaseId);
  }

  @Post(':releaseId/withdraw')
  @HttpCode(HttpStatus.OK)
  @AcceptIdempotencyKey()
  @ApiReleaseIdParam()
  @ApiOperation({
    operationId: 'withdrawOpenDataRelease',
    summary: 'Withdraw a published release with a public reason (EACC supervisor)',
    description:
      "eacc-supervisor (tenant `eacc`); anyone else 403. Revokes the release's manifest through documents (reason `withdrawn`), so its verify page shows it revoked, then marks the release `withdrawn` with the reason (trimmed), by the caller; it stays in the history and its files are still served, with the reason. A corrected release is a new build (`buildOpenDataRelease`, `kind` as the withdrawn one's), the next version of the year's releases of its kind. Emits `open-data.release.withdrawn.v1` (release id, year, kind, version; not the reason).",
  })
  @ApiJsonBody(withdrawBody)
  @ApiOkResponse({ description: 'Withdrawn', schema: RELEASE })
  @ApiProblemResponse(
    400,
    'Body failed validation, the release id is not a UUID, or the Idempotency-Key is malformed (`idempotency-key-missing`)',
  )
  @ApiProblemResponse(403, SUPERVISOR_ONLY)
  @ApiProblemResponse(404, 'No release has the id')
  @ApiProblemResponse(
    409,
    'The release is a preview or withdrawn already (`release-not-published`), or a request with the same Idempotency-Key is still running (`idempotency-key-in-use`)',
  )
  @ApiProblemResponse(
    502,
    'The documents service refused to revoke the manifest (`manifest-revocation-refused`); nothing is withdrawn',
  )
  @ApiProblemResponse(
    503,
    'Documents could not be reached (`documents-unavailable`); nothing is withdrawn',
  )
  withdraw(
    @CurrentPrincipal() principal: Principal,
    @Param('releaseId', new ZodValidationPipe(z.uuid())) releaseId: string,
    @Body(new ZodValidationPipe(withdrawBody)) body: WithdrawBody,
  ): Promise<OpenDataReleaseView> {
    return this.openData.withdraw(principal, releaseId, body.reason);
  }
}
