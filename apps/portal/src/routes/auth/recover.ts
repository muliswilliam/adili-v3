import { createFileRoute } from '@tanstack/react-router';

import { env } from '../../server/env.server';
import { recoverAccessUrl } from '../../server/recover-access';

/** Sends the browser to Keycloak's "Forgot password" page (see server/recover-access.ts). */
export const Route = createFileRoute('/auth/recover')({
  server: {
    handlers: {
      GET: () => {
        const config = env();
        return Response.redirect(
          recoverAccessUrl(config.OIDC_ISSUER_URL, config.OIDC_CLIENT_ID),
          302,
        );
      },
    },
  },
});
