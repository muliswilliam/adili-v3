import {
  Alert02Icon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  File01Icon,
  SquareLock02Icon,
  RefreshIcon,
} from '@hugeicons/core-free-icons';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

import { cn } from '../lib/cn';
import {
  formatDigest,
  looksLikePdf,
  sameDigest,
  sha256Hex,
  Sha256UnavailableError,
} from '../lib/sha256';
import { Alert, AlertDescription, AlertTitle } from './alert';
import { formatFileSize } from './attachment-list';
import { Button } from './button';
import { FileDropZone } from './file-drop-zone';
import { Icon } from './icon';
import { Spinner } from './spinner';

/**
 * How a checked file compares with the issued document: `identical`, `mismatch`, `unreadable`
 * (not a PDF, or the browser could not read it) or `unavailable` (the browser has no Web
 * Crypto here, e.g. the page is served over plain http).
 */
export type HashCheckStatus = 'identical' | 'mismatch' | 'unreadable' | 'unavailable';

export interface HashCheckResult {
  status: HashCheckStatus;
  file: File;
  /** The file's SHA-256 in lower-case hex, when it could be computed. */
  sha256?: string;
}

export interface HashDropZoneMessages {
  label: ReactNode;
  hint: ReactNode;
  neverUploaded: ReactNode;
  checking: string;
  identical: string;
  identicalDetail: string;
  mismatch: string;
  mismatchDetail: string;
  unreadable: string;
  unreadableDetail: string;
  unavailable: string;
  unavailableDetail: string;
  showDetails: string;
  hideDetails: string;
  fileDigest: ReactNode;
  issuedDigest: ReactNode;
  computedHere: ReactNode;
  checkAnother: string;
}

export const HASH_DROP_ZONE_MESSAGES: HashDropZoneMessages = {
  label: 'Drop the PDF you were given',
  hint: 'or choose a file from your device',
  neverUploaded: 'The file is checked on your device and never uploaded.',
  checking: 'Checking the file on your device',
  identical: 'Identical to the issued document',
  identicalDetail: 'Not a single byte has changed.',
  mismatch: 'Does not match the issued document',
  mismatchDetail:
    'It may have been edited, or be another version. Rely on the details shown here, not this copy.',
  unreadable: 'Could not read this file',
  unreadableDetail: 'Choose a PDF. It may be damaged or still downloading.',
  unavailable: 'This browser cannot check files on this page',
  unavailableDetail: 'Open the page over a secure (https) connection and try again.',
  showDetails: 'Show technical details',
  hideDetails: 'Hide technical details',
  fileDigest: 'Your file (SHA-256)',
  issuedDigest: 'Issued document (SHA-256)',
  computedHere: 'Calculated in this browser. Nothing was sent.',
  checkAnother: 'Check another file',
};

const RESULT = {
  identical: { variant: 'success', icon: CheckmarkCircle02Icon },
  mismatch: { variant: 'destructive', icon: CancelCircleIcon },
  unreadable: { variant: 'warning', icon: Alert02Icon },
  unavailable: { variant: 'warning', icon: Alert02Icon },
} as const;

export interface HashDropZoneProps {
  /** SHA-256 of the issued document, hex (as the verification API returns it). */
  expectedSha256: string;
  /** Called once per checked file with the outcome. */
  onChecked?: (result: HashCheckResult) => void;
  messages?: Partial<HashDropZoneMessages>;
  className?: string;
}

type Check = { status: 'idle' } | { status: 'checking'; file: File } | HashCheckResult;

async function checkFile(file: File, expectedSha256: string): Promise<HashCheckResult> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { status: 'unreadable', file };
  }
  if (!looksLikePdf(bytes)) return { status: 'unreadable', file };
  try {
    const sha256 = await sha256Hex(bytes);
    return { status: sameDigest(sha256, expectedSha256) ? 'identical' : 'mismatch', file, sha256 };
  } catch (error) {
    return { status: error instanceof Sha256UnavailableError ? 'unavailable' : 'unreadable', file };
  }
}

/**
 * Checks a PDF someone was given against the issued document: it reads the file on the device,
 * computes its SHA-256 with Web Crypto and compares it with `expectedSha256`. The file is
 * never uploaded; nothing here makes a network request. Keyboard users pick the file with the
 * zone's button; the outcome is announced politely and focus moves to it, then to the zone
 * again after "Check another file".
 */
