import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { ICMS_STATUSES } from '../components/referral-intake/statuses';
import { withViewerClient } from './as-viewer.server';
import { intakePackageDocumentsClient } from './documents/intake-package-client.server';
import {
  intakePackageLink,
  listReferralIntake,
  type PushResult,
  pushToIcms,
} from './referral-intake.server';
import { reportingClient } from './reporting/client.server';
import type { ReferralIntakePage } from './reporting/types';
import type { ServiceResult } from './service-call';

/**
 * Server functions for EACC's referrals intake (spec 09 S12), called as the signed-in EACC
 * analyst or supervisor. The reporting service decides who may list and push; the documents
 * service who may download a package. Tokens stay on the server.
 */

const id = z.uuid();

/** Rows per page: each row carries a package and a status line, so a page stays scannable. */
const INTAKE_PAGE_SIZE = 20;

export const getReferralIntake = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      icmsStatus: z.enum(ICMS_STATUSES).optional(),
      cursor: z.string().min(1).max(200).optional(),
    }),
  )
  .handler(({ data }): Promise<ServiceResult<ReferralIntakePage>> =>
    withViewerClient(reportingClient, (client) =>
      listReferralIntake(client, { ...data, limit: INTAKE_PAGE_SIZE }),
    ),
  );

export const pushReferralToIcms = createServerFn({ method: 'POST' })
  .validator(z.object({ referralId: id, idempotencyKey: id }))
  .handler(async ({ data }): Promise<PushResult> =>
    withViewerClient(reportingClient, (client) =>
      pushToIcms(client, data.referralId, data.idempotencyKey),
    ).then((result) =>
      'pushFailed' in result || result.ok ? result : { ...result, pushFailed: null },
    ),
  );

/**
 * A short-lived link to a referral's Confidential evidence package, handed out by the documents
 * service as the signed-in officer and audited there.
 */
export const getIntakePackageLink = createServerFn({ method: 'GET' })
  .validator(z.object({ packageDocumentId: id }))
  .handler(({ data }): Promise<ServiceResult<{ downloadUrl: string }>> =>
    withViewerClient(intakePackageDocumentsClient, (client) =>
      intakePackageLink(client, data.packageDocumentId),
    ),
  );
