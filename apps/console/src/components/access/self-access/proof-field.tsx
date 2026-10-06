import {
  AttachmentList,
  type AttachmentListItem,
  type AttachmentStatus,
  FieldError,
  putFile,
} from '@adili/ui';
import { useId, useRef } from 'react';

import { completeProof, createProofUpload } from '../../../server/self-access';
import { goToSignIn } from '../../sign-in-redirect';
import { messages as m } from './messages';
import { PROOF_ACCEPT, PROOF_MAX_BYTES, type ProofOutcome, uploadProof } from './proof-upload';

/** One proof's upload, as the form holds it. */
export type ProofSlot =
  | { status: 'empty' }
  | {
      status: Exclude<AttachmentStatus, 'linked'>;
      name: string;
      progress?: number;
      /** For Try again. */
      file?: File;
    }
  | { status: 'linked'; name: string; uploadId: string; size: number };

export const EMPTY_PROOF: ProofSlot = { status: 'empty' };

function slotOf(outcome: ProofOutcome, file: File): ProofSlot {
  switch (outcome.kind) {
    case 'clean':
      return { status: 'linked', name: file.name, uploadId: outcome.uploadId, size: outcome.size };
    case 'unauthenticated':
    case 'failed':
      return { status: 'failed', name: file.name, file };
    default:
      return { status: outcome.kind, name: file.name, file };
  }
}

/**
 * A representative's written authority or ID: one file, uploaded as the officer's
 * `access-representation` upload (scanned by documents) and shown in every upload state.
 */
export function ProofField({
  label,
  addLabel,
  value,
  error,
  disabled,
  onChange,
}: {
  label: string;
  addLabel: string;
  value: ProofSlot;
  error?: string;
  disabled?: boolean;
  onChange: (slot: ProofSlot) => void;
}) {
  const id = useId();
  // Only the latest upload's outcome lands; a removed or replaced file is ignored.
  const attempt = useRef(0);

  const upload = (file: File) => {
    const ticket = ++attempt.current;
    const update = (slot: ProofSlot) => {
      if (ticket === attempt.current) onChange(slot);
    };
    update({ status: 'uploading', name: file.name, progress: 0, file });
    void uploadProof(
      file,
      {
        reserve: (input, idempotencyKey) =>
          createProofUpload({ data: { ...input, idempotencyKey } }),
        putFile,
        complete: (uploadId, idempotencyKey) =>
          completeProof({ data: { id: uploadId, idempotencyKey } }),
      },
      {
        onProgress: (progress) => {
          update({ status: 'uploading', name: file.name, progress, file });
        },
        onScanning: () => {
          update({ status: 'scanning', name: file.name, file });
        },
      },
    ).then((outcome) => {
      if (outcome.kind === 'unauthenticated') {
        goToSignIn();
        return;
      }
      update(slotOf(outcome, file));
    });
  };

  const items: AttachmentListItem[] =
    value.status === 'empty'
      ? []
      : [
          {
            id: `${id}-file`,
            name: value.name,
            status: value.status,
            ...(value.status === 'linked' ? { size: value.size } : {}),
            ...(value.status === 'uploading' ? { progress: value.progress ?? 0 } : {}),
          },
        ];

  return (
    <div className="grid min-w-0 content-start gap-1.5">
      <span id={`${id}-label`} className="text-sm leading-5 font-medium text-secondary-foreground">
        {label}
      </span>
      <AttachmentList
        label={label}
        attachments={items}
        accept={PROOF_ACCEPT}
        maxSize={PROOF_MAX_BYTES}
        addLabel={addLabel}
        disabled={disabled}
        messages={m.proofMessages}
        aria-describedby={error ? `${id}-error` : undefined}
        onAdd={
          value.status === 'empty'
            ? (file, rejection) => {
                if (rejection) {
                  attempt.current += 1;
                  onChange({
                    status: rejection === 'size' ? 'rejected-size' : 'rejected-type',
                    name: file.name,
                  });
                  return;
                }
                upload(file);
              }
            : undefined
        }
        onRemove={() => {
          attempt.current += 1;
          onChange(EMPTY_PROOF);
        }}
        onDismiss={() => {
          attempt.current += 1;
          onChange(EMPTY_PROOF);
        }}
        onRetry={
          value.status === 'failed' && value.file
            ? () => {
                if (value.file) upload(value.file);
              }
            : undefined
        }
      />
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </div>
  );
}
