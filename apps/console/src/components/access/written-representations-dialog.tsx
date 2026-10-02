import {
  AttachmentList,
  type AttachmentListItem,
  type AttachmentStatus,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldError,
  FormField,
  Icon,
  IconTile,
  RadioCard,
  RadioGroup,
  Spinner,
  Textarea,
  useToast,
  useIdempotencyKey,
} from '@adili/ui';
import { File01Icon } from '@hugeicons/core-free-icons';
import { useRouter } from '@tanstack/react-router';
import { useId, useRef, useState } from 'react';

import {
  completeRepresentationScan,
  createRepresentationScanUpload,
  enterWrittenRepresentations,
} from '../../server/access-requests';
import type { AccessResult } from '../../server/access-requests.server';
import type { OfficerRequestView, Representations } from '../../server/access/types';
import { putFile } from '../roster/upload';
import { goToSignIn } from '../sign-in-redirect';
import { messages as m } from './messages';
import { actionFailure } from './request-view';
import { Problem } from './resolve-dialogs';
import { messages as selfAccess } from './self-access/messages';
import {
  PROOF_ACCEPT,
  PROOF_MAX_BYTES,
  type ProofOutcome,
  uploadProof,
} from './self-access/proof-upload';

/** Most scans one entry carries (access.yaml `RepresentationsInput.attachments`). */
const MAX_SCANS = 10;
/** access.yaml `RepresentationsInput.text`. */
const MAX_TEXT = 8000;

type Stance = Representations['stance'];
const STANCES: Stance[] = ['object', 'consent', 'context'];

/** One scan as the form holds it: uploading, scanned clean, or failed (with the file to retry). */
interface Scan {
  key: string;
  name: string;
  status: Exclude<AttachmentStatus, 'linked'> | 'linked';
  progress?: number;
  uploadId?: string;
  size?: number;
  file?: File;
}

function statusOf(outcome: ProofOutcome): Scan['status'] {
  switch (outcome.kind) {
    case 'clean':
      return 'linked';
    case 'unauthenticated':
      return 'failed';
    default:
      return outcome.kind;
  }
}

/**
 * "Enter representations received in writing" (spec 10 decision 2): the declarant was served a
 * written notice and answered on paper; the access officer enters the stance, the text and scans
 * of the letter (uploaded as their own `access-representation` files, scanned by documents) on
 * the declarant's behalf. Opened with the representations shown now, which the entry replaces.
 */