export function HashDropZone({
  expectedSha256,
  onChecked,
  messages,
  className,
}: HashDropZoneProps) {
  const copy = { ...HASH_DROP_ZONE_MESSAGES, ...messages };
  const noteId = useId();
  const detailsId = useId();
  const [check, setCheck] = useState<Check>({ status: 'idle' });
  const [showDetails, setShowDetails] = useState(false);
  // Only the latest file's outcome counts, and none after unmounting.
  const run = useRef(0);
  const zoneRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Where focus goes on the next render: the panel once a file is taken, the zone after reset.
  const focusNext = useRef<'panel' | 'zone' | null>(null);

  useEffect(
    () => () => {
      run.current += 1;
    },
    [],
  );

  useEffect(() => {
    const target = focusNext.current === 'panel' ? panelRef.current : zoneRef.current;
    if (focusNext.current && target) {
      focusNext.current = null;
      target.focus();
    }
  }, [check.status]);

  async function take(file: File) {
    const id = (run.current += 1);
    focusNext.current = 'panel';
    setShowDetails(false);
    setCheck({ status: 'checking', file });
    const result = await checkFile(file, expectedSha256);
    if (id !== run.current) return;
    setCheck(result);
    onChecked?.(result);
  }

  function reset() {
    run.current += 1;
    focusNext.current = 'zone';
    setCheck({ status: 'idle' });
  }

  const done = check.status !== 'idle' && check.status !== 'checking';
  const announcement = done ? `${copy[check.status]}. ${copy[`${check.status}Detail`]}` : '';

  return (
    <div className={cn('grid gap-3', className)}>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {check.status === 'idle' ? (
        <FileDropZone
          ref={zoneRef}
          icon={File01Icon}
          label={copy.label}
          hint={copy.hint}
          aria-describedby={noteId}
          accept={['.pdf', 'application/pdf']}
          // A file of another type gets the same answer as one that is not really a PDF.
          messages={{ type: () => null, size: () => null }}
          onFileAccepted={(file) => void take(file)}
          onFileRejected={(file) => {
            const result: HashCheckResult = { status: 'unreadable', file };
            focusNext.current = 'panel';
            setCheck(result);
            onChecked?.(result);
          }}
        />
      ) : (
        <div ref={panelRef} tabIndex={-1} className="grid gap-3 outline-none">
          <div className="flex min-w-0 items-center gap-2.5 rounded-lg bg-muted px-3 py-2.5 text-sm">
            <Icon icon={File01Icon} className="text-secondary-foreground" />
            <span className="min-w-0 flex-1 truncate font-medium">{check.file.name}</span>
            <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">
              {formatFileSize(check.file.size)}
            </span>
          </div>
          {check.status === 'checking' ? (
            <div className="flex items-center gap-2.5 px-0.5 py-1.5 text-sm">
              <Spinner />
              {copy.checking}
            </div>
          ) : (
            <Alert role={undefined} variant={RESULT[check.status].variant}>
              <Icon icon={RESULT[check.status].icon} />
              <AlertTitle>{copy[check.status]}</AlertTitle>
              <AlertDescription>{copy[`${check.status}Detail`]}</AlertDescription>
              {check.sha256 ? (
                <div className="mt-2 grid gap-2">
                  <Button
                    type="button"
                    variant="link"
                    // The padding gives the focus ring room around the text; the margin keeps
                    // the text in line with the alert's.
                    className="-mx-1 w-fit px-1 text-[13px] text-current"
                    aria-expanded={showDetails}
                    aria-controls={detailsId}
                    onClick={() => {
                      setShowDetails((shown) => !shown);
                    }}
                  >
                    {showDetails ? copy.hideDetails : copy.showDetails}
                  </Button>
                  <div id={detailsId} hidden={!showDetails} className="grid gap-2">
                    <dl className="grid gap-2 font-mono text-[12.5px] text-foreground">
                      <div>
                        <dt className="font-sans font-semibold">{copy.fileDigest}</dt>
                        <dd>{formatDigest(check.sha256)}</dd>
                      </div>
                      <div>
                        <dt className="font-sans font-semibold">{copy.issuedDigest}</dt>
                        <dd>{formatDigest(expectedSha256.toLowerCase())}</dd>
                      </div>
                    </dl>
                    <p className="text-[12.5px] text-muted-foreground">{copy.computedHere}</p>
                  </div>
                </div>
              ) : null}
            </Alert>
          )}
          {done ? (
            <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={reset}>
              <Icon icon={RefreshIcon} />
              {copy.checkAnother}
            </Button>
          ) : null}
        </div>
      )}
      <p id={noteId} className="flex items-center gap-1.5 text-[13px] font-medium text-success">
        <Icon icon={SquareLock02Icon} className="size-3.5" />
        {copy.neverUploaded}
      </p>
    </div>
  );
}
