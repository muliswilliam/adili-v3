import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { findPerson } from './account-support.server';
import { withViewerClient } from './as-viewer.server';
import type { ServiceResult } from './service-call';
import { supportClient } from './support/client.server';
import type { PersonSummary } from './support/types';

/** An officer reference's shape (ADR-011); the directory checks its check character. */
export const OFR_PATTERN = /^OFR-[0-9]{7}-[0-9A-Z]$/;

/** Server function for Account support, called as the signed-in helpdesk user. */
export const lookUpPerson = createServerFn({ method: 'GET' })
  .validator(z.object({ ofr: z.string().regex(OFR_PATTERN) }))
  .handler(({ data }): Promise<ServiceResult<PersonSummary>> =>
    withViewerClient(supportClient, (client) => findPerson(client, data.ofr)),
  );
