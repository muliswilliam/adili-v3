import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { asDeclarant } from './bff.server';
import { declarationsClient } from './declarations/client.server';
import type { Unauthenticated } from './results';
import {
  loadSubmission,
  type SubmissionLoad,
  submitDeclaration,
  type SubmitOutcome,
} from './submission.server';

/** Server functions for submitting a declaration (spec 06). Tokens stay on the server. */

export const submitMyDeclaration = createServerFn({ method: 'POST' })
  .validator(z.object({ declarationId: z.uuid(), idempotencyKey: z.uuid() }))
  .handler(({ data }): Promise<SubmitOutcome | Unauthenticated> =>
    asDeclarant(declarationsClient, (client) => submitDeclaration(client, data)),
  );

export const getMySubmission = createServerFn({ method: 'GET' })
  .validator(z.object({ declarationId: z.uuid() }))
  .handler(({ data }): Promise<SubmissionLoad | Unauthenticated> =>
    asDeclarant(declarationsClient, (client) => loadSubmission(client, data.declarationId)),
  );
