import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { asViewer } from './as-viewer.server';
import { commissionSlug } from './commission-slug';
import { callDirectory, type DirectoryResult, type OnboardingFailures } from './directory/client';

/**
 * `GET /v1/commissions/{slug}/roster/onboarding-failures`: failed onboarding attempts against the
 * Commission in the last 24 hours, by hour (spec 03, story 30). Counts only, no identifiers. Its
 * reporting officer and commission admin, and national roles for every Commission.
 */
export const getOnboardingFailures = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: commissionSlug }))
  .handler(({ data }): Promise<DirectoryResult<OnboardingFailures>> =>
    asViewer((client) =>
      callDirectory(() =>
        client.GET('/v1/commissions/{slug}/roster/onboarding-failures', {
          params: { path: { slug: data.slug } },
        }),
      ),
    ),
  );
