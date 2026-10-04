import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { asDeclarant } from './bff.server';
import {
  decisionLetter,
  type DecisionLetterResult,
  loadMyDecisions,
  type MyDecisionsResult,
} from './decisions.server';
import type { Unauthenticated } from './results';
import { reviewClient } from './review/client.server';

/** Server functions for the declarant's decisions (spec 08 FE-7). Tokens stay on the server. */

export type MyDecisionsLoad = MyDecisionsResult | Unauthenticated;

export const getMyDecisions = createServerFn({ method: 'GET' }).handler(
  (): Promise<MyDecisionsLoad> => asDeclarant(reviewClient, loadMyDecisions),
);

/** The decision letter's download link; a bulk closure's letter is issued on this request. */
export const getMyDecisionLetter = createServerFn({ method: 'GET' })
  .validator(z.object({ determinationId: z.uuid() }))
  .handler(({ data }): Promise<DecisionLetterResult | Unauthenticated> =>
    asDeclarant(reviewClient, (client) => decisionLetter(client, data.determinationId)),
  );
