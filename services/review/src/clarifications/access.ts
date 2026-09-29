import { createParamDecorator, type ExecutionContext, HttpStatus } from '@nestjs/common';
import {
  type AuthenticatedRequest,
  notFoundIfInvisible,
  type Principal,
  ProblemException,
} from '@adili/api-kit';
import { z } from 'zod';

/** Only the case's assignee composes and issues its clarifications (spec 07a authorisation). */
export function requireAssignee(principal: Principal, assignee: string | null): void {
  if (assignee !== principal.subject) {
    throw new ProblemException({
      type: 'not-the-assignee',
      title: 'Forbidden',
      status: HttpStatus.FORBIDDEN,
      detail: "Only the case's assignee can compose and issue its clarifications.",
    });
  }
}

const personId = z.uuid();

/**
 * The declarant's person id: the `person_id` claim of the token the global guard has verified in
 * this request (onboarded declarants carry it; staff tokens do not). Absent or malformed: null.
 */
export function declarantPersonOf(request: AuthenticatedRequest): string | null {
  const [, token] = request.headers.authorization?.split(' ') ?? [];
  const payload = token?.split('.')[1];
  if (!request.principal || !payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      person_id?: unknown;
    };
    const parsed = personId.safeParse(claims.person_id);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The declarant's person id; a caller without one gets 404, as if nothing existed. */
export const DeclarantPerson = createParamDecorator((_: unknown, context: ExecutionContext) =>
  notFoundIfInvisible(declarantPersonOf(context.switchToHttp().getRequest<AuthenticatedRequest>())),
);
