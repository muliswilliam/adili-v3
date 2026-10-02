import { HttpStatus } from '@nestjs/common';
import { ProblemException } from '@adili/api-kit';

import { upstreamUnavailable } from '../internal-api/upstream.js';

/**
 * The ai-gateway could not be reached for a reviewer's request: 503, nothing was recorded, so the
 * caller can try again.
 */
export function aiGatewayUnavailable(
  detail = 'The AI gateway cannot be reached. Try again shortly.',
): ProblemException {
  return upstreamUnavailable('ai-gateway', detail, HttpStatus.SERVICE_UNAVAILABLE);
}

/** The ai-gateway's classification gate does not let the Commission's cases be sent: 409. */
export function aiNotEnabled(): ProblemException {
  return new ProblemException(
    {
      type: 'ai-not-enabled',
      title: 'AI assistance not enabled',
      status: HttpStatus.CONFLICT,
      detail: 'AI assistance is not enabled for this Commission.',
    },
    { code: 'ai-not-enabled' },
  );
}
