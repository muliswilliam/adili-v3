import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import type { Principal } from './principal.js';
import { IS_PUBLIC } from './public.decorator.js';
import { TokenVerifier } from './token-verifier.js';

export type AuthenticatedRequest = FastifyRequest & { principal?: Principal };

/** Global guard: every HTTP route needs a valid bearer token unless marked `@Public()`. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: TokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Event handlers are authorised by broker credentials, not user tokens.
    if (context.getType() !== 'http') {
      return true;
    }
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Missing bearer token');
    }
    try {
      request.principal = await this.verifier.verify(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    return true;
  }
}
