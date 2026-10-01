import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';

import { getBff } from './bff.server';
import type { Unauthenticated } from './results';
import { type StepUpStatus, stepUpStatus } from './step-up.server';

/** The session's step-up state (`acr`, `auth_time`). Runs on the server; tokens never leave it. */
export const getStepUpStatus = createServerFn({ method: 'GET' }).handler(
  async (): Promise<StepUpStatus | Unauthenticated> =>
    stepUpStatus(await getBff().getSession(getRequest())),
);
