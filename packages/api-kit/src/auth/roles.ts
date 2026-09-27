import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DECORATORS } from '@nestjs/swagger';

import { ApiProblemResponse } from '../openapi.js';
import { ProblemException } from '../problem-details.filter.js';
import type { AuthenticatedRequest } from './jwt-auth.guard.js';

const ROLES = Symbol('ROLES');
const SCOPES = Symbol('SCOPES');

/**
 * Restricts a controller or route to callers holding at least one of `roles` (realm roles from
 * the token). Others get 403 problem details. Runs after bearer-token authentication, so the
 * route must not be `@Public()`.
 *
 * Add `@Scopes` to also admit machine clients: the caller then needs any one of the roles or any
 * one of the scopes. A route-level `@Roles` or `@Scopes` replaces both set at controller level.
 *
 * Roles say what a caller may do, not which records they may see: combine with
 * `notFoundIfInvisible` for tenant visibility.
 *
 * @example
 * @Post()
 * @Roles('platform-admin')
 * create() {}
 */
export const Roles = (...roles: [string, ...string[]]) => accessRule(ROLES, roles);

/**
 * Restricts a controller or route to tokens carrying at least one of `scopes` (the `scope`
 * claim), as machine clients get through client credentials. Others get 403 problem details.
 * Together with `@Roles` on the same target, a role or a scope admits the caller.
 *
 * @example
 * @Post('batches')
 * @Roles('reporting-officer')
 * @Scopes('roster:write')
 * upsertBatch() {}
 */
export const Scopes = (...scopes: [string, ...string[]]) => accessRule(SCOPES, scopes);

interface AccessRule {
  roles: readonly string[];
  scopes: readonly string[];
}

/**
 * Records one half of a target's access rule. Whichever of `@Roles` and `@Scopes` is applied
 * last sees both halves, so the 403 documents the combined rule and the guard runs once.
 */
function accessRule(key: symbol, values: readonly string[]): ClassDecorator & MethodDecorator {
  return (target: object, propertyKey?: string | symbol, descriptor?: PropertyDescriptor) => {
    const holder = (descriptor?.value as object | undefined) ?? target;
    const firstHalf = readRule(holder, readOwnMetadata) !== undefined;
    if (firstHalf) {
      // Swagger appends a second description for the same status; replace the half-rule one.
      const responses = {
        ...(Reflect.getMetadata(DECORATORS.API_RESPONSE, holder) as
          Record<number, unknown> | undefined),
      };
      delete responses[403];
      Reflect.defineMetadata(DECORATORS.API_RESPONSE, responses, holder);
    }
    Reflect.defineMetadata(key, values, holder);
    const rule = readRule(holder, readOwnMetadata) ?? { roles: [], scopes: [] };
    const decorator = applyDecorators(
      ...(firstHalf ? [] : [UseGuards(RolesGuard)]),
      ApiProblemResponse(HttpStatus.FORBIDDEN, `Requires ${describeRule(rule)}`),
    );
    decorator(target, propertyKey, descriptor);
  };
}

type MetadataReader = (key: symbol, target: object) => readonly string[] | undefined;

const readOwnMetadata: MetadataReader = (key, target) =>
  Reflect.getMetadata(key, target) as readonly string[] | undefined;

function readRule(target: object, read: MetadataReader): AccessRule | undefined {
  const roles = read(ROLES, target);
  const scopes = read(SCOPES, target);
  return roles || scopes ? { roles: roles ?? [], scopes: scopes ?? [] } : undefined;
}

function describeRule({ roles, scopes }: AccessRule): string {
  const parts = [];
  if (roles.length > 0) parts.push(`one of the roles: ${roles.join(', ')}`);
  if (scopes.length > 0) parts.push(`one of the scopes: ${scopes.join(', ')}`);
  return parts.join(', or ');
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const read: MetadataReader = (key, target) =>
      this.reflector.get<readonly string[] | undefined>(key, target as () => void);
    const rule = readRule(context.getHandler(), read) ?? readRule(context.getClass(), read);
    if (!rule) {
      return true;
    }
    const principal = context.switchToHttp().getRequest<AuthenticatedRequest>().principal;
    if (
      principal?.roles.some((role) => rule.roles.includes(role)) ||
      principal?.scopes.some((scope) => rule.scopes.includes(scope))
    ) {
      return true;
    }
    throw new ProblemException({
      type: 'about:blank',
      title: 'Forbidden',
      status: HttpStatus.FORBIDDEN,
      detail:
        rule.scopes.length > 0
          ? 'Your roles and scopes do not allow this operation.'
          : 'Your roles do not allow this operation.',
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
