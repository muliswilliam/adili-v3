import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  CurrentPrincipal,
  type Principal,
  RequireIdempotencyKey,
  Roles,
  schemaRef,
  ZodValidationPipe,
} from '@adili/api-kit';

import { REPORTING_OFFICER_ROLE } from '../../commissions/access.js';
import { RosterExitsService } from './exits.service.js';
import {
  type ConfirmExitsBody,
  confirmExitsBody,
  type ExitsResult,
  type KeepResult,
  type KeepRosterRecordsBody,
  keepRosterRecordsBody,
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
  @Roles(REPORTING_OFFICER_ROLE)
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

  @Post('keep')
  @Roles(REPORTING_OFFICER_ROLE)
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
