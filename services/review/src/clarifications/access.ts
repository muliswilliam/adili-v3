import { createParamDecorator, type ExecutionContext, HttpStatus } from '@nestjs/common';
import {
  type AuthenticatedRequest,
  notFoundIfInvisible,
  type Principal,
  ProblemException,
} from '@adili/api-kit';

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

/**
 * The declarant's person id (`person_id` on the verified principal; staff have none); a caller
 * without one gets 404, as if nothing existed.
 */
export const DeclarantPerson = createParamDecorator((_: unknown, context: ExecutionContext) =>
  notFoundIfInvisible(
    context.switchToHttp().getRequest<AuthenticatedRequest>().principal?.personId ?? null,
  ),
);
