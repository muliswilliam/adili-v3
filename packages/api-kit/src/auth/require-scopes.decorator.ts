import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedRequest } from './jwt-auth.guard.js';

const REQUIRED_SCOPES = Symbol('REQUIRED_SCOPES');

/** Admits the caller only when its token carries every scope required by `@RequireScopes`. */
@Injectable()
export class ScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndOverride<string[] | undefined>(REQUIRED_SCOPES, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const granted = context.switchToHttp().getRequest<AuthenticatedRequest>().principal?.scopes;
    if (!required.every((scope) => granted?.includes(scope))) {
      throw new ForbiddenException(`Requires scope ${required.join(' ')}`);
    }
    return true;
  }
}

/**
 * Restricts a route or controller to tokens carrying all the given OAuth scopes, as issued to
 * machine clients through client credentials. Runs after the global bearer-token guard.
 */
export const RequireScopes = (...scopes: string[]) =>
  applyDecorators(SetMetadata(REQUIRED_SCOPES, scopes), UseGuards(ScopesGuard));
