import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, type Principal } from '@adili/api-kit';

@ApiTags('me')
@ApiBearerAuth()
@Controller('v1/me')
export class MeController {
  @Get()
  @ApiOperation({ summary: 'The signed-in user, tenant and roles, as seen by the platform' })
  @ApiOkResponse({ description: 'Verified identity from the access token' })
  me(@CurrentPrincipal() principal: Principal): Principal {
    return principal;
  }
}
