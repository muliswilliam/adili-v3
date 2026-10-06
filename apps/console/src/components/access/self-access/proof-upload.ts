import { type putFile, wholePercents } from '@adili/ui';

import type { Upload, UploadReservation } from '../../../server/documents/client';
import type { SelfAccessResult } from '../../../server/self-access.server';

/** The file types a representative's proof may be (documents' `access-representation`). */
export const PROOF_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export type ProofContentType = (typeof PROOF_CONTENT_TYPES)[number];
/** The largest proof documents accepts. */
export const PROOF_MAX_BYTES = 20 * 1024 * 1024;

export interface ProofUploadInput {
  contentType: ProofContentType;
  declaredSize: number;
  fileName: string;
}

/** What the file picker offers: the types documents accepts for `access-representation`. */
export const PROOF_ACCEPT = ['.pdf', '.jpg', '.jpeg', '.png', ...PROOF_CONTENT_TYPES];

/** The content type a proof is sent as, from the browser's type or else its extension. */
export function proofContentType(file: Pick<File, 'name' | 'type'>): ProofContentType | null {
  if ((PROOF_CONTENT_TYPES as readonly string[]).includes(file.type)) {
    return file.type as ProofContentType;
  }
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  return null;
}

/** How uploading one proof ended. */
export type ProofOutcome =
  | { kind: 'clean'; uploadId: string; size: number }
  | { kind: 'infected' }
  | { kind: 'rejected-type' }
  | { kind: 'rejected-size' }
  /** Expired, interrupted or refused: worth trying again. */
  | { kind: 'failed' }
  | { kind: 'unauthenticated' };

export interface ProofUploadDeps {
  reserve: (
    input: ProofUploadInput,
    idempotencyKey: string,
  ) => Promise<SelfAccessResult<UploadReservation>>;
  putFile: typeof putFile;
  complete: (id: string, idempotencyKey: string) => Promise<SelfAccessResult<Upload>>;
  newKey?: () => string;
}

export interface ProofUploadEvents {
  onProgress?: (percent: number) => void;
  /** Every byte is up; documents is scanning the file. */
  onScanning?: () => void;
}

/**
 * Uploads a representative's written authority or ID end to end: reserve an
 * `access-representation` upload as the officer, PUT the bytes straight to storage with
 * progress, then complete it, which scans the file. Resolves to the outcome; never rejects.
 */
export async function uploadProof(
  file: File,
  deps: ProofUploadDeps,
  events: ProofUploadEvents = {},
): Promise<ProofOutcome> {
  const contentType = proofContentType(file);
  if (!contentType) return { kind: 'rejected-type' };
  if (file.size > PROOF_MAX_BYTES) return { kind: 'rejected-size' };
  if (file.size === 0) return { kind: 'failed' };
  const newKey = deps.newKey ?? (() => crypto.randomUUID());
  const refused = (result: SelfAccessResult<unknown>): ProofOutcome => {
    if (!result.ok && result.error.kind === 'unauthenticated') return { kind: 'unauthenticated' };
    if (!result.ok && result.error.kind === 'problem' && result.error.problem.status === 400) {
      return { kind: 'rejected-type' };
    }
    return { kind: 'failed' };
  };

  const reserved = await deps
    .reserve({ contentType, declaredSize: file.size, fileName: file.name.slice(0, 255) }, newKey())
    .catch((): SelfAccessResult<UploadReservation> => ({
      ok: false,
      error: { kind: 'unavailable', detail: null },
    }));
  if (!reserved.ok) return refused(reserved);

  const put = await deps.putFile(reserved.data.uploadUrl, file, contentType, {
    onProgress: wholePercents((percent) => events.onProgress?.(percent)),
  });
  if (put !== 'ok') return { kind: 'failed' };

  events.onScanning?.();
  const completed = await deps
    .complete(reserved.data.id, newKey())
    .catch((): SelfAccessResult<Upload> => ({
      ok: false,
      error: { kind: 'unavailable', detail: null },
    }));
  if (!completed.ok) return refused(completed);
  const upload = completed.data;
  switch (upload.state) {
    case 'clean':
      return { kind: 'clean', uploadId: upload.id, size: upload.size ?? file.size };
    case 'infected':
      return { kind: 'infected' };
    case 'rejected':
      return upload.rejection === 'size' ? { kind: 'rejected-size' } : { kind: 'rejected-type' };
    default:
      return { kind: 'failed' };
  }
}
