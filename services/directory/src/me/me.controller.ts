import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, type Principal, schemaRef } from '@adili/api-kit';

@ApiTags('me')
@Controller('v1/me')
export class MeController {
  @Get()
  @ApiOperation({
    operationId: 'getMe',
    summary: 'The signed-in user, tenant and roles, as seen by the platform',
  })
  @ApiOkResponse({
    description: 'Verified identity from the access token',
    schema: schemaRef('Principal'),
  })
  me(@CurrentPrincipal() principal: Principal): Principal {
    return principal;
  }
}
