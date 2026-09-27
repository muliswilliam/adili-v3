import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProblemResponse, CurrentPrincipal, type Principal, schemaRef } from '@adili/api-kit';

@ApiTags('me')
@Controller('v1/me')
export class MeController {
  @Get()
  @ApiOperation({
    operationId: 'getMe',
    summary: 'The signed-in user, tenant and roles, as seen by the platform',
    description:
      'Any authenticated caller. Reads the verified access token; the BFFs use it to decide what a user may open.',
  })
  @ApiOkResponse({
    description: 'Verified identity from the access token',
    schema: schemaRef('Principal'),
  })
  @ApiProblemResponse(401, 'Missing, expired or invalid access token')
  me(@CurrentPrincipal() principal: Principal): Principal {
    return principal;
  }
}
