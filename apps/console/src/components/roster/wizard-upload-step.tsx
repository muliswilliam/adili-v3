import { Badge, Button, FileDropZone, Icon, ProgressBar, Spinner } from '@adili/ui';
import {
  ArrowLeft01Icon,
  RefreshIcon,
  Shield01Icon,
  Upload04Icon,
} from '@hugeicons/core-free-icons';
import { type ReactNode, useEffect, useRef } from 'react';

import { formatFileSize } from '../format';
import { FileBox } from './file-box';
import type { UploadState } from './import-wizard';
import { messages as m } from './messages';
import { ProblemAlert } from './problem-alert';
import { ROSTER_FILE_ACCEPT, ROSTER_FILE_MAX_BYTES } from './roster-file';
import type { UploadRejectionReason } from './upload';
import { WizardCard, WizardFoot, WizardSection, WizardTitle } from './wizard-card';

const REJECTED_TITLE: Record<UploadRejectionReason, string> = {
  type: m.rejectedType,
  encoding: m.rejectedEncoding,
  size: m.rejectedSize,
};

export interface WizardUploadStepProps {
  upload: UploadState;
  /** A file that passed the type and size checks in the browser. */
  onFile: (file: File) => void;
  /** Stops the upload in flight. */
  onCancel: () => void;
  /** Uploads the same file again after an upload that did not complete. */
  onRetry: () => void;
  /** Back to the drop zone. */
  onChooseAnother: () => void;
  onBack: () => void;
}

const dropMessages = {
  type: () => m.wrongType,
  size: (file: File) => m.tooLarge(formatFileSize(file.size)),
};

/** Step 2: pick a file, upload it with progress, then the scan and its outcome. */
export function WizardUploadStep({
  upload,
  onFile,
  onCancel,
  onRetry,
  onChooseAnother,
  onBack,
}: WizardUploadStepProps) {
  // After "Choose another file" the drop zone replaces the button that had focus; keep focus
  // there instead of letting it fall back to the page.
  const dropZone = useRef<HTMLButtonElement>(null);
  const focusDropZone = useRef(false);
  useEffect(() => {
    if (upload.phase === 'idle' && focusDropZone.current) {
      focusDropZone.current = false;
      dropZone.current?.focus();
    }
  }, [upload.phase]);
  const chooseAnother = () => {
    focusDropZone.current = true;
    onChooseAnother();
  };

  return (
    <WizardCard>
      <WizardSection>
        <WizardTitle className="mb-4">{m.uploadTitle}</WizardTitle>
        {upload.phase === 'idle' ? (
          <FileDropZone
            ref={dropZone}
            label={
              <>
                {m.dropLabelBefore}{' '}
                <span className="underline decoration-input underline-offset-3">
                  {m.dropLabelBrowse}
                </span>
                .
              </>
            }
            hint={m.dropHint}
            accept={ROSTER_FILE_ACCEPT}
            maxSize={ROSTER_FILE_MAX_BYTES}
            messages={dropMessages}
            onFileAccepted={onFile}
            className="[&>button]:py-10"
          />
        ) : (
          <UploadProgress
            upload={upload}
            onCancel={onCancel}
            onRetry={onRetry}
            onChooseAnother={chooseAnother}
          />
        )}
      </WizardSection>
      <WizardFoot>
        <Button variant="secondary" onClick={onBack}>
          <Icon icon={ArrowLeft01Icon} />
          {m.back}
        </Button>
      </WizardFoot>
    </WizardCard>
  );
}

function UploadProgress({
  upload,
  onCancel,
  onRetry,
  onChooseAnother,
}: {
  upload: Exclude<UploadState, { phase: 'idle' }>;
  onCancel: () => void;
  onRetry: () => void;
  onChooseAnother: () => void;
}) {
  const { file } = upload;
  const box = (status: ReactNode) => (
    <FileBox name={file.name} size={file.size}>
      {status}
    </FileBox>
  );
  const chooseAnother = (
    <Button variant="secondary" size="sm" onClick={onChooseAnother}>
      <Icon icon={Upload04Icon} />
      {m.chooseAnother}
    </Button>
  );

  switch (upload.phase) {
    case 'requesting':
      return box(<Busy>{m.preparing}</Busy>);
    case 'uploading':
      return (
        <div className="grid gap-3.5">
          {box(
            <Button
              variant="ghost"
              size="sm"
              aria-label={m.cancelUploadLabel(file.name)}
              onClick={onCancel}
            >
              {m.cancelUpload}
            </Button>,
          )}
          <ProgressBar label={m.uploadProgress} value={upload.percent} status={m.uploading} />
        </div>
      );
    case 'scanning':
      return box(<Busy strong>{m.scanning}</Busy>);
    case 'clean':
      return box(<PassedScan />);
    case 'infected':
      return (
        <div className="grid gap-3.5">
          {box(
            <Badge variant="destructive">
              <Icon icon={Shield01Icon} />
              {m.failedScan}
            </Badge>,
          )}
          <ProblemAlert title={m.infectedTitle} text={m.infectedText}>
            {chooseAnother}
          </ProblemAlert>
        </div>
      );
    case 'rejected':
    case 'failed':
      return (
        <div className="grid gap-3.5">
          {box(<Badge variant="destructive">{m.notUploaded}</Badge>)}
          <ProblemAlert
            title={upload.phase === 'failed' ? m.uploadFailed : REJECTED_TITLE[upload.reason]}
            text={
              upload.phase === 'rejected' && upload.reason === 'encoding'
                ? m.rejectedEncodingText
                : undefined
            }
          >
            {upload.phase === 'failed' ? (
              <Button size="sm" onClick={onRetry}>
                <Icon icon={RefreshIcon} />
                {m.retryUpload}
              </Button>
            ) : null}
            {chooseAnother}
          </ProblemAlert>
        </div>
      );
  }
}

/** A spinner line for work in progress, announced once as it starts. */
export function Busy({ strong = false, children }: { strong?: boolean; children: ReactNode }) {
  return (
    <span
      role="status"
      className={
        strong
          ? 'flex items-center gap-2 text-[13.5px] font-medium'
          : 'flex items-center gap-2 text-[13.5px] text-muted-foreground'
      }
    >
      <Spinner className="size-4" />
      {children}
    </span>
  );
}

export function PassedScan() {
  return (
    <Badge variant="success">
      <Icon icon={Shield01Icon} />
      {m.passedScan}
    </Badge>
  );
}
