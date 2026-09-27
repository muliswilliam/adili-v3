import { Controller, Get, Query, StreamableFile } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProblemResponse, ApiQueryParameters, Roles, ZodValidationPipe } from '@adili/api-kit';
import { z } from 'zod';

import { REPORTING_OFFICER_ROLE } from '../commissions/access.js';
import { ROSTER_TEMPLATE_FORMATS, rosterTemplate } from './template.js';

/** Roles that may download the roster template (spec 02 authorisation matrix). */
export const ROSTER_TEMPLATE_ROLES = [
  REPORTING_OFFICER_ROLE,
  'commission-admin',
  'platform-admin',
  'eacc-analyst',
  'eacc-supervisor',
] as const;

const rosterTemplateQuery = z.object({
  format: z.enum(ROSTER_TEMPLATE_FORMATS).meta({ description: 'File format of the template' }),
});

type RosterTemplateQuery = z.infer<typeof rosterTemplateQuery>;

@ApiTags('roster')
@Controller('v1/roster')
export class RosterController {
  @Get('template')
  @Roles(...ROSTER_TEMPLATE_ROLES)
  @ApiOperation({
    operationId: 'getRosterTemplate',
    summary: 'Roster template with column notes and a sample row',
    description:
      'reporting-officer, commission-admin, platform-admin, eacc-analyst and eacc-supervisor. The nine roster columns as headers and a sample row, generated from the same column definitions the import parser uses. The XLSX has a `Roster` sheet (file number and phone columns formatted as text) and a `Notes` sheet documenting each column. Sent as an attachment (`Content-Disposition`).',
  })
  @ApiQueryParameters(rosterTemplateQuery)
  @ApiOkResponse({
    description: 'The template file',
    content: {
      'text/csv': { schema: { type: 'string' } },
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiProblemResponse(400, 'Query failed validation')
  @ApiProblemResponse(403, 'The caller may not download the template')
  async template(
    @Query(new ZodValidationPipe(rosterTemplateQuery)) query: RosterTemplateQuery,
  ): Promise<StreamableFile> {
    const file = await rosterTemplate(query.format);
    return new StreamableFile(file.body, {
      type: file.contentType,
      disposition: `attachment; filename="${file.fileName}"`,
      length: file.body.length,
    });
  }
}
