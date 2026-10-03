import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import {
  OBLIGATION_FILTER_STATUSES,
  OBLIGATION_TYPES,
  obligationsQuery,
} from '../components/obligations/obligations-query';
import { asDeclarationsViewer } from './as-viewer.server';
import { commissionSlug } from './commission-slug';
import {
  callDeclarations,
  type CommissionObligationsSummary,
  type DeclarationProgress,
  type DeclarationsResult,
  type NationalObligationsSummary,
  type ObligationDetail,
  type ObligationPage,
} from './declarations/client';

/**
 * `GET /v1/commissions/{slug}/obligations/summary`: counts by type and status, and declarants due
 * or overdue who have not onboarded. Staff of the Commission, platform admins and EACC staff;
 * 404 for another Commission.
 */
export const getCommissionObligationsSummary = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: commissionSlug }))
  .handler(({ data }): Promise<DeclarationsResult<CommissionObligationsSummary>> =>
    asDeclarationsViewer((client) =>
      callDeclarations(() =>
        client.GET('/v1/commissions/{slug}/obligations/summary', {
          params: { path: { slug: data.slug } },
        }),
      ),
    ),
  );

/**
 * `GET /v1/commissions/{slug}/declarations/progress`: a cycle's obligations per reporting entity,
 * not started, in progress, submitted and late (the current cycle without `cycle`). Counts only.
 * The Commission's reporting officers and commission admins; 404 for anyone else.
 */
export const getDeclarationProgress = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: commissionSlug, cycle: z.string().max(40).optional() }))
  .handler(({ data }): Promise<DeclarationsResult<DeclarationProgress>> =>
    asDeclarationsViewer((client) =>
      callDeclarations(() =>
        client.GET('/v1/commissions/{slug}/declarations/progress', {
          params: { path: { slug: data.slug }, query: data.cycle ? { cycle: data.cycle } : {} },
        }),
      ),
    ),
  );

export const listCommissionObligationsInput = z.object({
  slug: commissionSlug,
  search: z.string().max(100).optional(),
  type: z.enum(OBLIGATION_TYPES).optional(),
  status: z.enum(OBLIGATION_FILTER_STATUSES).optional(),
  onboarded: z.boolean().optional(),
  cycle: z.string().max(40).optional(),
  cursor: z.string().min(1).nullable().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

/**
 * `GET /v1/commissions/{slug}/obligations`: one page, overdue first then by due date. 403 for
 * EACC staff (counts only); 404 for another Commission.
 */
export const listCommissionObligations = createServerFn({ method: 'GET' })
  .validator(listCommissionObligationsInput)
  .handler(({ data }): Promise<DeclarationsResult<ObligationPage>> => {
    const { slug, cursor, limit, ...filters } = data;
    return asDeclarationsViewer((client) =>
      callDeclarations(() =>
        client.GET('/v1/commissions/{slug}/obligations', {
          params: { path: { slug }, query: obligationsQuery(filters, { cursor, limit }) },
        }),
      ),
    );
  });

/** `GET /v1/obligations/{id}`: one obligation with its reminder history; 404 when not visible. */
export const getObligation = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.uuid() }))
  .handler(({ data }): Promise<DeclarationsResult<ObligationDetail>> =>
    asDeclarationsViewer((client) =>
      callDeclarations(() =>
        client.GET('/v1/obligations/{id}', { params: { path: { id: data.id } } }),
      ),
    ),
  );

/**
 * `GET /v1/obligations/summary`: counts per Commission for a cycle, with totals. EACC staff and
 * platform admins; 403 for anyone else.
 */
export const getNationalObligationsSummary = createServerFn({ method: 'GET' })
  .validator(z.object({ cycle: z.string().max(40).optional() }))
  .handler(({ data }): Promise<DeclarationsResult<NationalObligationsSummary>> =>
    asDeclarationsViewer((client) =>
      callDeclarations(() =>
        client.GET('/v1/obligations/summary', {
          params: { query: data.cycle ? { cycle: data.cycle } : {} },
        }),
      ),
    ),
  );
