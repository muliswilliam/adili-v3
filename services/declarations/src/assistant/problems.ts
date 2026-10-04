import { HttpStatus } from '@nestjs/common';
import { ProblemException } from '@adili/api-kit';

/** 503: the ai-gateway cannot answer now; nothing was stored, and help search still works. */
export function assistantUnavailable(): ProblemException {
  return new ProblemException({
    type: 'assistant-unavailable',
    title: 'Assistant unavailable',
    status: HttpStatus.SERVICE_UNAVAILABLE,
    detail: 'Answers are unavailable right now; search the help instead.',
  });
}
