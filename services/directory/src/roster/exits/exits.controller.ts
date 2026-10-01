import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  CurrentPrincipal,
  type Principal,
  RATE_LIMIT_HEADERS,
  RequireIdempotencyKey,
  Roles,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';
import { REPORTING_OFFICER } from '@adili/roles';

import { HrSystemAccess } from '../api-credential/hr-system-access.js';
import type { RosterRecord } from '../records/representation.js';
import { RosterExitsService } from './exits.service.js';
import {
  type ConfirmExitsBody,
  confirmExitsBody,
  type ExitsResult,
  fileNumberParam,
  type KeepResult,
  type KeepRosterRecordsBody,
  keepRosterRecordsBody,
  type RecordRosterExitBody,
  recordRosterExitBody,
} from './representation.js';

const NOT_VISIBLE = 'Not found: another Commission, or the Commission does not exist';
const NOT_ON_ROSTER =
  "Problem type `record-not-found`: some records are not on the Commission's roster; `errors` points at them and nothing was changed";

@ApiTags('roster')
@Controller('v1/commissions/:slug/roster')
@ApiParam({ name: 'slug', schema: schemaRef('Slug') })
export class RosterExitsController {
  constructor(private readonly exits: RosterExitsService) {}

  @Post('exits')
  @Roles(REPORTING_OFFICER)
  @RequireIdempotencyKey()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'confirmRosterExits',
    summary: 'Confirm exits for flagged (or any non-exited) records',
    description:
      'Reporting officer of the Commission. Exits every record or none: each becomes `exited` with its exit date and its absent flag cleared. Exited officers stay on the roster for their final declaration and no longer count as expected declarants. Records `roster.exits.confirmed.v1`. Idempotent per Idempotency-Key.',
  })
  @ApiBody({ required: true, schema: schemaRef('ConfirmExits') })
  @ApiOkResponse({ description: 'Records now exited', schema: schemaRef('ExitsResult') })
  @ApiProblemResponse(
    400,
    'Request failed validation: an exit date in the future or missing, or a record listed twice',
  )
  @ApiProblemResponse(404, `${NOT_VISIBLE}. ${NOT_ON_ROSTER}`)
  @ApiProblemResponse(
    409,
    'Problem type `record-exited`: some records have exited already; `errors` points at them and nothing was changed',
  )
  confirm(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(confirmExitsBody)) body: ConfirmExitsBody,
  ): Promise<ExitsResult> {
    return this.exits.confirm(principal, slug, body);
  }

  @Post('records/:fileNumber/exit')
  @Roles(REPORTING_OFFICER)
  @HrSystemAccess('roster-write')
  @RequireIdempotencyKey()
  @HttpCode(HttpStatus.OK)
  @ApiParam({
    name: 'fileNumber',
    description:
      'Personnel file number, URL-encoded (`/` as `%2F`, e.g. `PSC%2F2019%2F0888`); matched ignoring case and surrounding spaces',
    schema: { type: 'string', minLength: 1, maxLength: 30 },
  })
  @ApiOperation({
    operationId: 'recordRosterExit',
    summary: "Record one officer's exit by personnel file number (HR systems)",
    description:
      "The Commission's HR system (`roster:write`), or its reporting officer. Like confirming the exit of one record: `exited` with the exit date and the absent flag cleared; the officer stays on the roster for their final declaration and no longer counts as expected. Records `roster.exits.confirmed.v1` (source `api` for HR systems). Idempotent per Idempotency-Key.",
  })
  @ApiBody({ required: true, schema: schemaRef('RecordRosterExit') })
  @ApiOkResponse({
    description: 'The exited record',
    schema: schemaRef('RosterRecord'),
    headers: RATE_LIMIT_HEADERS,
  })
  @ApiProblemResponse(
    400,
    'Request failed validation: an exit date in the future or missing, or a file number longer than 30 characters',
  )
  @ApiProblemResponse(
    404,
    `${NOT_VISIBLE}. Problem type \`record-not-found\`: no officer on the roster has that personnel file number`,
  )
  @ApiProblemResponse(409, 'Problem type `record-exited`: the officer has exited already')
  recordExit(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Param('fileNumber', new ZodValidationPipe(fileNumberParam)) fileNumber: string,
    @Body(new ZodValidationPipe(recordRosterExitBody)) body: RecordRosterExitBody,
  ): Promise<RosterRecord> {
    return this.exits.recordExit(principal, slug, fileNumber, body);
  }

  @Post('keep')
  @Roles(REPORTING_OFFICER)
  @RequireIdempotencyKey()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'keepRosterRecords',
    summary: 'Clear the absent flag: these officers are still employed',
    description:
      'Reporting officer of the Commission. Clears the flag of the flagged records among them; the others are left as they are. Records `roster.records.kept.v1`. Idempotent per Idempotency-Key.',
  })
  @ApiBody({ required: true, schema: schemaRef('KeepRosterRecords') })
  @ApiOkResponse({ description: 'Count of records updated', schema: schemaRef('KeepResult') })
  @ApiProblemResponse(400, 'Request failed validation')
  @ApiProblemResponse(404, `${NOT_VISIBLE}. ${NOT_ON_ROSTER}`)
  keep(
    @CurrentPrincipal() principal: Principal,
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(keepRosterRecordsBody)) body: KeepRosterRecordsBody,
  ): Promise<KeepResult> {
    return this.exits.keep(principal, slug, body);
  }
}
