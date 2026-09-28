import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  CheckboxItem,
  ConfidenceChip,
  CountySelect,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldHint,
  FormField,
  Icon,
  Input,
  RadioCard,
  RadioGroup,
  Spinner,
} from '@adili/ui';
import {
  Alert02Icon,
  AlertCircleIcon,
  InformationCircleIcon,
  SparklesIcon,
} from '@hugeicons/core-free-icons';
import { useEffect, useId, useRef, useState } from 'react';

import {
  extractDeclarationAttachment,
  listDeclarationSuggestions,
} from '../../server/declarations';
import type { DocumentKind, JsonObject, LoadedSuggestion } from '../../server/declarations.server';
import { markExtractionOff } from './extraction-availability';
import {
  acceptedFields,
  clashes,
  defaultKind,
  DOCUMENT_KIND_LABELS,
  DOCUMENT_KINDS,
  EXTRACTION_COPY as COPY,
  FAILURE_REASONS,
  levelOf,
  readingState,
  readSuggestion,
} from './extraction';
import { useAcceptSuggestion } from './suggestion-accept';
import { useWorkspace } from './workspace';

/**
 * "Read into the form" for one attached document (spec 05b S6, #316): the declarant says what
 * the document is, the service reads it ("Reading…", polled through the suggestions list, as the
 * contract has no per-set read), and the review sheet shows each field it read with its
 * confidence and page, editable. Low fields need a tick. The fields are applied to the item the
 * document is on, or added as a new item, through the accept endpoint, so the item's source is
 * the document.
 */

export const EXTRACTION_POLL_MS = 1_500;
/** About a minute of polling, as the reading copy promises, then it is given up. */
export const EXTRACTION_POLL_LIMIT = 40;

export interface ReadTarget {
  attachmentId: string;
  fileName: string;
}

export type AppliedMode = 'new' | 'apply';

export interface ReadIntoFormProps {
  target: ReadTarget | null;
  sectionKey: string;
  /** The item the document is on. */
  itemId: string;
  itemType: string | undefined;
  /** The item as on screen, to show what applying would meet. */
  item: unknown;
  onClose: () => void;
  /** The accept went through; `contents` is the section as read back, if that read worked. */
  onApplied: (result: { itemId: string; contents: JsonObject | null; mode: AppliedMode }) => void;
  pollMs?: number;
  pollLimit?: number;
}

type Step =
  | { name: 'kind' }
  | { name: 'reading'; setId: string | null }
  | { name: 'review'; suggestion: LoadedSuggestion }
  | { name: 'failed'; reason: string }
  | { name: 'not-enabled' };

