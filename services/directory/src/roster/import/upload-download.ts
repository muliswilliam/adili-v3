import { z } from 'zod';

import type { components } from './documents-api.gen.js';

type UploadDownload = components['schemas']['UploadDownload'];

/**
 * The fields of documents' `UploadDownload` the directory reads, validated where the answer
 * enters the service (ADR-013 §2) rather than trusted as the generated client types it. Pinned to
 * the generated contract types below, so it cannot drift from them: it names only contract
 * fields, and accepts every value the contract types allow (the adapter's tests check the same
 * against the contract's JSON schema). `purpose` is widened: documents' purposes grow with later
 * slices.
 */
export const uploadDownloadSchema = z.object({
  id: z.uuid(),
  purpose: z.string(),
  downloadUrl: z.url(),
  size: z.int().nonnegative(),
  fileName: z.string().nullable(),
  detectedType: z.string(),
});

/**
 * Fails to compile when the schema drifts from the generated contract: a field the contract
 * lacks, or a type narrower than the contract's.
 */
export type UploadDownloadContractCheck = Assert<
  UploadDownload extends z.infer<typeof uploadDownloadSchema> ? true : false
>;
type Assert<T extends true> = T;
