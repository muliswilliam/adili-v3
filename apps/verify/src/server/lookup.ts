import { clientIp } from '@adili/api-kit/client';
import { VERIFICATION_ID_PATTERN } from '@adili/events/contracts';
import { createServerFn } from '@tanstack/react-start';
import { getRequestHeaders, getRequestIP } from '@tanstack/react-start/server';
import { z } from 'zod';

import type { LookupOutcome } from '../lib/lookup-outcome';
import { env } from './env.server';
import { lookUp } from './lookup.server';
import { verificationClient } from './verification/client.server';

/**
 * Looks a normalised verification code up in verification-api on behalf of the visitor. Runs
 * on the server, in the page request for a scanned QR code, so the first response already
 * carries the result.
 */
export const lookUpDocument = createServerFn({ method: 'GET' })
  .validator(z.object({ verificationId: z.string().regex(VERIFICATION_ID_PATTERN) }))
  .handler(async ({ data }): Promise<LookupOutcome> => {
    const ip = clientIp(getRequestHeaders(), getRequestIP(), env().TRUSTED_PROXY_HOPS);
    return lookUp(verificationClient(ip), data.verificationId);
  });