export function ReadIntoForm({
  target,
  sectionKey,
  itemId,
  itemType,
  item,
  onClose,
  onApplied,
  pollMs = EXTRACTION_POLL_MS,
  pollLimit = EXTRACTION_POLL_LIMIT,
}: ReadIntoFormProps) {
  const { declaration } = useWorkspace();
  const declarationId = declaration.id;
  const personKey = sectionKey.slice('statement:'.length);
  const [step, setStep] = useState<Step>({ name: 'kind' });
  const [kind, setKind] = useState<DocumentKind>(() => defaultKind(itemType));
  const [seen, setSeen] = useState<ReadTarget | null>(target);
  // Every request belongs to one opening of the sheet; a late answer to an earlier one is dropped.
  const run = useRef(0);

  if (seen !== target) {
    setSeen(target);
    setStep({ name: 'kind' });
    setKind(defaultKind(itemType));
  }

  function close() {
    run.current += 1;
    onClose();
  }

  async function start() {
    if (!target) return;
    const mine = ++run.current;
    setStep({ name: 'reading', setId: null });
    const result = await extractDeclarationAttachment({
      data: {
        declarationId,
        attachmentId: target.attachmentId,
        documentKindHint: kind,
        targetItemType: itemType ?? 'other',
        idempotencyKey: crypto.randomUUID(),
      },
    }).catch(() => ({ status: 'unavailable' as const }));
    if (mine !== run.current) return;
    if (result.status === 'started') {
      const state = readingState(result.set);
      if (state.status === 'reading') setStep({ name: 'reading', setId: result.set.id });
      else settle(state);
    } else if (result.status === 'not-enabled') {
      settle({ status: 'not-enabled' });
    } else {
      const reason =
        result.status === 'refused'
          ? FAILURE_REASONS.refused
          : result.status === 'not-found'
            ? FAILURE_REASONS.missing
            : FAILURE_REASONS.unavailable;
      setStep({ name: 'failed', reason });
    }
  }

  function settle(state: ReturnType<typeof readingState>) {
    if (state.status === 'ready') setStep({ name: 'review', suggestion: state.suggestion });
    else if (state.status === 'failed') setStep({ name: 'failed', reason: state.reason });
    else if (state.status === 'not-enabled') {
      markExtractionOff(declarationId);
      setStep({ name: 'not-enabled' });
    }
  }

  const setId = step.name === 'reading' ? step.setId : null;
  const polls = useRef(0);
  useEffect(() => {
    if (!setId) return;
    polls.current = 0;
    const mine = run.current;
    let timer: ReturnType<typeof setTimeout>;
    const poll = () => {
      timer = setTimeout(() => {
        void (async () => {
          polls.current += 1;
          const listed = await listDeclarationSuggestions({
            data: { declarationId, personKey, sectionKey },
          }).catch(() => null);
          if (mine !== run.current) return;
          const set =
            listed?.status === 'ok' ? listed.sets.find((each) => each.id === setId) : null;
          const state = set ? readingState(set) : null;
          if (state && state.status !== 'reading') {
            settle(state);
          } else if (polls.current >= pollLimit) {
            setStep({ name: 'failed', reason: FAILURE_REASONS.timeout });
          } else {
            poll();
          }
        })();
      }, pollMs);
    };
    poll();
    return () => {
      clearTimeout(timer);
    };
    // settle only reads the draft id, which is stable for the sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setId, declarationId, personKey, sectionKey, pollMs, pollLimit]);

  const reviewing = step.name === 'review' ? step.suggestion : null;
  const [busy, setBusy] = useState(false);

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent busy={busy} aria-describedby={undefined}>
        {step.name === 'review' && reviewing && target ? (
          <Review
            key={reviewing.id}
            suggestion={reviewing}
            fileName={target.fileName}
            kind={kind}
            itemId={itemId}
            item={item}
            onBusy={setBusy}
            onClose={close}
            onApplied={onApplied}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                <span className="inline-flex items-center gap-2">
                  <Icon icon={SparklesIcon} className="text-ai" />
                  {COPY.title}
                </span>
              </DialogTitle>
              <DialogDescription>{target?.fileName ?? ''}</DialogDescription>
            </DialogHeader>
            {step.name === 'kind' ? (
              <KindStep
                kind={kind}
                onKind={setKind}
                onCancel={close}
                onRead={() => {
                  void start();
                }}
              />
            ) : step.name === 'reading' ? (
              <>
                <DialogBody>
                  <div role="status" className="grid justify-items-center gap-2 py-8 text-center">
                    <Spinner className="size-6 text-ai" />
                    <p className="text-base font-semibold">{COPY.reading}</p>
                    <p className="text-sm text-muted-foreground">{COPY.readingHint}</p>
                  </div>
                </DialogBody>
                <DialogFooter>
                  <Button type="button" variant="secondary" onClick={close}>
                    {COPY.cancel}
                  </Button>
                </DialogFooter>
              </>
            ) : step.name === 'failed' ? (
              <>
                <DialogBody>
                  <Alert variant="destructive">
                    <Icon icon={AlertCircleIcon} />
                    <AlertDescription>{COPY.failed(step.reason)}</AlertDescription>
                  </Alert>
                </DialogBody>
                <DialogFooter>
                  <Button type="button" variant="secondary" onClick={close}>
                    {COPY.close}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      setStep({ name: 'kind' });
                    }}
                  >
                    {COPY.tryAgain}
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <DialogBody>
                  <Alert variant="neutral">
                    <Icon icon={InformationCircleIcon} />
                    <AlertDescription>{COPY.notEnabledBody}</AlertDescription>
                  </Alert>
                </DialogBody>
                <DialogFooter>
                  <Button type="button" onClick={close}>
                    {COPY.close}
                  </Button>
                </DialogFooter>
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function KindStep({
  kind,
  onKind,
  onCancel,
  onRead,
}: {
  kind: DocumentKind;
  onKind: (kind: DocumentKind) => void;
  onCancel: () => void;
  onRead: () => void;
}) {
  const name = useId();
  return (
    <>
      <DialogBody className="grid gap-4">
        <RadioGroup legend={COPY.kindLegend} className="sm:[&>div]:grid-cols-2">
          {DOCUMENT_KINDS.map((each) => (
            <RadioCard
              key={each}
              name={name}
              value={each}
              label={DOCUMENT_KIND_LABELS[each]}
              checked={kind === each}
              onChange={() => {
                onKind(each);
              }}
            />
          ))}
        </RadioGroup>
        <Alert variant="ai">
          <Icon icon={SparklesIcon} />
          <AlertDescription>
            <span className="font-medium">{COPY.aiLabel}</span> · {COPY.aiNote}
          </AlertDescription>
        </Alert>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {COPY.cancel}
        </Button>
        <Button type="button" onClick={onRead}>
          {COPY.read}
        </Button>
      </DialogFooter>
    </>
  );
}

function Review({
  suggestion,
  fileName,
  kind,
  itemId,
  item,
  onBusy,
  onClose,
  onApplied,
}: {
  suggestion: LoadedSuggestion;
  fileName: string;
  kind: DocumentKind;
  itemId: string;
  item: unknown;
  onBusy: (busy: boolean) => void;
  onClose: () => void;
  onApplied: ReadIntoFormProps['onApplied'];
}) {
  const accept = useAcceptSuggestion();
  const reading = readSuggestion(suggestion);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(reading.fields.map((field) => [field.key, field.value])),
  );
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [overwrite, setOverwrite] = useState(false);
  const [working, setWorking] = useState<'idle' | 'busy' | 'refreshing'>('idle');
  const [failed, setFailed] = useState(false);

  const low = reading.fields.filter((field) => levelOf(field) === 'low');
  const unticked = low.filter((field) => !ticked.has(field.key)).length;
  const fields = acceptedFields(suggestion, values);
  const met = clashes(item, fields, suggestion.itemType);
  const documentKind = DOCUMENT_KIND_LABELS[reading.documentKind ?? kind];
  const empty = reading.fields.length === 0;

  async function apply(mode: AppliedMode) {
    setWorking('busy');
    setFailed(false);
    onBusy(true);
    const result = await accept(
      suggestion,
      {
        fields,
        applyToItemId: mode === 'apply' ? itemId : null,
        ...(mode === 'apply' ? { overwrite } : {}),
      },
      () => {
        setWorking('refreshing');
      },
    );
    onBusy(false);
    setWorking('idle');
    if (result.status === 'accepted') {
      onApplied({ itemId: result.itemId, contents: result.section?.contents ?? null, mode });
      onClose();
    } else {
      setFailed(true);
    }
  }

  const disabled = working !== 'idle';

  return (
    <>
      <DialogHeader>
        <DialogTitle>{COPY.reviewTitle}</DialogTitle>
        <DialogDescription>
          {fileName} · {documentKind}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="grid gap-4">
        {empty ? (
          <Alert variant="neutral">
            <Icon icon={InformationCircleIcon} />
            <AlertDescription>{COPY.nothingRead}</AlertDescription>
          </Alert>
        ) : (
          <p className="text-sm text-muted-foreground">{COPY.reviewHint}</p>
        )}
        {reading.warnings.map((warning) => (
          <Alert key={warning} variant="warning">
            <Icon icon={Alert02Icon} />
            <AlertDescription>{warning}</AlertDescription>
          </Alert>
        ))}
        {reading.fields.map((field) => {
          const level = levelOf(field);
          return (
            <div key={field.key} className="grid gap-2" data-field={field.key}>
              <FormField
                label={field.label}
                hint={
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {level ? <ConfidenceChip confidence={level} /> : null}
                    {field.page === null ? null : <Badge>{COPY.page(field.page)}</Badge>}
                  </span>
                }
              >
                {field.key === 'county' ? (
                  <CountySelect
                    value={values[field.key] === '' ? null : (values[field.key] ?? null)}
                    disabled={disabled}
                    onValueChange={(code) => {
                      setValues((current) => ({ ...current, [field.key]: code ?? '' }));
                    }}
                  />
                ) : (
                  <Input
                    maxLength={200}
                    value={values[field.key] ?? ''}
                    disabled={disabled}
                    onChange={(event) => {
                      const value = event.target.value;
                      setValues((current) => ({ ...current, [field.key]: value }));
                    }}
                  />
                )}
              </FormField>
              {level === 'low' ? (
                <CheckboxItem
                  label={COPY.checked}
                  aria-label={`${COPY.checked}: ${field.label}`}
                  checked={ticked.has(field.key)}
                  disabled={disabled}
                  onChange={(event) => {
                    const on = event.target.checked;
                    setTicked((current) => {
                      const next = new Set(current);
                      if (on) next.add(field.key);
                      else next.delete(field.key);
                      return next;
                    });
                  }}
                />
              ) : null}
            </div>
          );
        })}
        {met.length > 0 ? (
          <div className="grid gap-2 rounded-lg bg-muted px-3 py-2.5">
            {met.map(({ entry, existing }) => (
              <FieldHint key={entry.path}>
                {entry.label}: {overwrite ? COPY.replaced(existing) : COPY.kept(existing)}
              </FieldHint>
            ))}
            <CheckboxItem
              label={COPY.replace}
              checked={overwrite}
              disabled={disabled}
              onChange={(event) => {
                setOverwrite(event.target.checked);
              }}
            />
          </div>
        ) : null}
        {failed ? (
          <Alert variant="destructive">
            <Icon icon={AlertCircleIcon} />
            <AlertDescription>{COPY.applyFailed}</AlertDescription>
          </Alert>
        ) : null}
        {working === 'refreshing' ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            {COPY.refreshing}
          </p>
        ) : null}
      </DialogBody>
      <DialogFooter>
        {empty ? (
          <Button type="button" onClick={onClose}>
            {COPY.close}
          </Button>
        ) : (
          <>
            {unticked > 0 ? (
              <FieldHint className="mr-auto self-center">{COPY.tickLow(unticked)}</FieldHint>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              disabled={disabled || unticked > 0}
              onClick={() => {
                void apply('new');
              }}
            >
              {COPY.addNew}
            </Button>
            <Button
              type="button"
              disabled={disabled || unticked > 0}
              onClick={() => {
                void apply('apply');
              }}
            >
              {COPY.applyHere}
            </Button>
          </>
        )}
      </DialogFooter>
    </>
  );
}
