import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiForbiddenResponse } from '@nestjs/swagger';

import { ProblemException } from '../problem-details.filter.js';
import type { AuthenticatedRequest } from './jwt-auth.guard.js';

const ROLES = Symbol('ROLES');

/**
 * Restricts a controller or route to callers holding at least one of `roles` (realm roles from
 * the token). Others get 403 problem details. Runs after bearer-token authentication, so the
 * route must not be `@Public()`. A route-level `@Roles` replaces a controller-level one.
 *
 * Roles say what a caller may do, not which records they may see: combine with
 * `notFoundIfInvisible` for tenant visibility.
 *
 * @example
 * @Post()
 * @Roles('platform-admin')
 * create() {}
 */
export const Roles = (...roles: [string, ...string[]]) =>
  applyDecorators(
    SetMetadata(ROLES, roles),
    UseGuards(RolesGuard),
    ApiForbiddenResponse({ description: `Requires one of the roles: ${roles.join(', ')}` }),
  );

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<readonly string[] | undefined>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) {
      return true;
    }
    const principal = context.switchToHttp().getRequest<AuthenticatedRequest>().principal;
    if (principal?.roles.some((role) => required.includes(role))) {
      return true;
    }
    throw new ProblemException({
      type: 'about:blank',
      title: 'Forbidden',
      status: HttpStatus.FORBIDDEN,
      detail: 'Your roles do not allow this operation.',
    });
  }
}

/**
 * Returns `resource` when it exists and the caller may see it; otherwise throws 404 problem
 * details. Invisible and missing look the same, so a caller cannot probe for records outside
 * their tenant (403 would confirm that the record exists).
 *
 * @example
 * const commission = notFoundIfInvisible(await find(slug), (c) => canSee(principal, c));
 */
export function notFoundIfInvisible<T>(
  resource: T | null | undefined,
  isVisible: (resource: T) => boolean = () => true,
): T {
  if (resource === null || resource === undefined || !isVisible(resource)) {
    throw new ProblemException({
      type: 'about:blank',
      title: 'Not Found',
      status: HttpStatus.NOT_FOUND,
      detail: 'The resource does not exist or is not visible to you.',
    });
  }
  return resource;
}
