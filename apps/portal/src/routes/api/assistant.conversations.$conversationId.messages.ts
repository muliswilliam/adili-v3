import { createFileRoute } from '@tanstack/react-router';

import { relayAnswer } from '../../server/assistant-stream.server';
import { getBff } from '../../server/bff.server';
import { declarationsClient } from '../../server/declarations/client.server';
import { env } from '../../server/env.server';

/** Ask Adili's streamed answer for the signed-in declarant (see `relayAnswer`). */
export const Route = createFileRoute('/api/assistant/conversations/$conversationId/messages')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const session = await getBff().getSession(request);
        return relayAnswer(
          request,
          params.conversationId,
          session ? declarationsClient(session.accessToken) : null,
          env().APP_URL,
        );
      },
    },
  },
});
