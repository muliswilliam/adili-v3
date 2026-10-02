import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { type AuthenticatedRequest, notFoundIfInvisible, type Principal } from '@adili/api-kit';
import { notTheAssignee } from '../cases/access.js';

/** Only the case's assignee composes and issues its clarifications (spec 07a authorisation). */
export function requireAssignee(principal: Principal, assignee: string | null): void {
  if (assignee !== principal.subject) {
    throw notTheAssignee("Only the case's assignee can compose and issue its clarifications.");
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
