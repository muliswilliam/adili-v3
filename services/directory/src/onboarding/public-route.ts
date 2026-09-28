import { applyDecorators, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { ApiHeader, ApiParam, ApiTags, DECORATORS } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  type AuthenticatedRequest,
  Public,
  RequireIdempotencyKey,
} from '@adili/api-kit';

import { config } from '../config.js';
import { keyedHash } from './secret.js';

/** The header the portal BFF copies the session secret into from its httpOnly cookie. */
export const ONBOARDING_SECRET_HEADER = 'x-onboarding-secret';

/**
 * A controller of the public onboarding API: no bearer token (`@Public()`), and so no security
 * requirement in the contract (`security: []`), tagged `onboarding`.
 */
export const OnboardingController = () =>
  applyDecorators(ApiTags('onboarding'), Public(), noSecurityRequirement);

function noSecurityRequirement(target: object): void {
  Reflect.defineMetadata(DECORATORS.API_SECURITY, [], target);
}

/**
 * The session secret from `X-Onboarding-Secret`, or undefined. Pass it to
 * `OnboardingSessions.withLiveSession`, which answers 404 when it is missing or wrong.
 */
export const SessionSecret = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | undefined => {
    const value = context.switchToHttp().getRequest<AuthenticatedRequest>().headers[
      ONBOARDING_SECRET_HEADER
    ];
    return typeof value === 'string' && value !== '' ? value : undefined;
  },
);

/**
 * Documents what every route on one session takes and may answer: the `sessionId` path
 * parameter, the `X-Onboarding-Secret` header, 404 (unknown session or wrong secret) and 410
 * `session-expired`. For routes under `v1/onboarding/sessions/:sessionId`.
 */
export const ApiSessionRoute = () =>
  applyDecorators(
    ApiParam({ name: 'sessionId', schema: { type: 'string', format: 'uuid' } }),
    ApiHeader({
      name: 'X-Onboarding-Secret',
      required: true,
      description:
        'Session secret returned once at creation; held by the portal BFF in an httpOnly cookie',
      schema: { type: 'string' },
    }),
    ApiProblemResponse(404, 'No such session, or the secret is missing or wrong'),
    ApiProblemResponse(
      410,
      'Problem code `session-expired`: the session ended or ran out of time; the BFF clears its cookie',
      'OnboardingProblem',
    ),
  );

/**
 * `@RequireIdempotencyKey()` for a session route (ADR-013 §7.5): the portal sends one key per
 * submission, and a retry with it gets the first answer back instead of running the step again.
 * Session routes have no token, so keys belong to the session and the secret presented (a keyed
 * hash of both, never the secret): a caller without the secret never sees a stored answer, and
 * its request runs, and fails, like any other.
 */
export const SessionIdempotencyKey = () => RequireIdempotencyKey({ owner: sessionKeyOwner });

function sessionKeyOwner(request: AuthenticatedRequest): string {
  const { sessionId } = request.params as { sessionId?: string };
  const secret = request.headers[ONBOARDING_SECRET_HEADER];
  return `onboarding-session:${keyedHash(
    config.ONBOARDING_HMAC_KEY,
    'idempotency',
    sessionId ?? '',
    typeof secret === 'string' ? secret : '',
  )}`;
}
