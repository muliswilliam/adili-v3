import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { AuthenticatedRequest } from './jwt-auth.guard.js';
import type { Principal } from './principal.js';

/** Injects the verified caller into a route handler. */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const principal = context.switchToHttp().getRequest<AuthenticatedRequest>().principal;
    if (!principal) {
      throw new Error('CurrentPrincipal used on a public route');
    }
    return principal;
  },
);
