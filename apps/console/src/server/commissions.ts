import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { commissionSlug } from './commission-slug';
import { asViewer } from './as-viewer.server';
import {
  type AssignReportingOfficer,
  callDirectory,
  type Commission,
  type CommissionPage,
  type CreateCommission,
  type DirectoryResult,
  type OfficerCategory,
} from './directory/client';
import { OFFICER_CATEGORY_CODES } from './directory/contract';

export const listCommissionsInput = z.object({
  search: z.string().max(100).optional(),
  type: z.enum(['hosted', 'federated']).optional(),
  reportingOfficer: z.enum(['none', 'invited', 'activated']).optional(),
  cursor: z.string().optional(),
});

export type ListCommissionsInput = z.infer<typeof listCommissionsInput>;

/** `GET /v1/commissions`: one page, ordered by name, with the number of matches. */
export const listCommissions = createServerFn({ method: 'GET' })
  .validator(listCommissionsInput)
  .handler(({ data }): Promise<DirectoryResult<CommissionPage>> =>
    asViewer((client) =>
      callDirectory(() => client.GET('/v1/commissions', { params: { query: data } })),
    ),
  );

/** `GET /v1/commissions/{slug}`: 404 problem when missing or not visible to the viewer. */
export const getCommission = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: commissionSlug }))
  .handler(({ data }): Promise<DirectoryResult<Commission>> =>
    asViewer((client) =>
      callDirectory(() =>
        client.GET('/v1/commissions/{slug}', { params: { path: { slug: data.slug } } }),
      ),
    ),
  );

/** `GET /v1/reference/officer-categories`: the statutory list in stable order. */
export const listOfficerCategories = createServerFn({ method: 'GET' }).handler(
  (): Promise<DirectoryResult<OfficerCategory[]>> =>
    asViewer((client) => callDirectory(() => client.GET('/v1/reference/officer-categories'))),
);

export const createCommissionInput = z.object({
  /** One per form instance, reused on retry (spec 01). */
  idempotencyKey: z.uuid(),
  // Loose bounds only: the directory validates and its 400 problem maps back to the form.
  commission: z.object({
    slug: z.string().max(100),
    name: z.string().max(500),
    type: z.enum(['hosted', 'federated']),
    categories: z.array(z.enum(OFFICER_CATEGORY_CODES)).max(OFFICER_CATEGORY_CODES.length),
  }) satisfies z.ZodType<CreateCommission>,
});

/**
 * `POST /v1/commissions` with the form's Idempotency-Key. The directory allows platform admins
 * only; anyone else gets its 403 problem.
 */
export const createCommission = createServerFn({ method: 'POST' })
  .validator(createCommissionInput)
  .handler(({ data }): Promise<DirectoryResult<Commission>> =>
    asViewer((client) =>
      callDirectory(() =>
        client.POST('/v1/commissions', {
          params: { header: { 'Idempotency-Key': data.idempotencyKey } },
          body: data.commission,
        }),
      ),
    ),
  );

export const assignReportingOfficerInput = z.object({
  slug: commissionSlug,
  /** One per dialog submission, reused on retry (spec 01). */
  idempotencyKey: z.uuid(),
  // Loose bounds only: the directory validates and its 400 problem maps back to the dialog.
  officer: z.object({
    name: z.string().max(500),
    email: z.string().max(500),
    phone: z.string().max(40),
  }) satisfies z.ZodType<AssignReportingOfficer>,
});

/**
 * `PUT /v1/commissions/{slug}/reporting-officer` with the dialog's Idempotency-Key: invites the
 * officer (one activation email), replacing a current officer, who loses the role (and is
 * disabled when it was their only one).
 * Platform admins only; anyone else gets the 403 problem.
 */
export const assignReportingOfficer = createServerFn({ method: 'POST' })
  .validator(assignReportingOfficerInput)
  .handler(({ data }): Promise<DirectoryResult<Commission>> =>
    asViewer((client) =>
      callDirectory(() =>
        client.PUT('/v1/commissions/{slug}/reporting-officer', {
          params: {
            path: { slug: data.slug },
            header: { 'Idempotency-Key': data.idempotencyKey },
          },
          body: data.officer,
        }),
      ),
    ),
  );

/**
 * `POST /v1/commissions/{slug}/reporting-officer/resend-invitation`: a new activation email for
 * an invited officer (202, no body). No Idempotency-Key: repeating it only sends another email.
 */
export const resendInvitation = createServerFn({ method: 'POST' })
  .validator(z.object({ slug: commissionSlug }))
  .handler(({ data }): Promise<DirectoryResult<null>> =>
    asViewer(async (client) => {
      const result = await callDirectory(() =>
        client.POST('/v1/commissions/{slug}/reporting-officer/resend-invitation', {
          params: { path: { slug: data.slug } },
          // 202 has no body; read it as text so an empty response is never parsed as JSON.
          parseAs: 'text',
        }),
      );
      return result.ok ? { ok: true, data: null } : result;
    }),
  );
