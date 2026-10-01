import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { asViewer } from './as-viewer.server';
import { commissionSlug } from './commission-slug';
import {
  callDirectory,
  type DirectoryResult,
  type TenantPolicyHistory,
  type TenantPolicyVersion,
} from './directory/client';

/**
 * `GET /v1/commissions/{slug}/policy`: the policy version in force and the ones it replaced.
 * Staff of the Commission and platform admins; 404 for another Commission.
 */
export const getTenantPolicy = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: commissionSlug }))
  .handler(({ data }): Promise<DirectoryResult<TenantPolicyHistory>> =>
    asViewer((client) =>
      callDirectory(() =>
        client.GET('/v1/commissions/{slug}/policy', { params: { path: { slug: data.slug } } }),
      ),
    ),
  );

export const createTenantPolicyVersionInput = z.object({
  slug: commissionSlug,
  /** One per dialog, reused on retry after a network failure or 5xx. */
  idempotencyKey: z.uuid(),
  obligationsStartDate: z.iso.date(),
});

/**
 * `POST /v1/commissions/{slug}/policy/versions`: a new version, in force now, with a new
 * obligations start date and everything else copied. Commission admins of the tenant and
 * platform admins; anyone else gets the directory's 403.
 */
export const createTenantPolicyVersion = createServerFn({ method: 'POST' })
  .validator(createTenantPolicyVersionInput)
  .handler(({ data }): Promise<DirectoryResult<TenantPolicyVersion>> =>
    asViewer((client) =>
      callDirectory(() =>
        client.POST('/v1/commissions/{slug}/policy/versions', {
          params: {
            path: { slug: data.slug },
            header: { 'Idempotency-Key': data.idempotencyKey },
          },
          body: { obligationsStartDate: data.obligationsStartDate },
        }),
      ),
    ),
  );