export function WrittenRepresentationsDialog({
  view,
  open,
  onOpenChange,
}: {
  view: OfficerRequestView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const router = useRouter();
  const { toast } = useToast();
  const current = view.representations;
  const [stance, setStance] = useState<Stance | null>(current?.stance ?? null);
  const [text, setText] = useState(current?.text ?? '');
  const [scans, setScans] = useState<Scan[]>(
    (current?.attachments ?? []).map((file) => ({
      key: file.uploadId,
      name: file.fileName,
      status: 'linked',
      uploadId: file.uploadId,
    })),
  );
  const [errors, setErrors] = useState<{ stance?: string; text?: string; scans?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per entry sent: kept across retries of it, a new one once the entry changes (the
  // service keeps a refusal under its key, so a corrected entry needs its own).
  const idempotencyKey = useIdempotencyKey();
  const removed = useRef(new Set<string>());

  const update = (scanKey: string, patch: Partial<Scan>) => {
    if (removed.current.has(scanKey)) return;
    setScans((all) => all.map((scan) => (scan.key === scanKey ? { ...scan, ...patch } : scan)));
  };

  const upload = (scanKey: string, file: File) => {
    update(scanKey, { status: 'uploading', progress: 0, file });
    void uploadProof(
      file,
      {
        reserve: (input, idempotencyKey) =>
          createRepresentationScanUpload({ data: { ...input, idempotencyKey } }),
        putFile,
        complete: (uploadId, idempotencyKey) =>
          completeRepresentationScan({ data: { id: uploadId, idempotencyKey } }),
      },
      {
        onProgress: (progress) => {
          update(scanKey, { status: 'uploading', progress });
        },
        onScanning: () => {
          update(scanKey, { status: 'scanning' });
        },
      },
    ).then((outcome) => {
      if (outcome.kind === 'unauthenticated') {
        goToSignIn();
        return;
      }
      update(scanKey, {
        status: statusOf(outcome),
        ...(outcome.kind === 'clean' ? { uploadId: outcome.uploadId, size: outcome.size } : {}),
      });
    });
  };

  const textError = (value: string, chosen: Stance | null) => {
    const trimmed = value.trim();
    if (trimmed.length > MAX_TEXT) return m.writtenTextTooLong;
    if (!trimmed && chosen !== 'consent') return m.writtenTextRequired;
    return undefined;
  };

  const submit = async () => {
    const pending = scans.some((scan) => scan.status !== 'linked');
    const next = {
      stance: stance ? undefined : m.stanceRequired,
      text: stance ? textError(text, stance) : undefined,
      scans: pending ? m.scansPending : undefined,
    };
    setErrors(next);
    if (next.stance || next.text || next.scans || !stance) return;
    setBusy(true);
    setFailure(null);
    const input = {
      stance,
      text: text.trim(),
      attachments: scans.flatMap((scan) => (scan.uploadId ? [scan.uploadId] : [])),
    };
    const result = await enterWrittenRepresentations({
      data: { requestId: view.id, input, idempotencyKey: idempotencyKey.keyFor(input) },
    }).catch((): AccessResult<OfficerRequestView> => ({
      ok: false,
      error: { kind: 'unavailable', detail: null },
    }));
    setBusy(false);
    if (result.ok) {
      onOpenChange(false);
      toast({ title: m.writtenSaved });
      await router.invalidate();
      return;
    }
    const failed = actionFailure(result.error);
    if (failed.signIn) {
      goToSignIn();
      return;
    }
    if (failed.stale) {
      onOpenChange(false);
      toast({ title: failed.message, urgency: 'assertive' });
      await router.invalidate();
      return;
    }
    setFailure(failed.message);
  };

  const items: AttachmentListItem[] = scans.map((scan) => ({
    id: scan.key,
    name: scan.name,
    status: scan.status,
    ...(scan.size === undefined ? {} : { size: scan.size }),
    ...(scan.status === 'uploading' ? { progress: scan.progress ?? 0 } : {}),
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent busy={busy} className="sm:max-w-[560px]">
        <DialogHeader className="flex-row items-center gap-3 pr-12">
          <IconTile>
            <Icon icon={File01Icon} />
          </IconTile>
          <DialogTitle>{m.writtenTitle}</DialogTitle>
        </DialogHeader>
        <form
          noValidate
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogBody className="grid gap-4">
            <DialogDescription className="text-sm text-muted-foreground">
              {m.writtenIntro}
              {current ? ` ${m.writtenReplaces}` : ''}
            </DialogDescription>
            <RadioGroup legend={m.stanceLegend} error={errors.stance}>
              {STANCES.map((each) => (
                <RadioCard
                  key={each}
                  name={`${id}-stance`}
                  value={each}
                  label={m.stance[each]}
                  description={m.stanceHint[each]}
                  checked={stance === each}
                  disabled={busy}
                  onChange={() => {
                    setStance(each);
                    setErrors((all) => ({ ...all, stance: undefined, text: undefined }));
                  }}
                />
              ))}
            </RadioGroup>
            <FormField
              label={m.writtenText}
              hint={m.writtenTextHint}
              error={errors.text}
              controlId={`${id}-text`}
            >
              <Textarea
                rows={5}
                maxLength={MAX_TEXT}
                value={text}
                disabled={busy}
                onChange={(event) => {
                  setText(event.target.value);
                  if (errors.text) setErrors((all) => ({ ...all, text: undefined }));
                }}
              />
            </FormField>
            <div className="grid min-w-0 gap-1.5">
              <span className="text-sm leading-5 font-medium text-secondary-foreground">
                {m.writtenScans}
              </span>
              <AttachmentList
                label={m.writtenScans}
                attachments={items}
                accept={PROOF_ACCEPT}
                maxSize={PROOF_MAX_BYTES}
                addLabel={m.addScan}
                disabled={busy}
                messages={selfAccess.proofMessages}
                aria-describedby={errors.scans ? `${id}-scans-error` : undefined}
                onAdd={
                  scans.length < MAX_SCANS
                    ? (file, rejection) => {
                        const scanKey = crypto.randomUUID();
                        if (rejection) {
                          setScans((all) => [
                            ...all,
                            {
                              key: scanKey,
                              name: file.name,
                              status: rejection === 'size' ? 'rejected-size' : 'rejected-type',
                            },
                          ]);
                          return;
                        }
                        setScans((all) => [
                          ...all,
                          { key: scanKey, name: file.name, status: 'uploading', progress: 0, file },
                        ]);
                        upload(scanKey, file);
                      }
                    : undefined
                }
                onRemove={(item) => {
                  removed.current.add(item.id);
                  setScans((all) => all.filter((scan) => scan.key !== item.id));
                  if (errors.scans) setErrors((all) => ({ ...all, scans: undefined }));
                }}
                onDismiss={(item) => {
                  removed.current.add(item.id);
                  setScans((all) => all.filter((scan) => scan.key !== item.id));
                }}
                onRetry={(item) => {
                  const scan = scans.find((each) => each.key === item.id);
                  if (scan?.file) upload(scan.key, scan.file);
                }}
              />
              {errors.scans ? (
                <FieldError id={`${id}-scans-error`}>{errors.scans}</FieldError>
              ) : null}
            </div>
            <Problem error={failure} />
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                onOpenChange(false);
              }}
            >
              {m.cancel}
            </Button>
            <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
              {busy ? <Spinner className="size-4" /> : null}
              {m.saveWritten}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
