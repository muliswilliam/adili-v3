import {
  addDays,
  Alert,
  AlertDescription,
  Button,
  Card,
  CheckboxItem,
  DeadlineChip,
  deadlineSoonDays,
  FieldError,
  FormField,
  Icon,
  Input,
  RadioCard,
  RadioGroup,
  Select,
  SelectItem,
  Spinner,
  useToast,
  useIdempotencyKey,
} from '@adili/ui';
import { AlertCircleIcon } from '@hugeicons/core-free-icons';
import { useNavigate } from '@tanstack/react-router';
import { type ReactNode, useId, useRef, useState } from 'react';

import type { RosterCandidate } from '../../../server/access/types';
import { getDeclarantVersions, recordSelfAccessApplication } from '../../../server/self-access';
import type {
  DeclarantVersions,
  DeliveryMethod,
  SelfAccessApplicationInput,
  SelfAccessResult,
} from '../../../server/self-access.server';
import { goToSignIn } from '../../sign-in-redirect';
import {
  type Applicant,
  IDENTITY_DOCUMENTS,
  type IdentityDocument,
  identityNoteOf,
  NOTE_MAX,
  recordFailure,
} from './application-view';
import { DeclarantPicker } from './declarant-picker';
import { messages as m } from './messages';
import { EMPTY_PROOF, ProofField, type ProofSlot } from './proof-field';
import { VersionPicker, type VersionsLoad, versionKey } from './version-picker';

/** What the officer has entered so far. */
export interface RecordForm {
  declarant: RosterCandidate | null;
  applicant: Applicant;
  document: IdentityDocument;
  matches: boolean;
  note: string;
  repName: string;
  repIdNumber: string;
  authority: ProofSlot;
  identification: ProofSlot;
  version: string | null;
  delivery: DeliveryMethod;
}

export type RecordField =
  | 'declarant'
  | 'matches'
  | 'note'
  | 'repName'
  | 'repIdNumber'
  | 'authority'
  | 'identification'
  | 'version';

export type RecordErrors = Partial<Record<RecordField, string>>;

export const EMPTY_FORM: RecordForm = {
  declarant: null,
  applicant: 'declarant',
  document: 'national-id',
  matches: false,
  note: '',
  repName: '',
  repIdNumber: '',
  authority: EMPTY_PROOF,
  identification: EMPTY_PROOF,
  version: null,
  delivery: 'collection',
};

function proofError(slot: ProofSlot, required: string): string | undefined {
  if (slot.status === 'linked') return undefined;
  if (slot.status === 'uploading' || slot.status === 'scanning') return m.proofPending;
  // A problem shows on the file itself; ask for another.
  return required;
}

/** The form's problems before anything is sent, mirroring what the access service checks. */
export function recordErrors(form: RecordForm): RecordErrors {
  const errors: RecordErrors = {};
  if (!form.declarant) errors.declarant = m.declarantRequired;
  if (!form.matches) errors.matches = m.matchRequired;
  if (form.note.trim().length > NOTE_MAX) errors.note = m.noteTooLong;
  if (form.applicant === 'representative') {
    if (!form.repName.trim()) errors.repName = m.repNameRequired;
    if (!form.repIdNumber.trim()) errors.repIdNumber = m.repIdNumberRequired;
    const authority = proofError(form.authority, m.authorityRequired);
    if (authority) errors.authority = authority;
    const identification = proofError(form.identification, m.identificationRequired);
    if (identification) errors.identification = identification;
  }
  if (form.declarant && !form.version) errors.version = m.versionRequired;
  return errors;
}

/** The body of `recordSelfAccessApplication` for a form without errors. */
export function recordInput(form: RecordForm): SelfAccessApplicationInput | null {
  const [declarationId, version] = form.version?.split(':') ?? [];
  if (!form.declarant || !declarationId || !version) return null;
  const { authority, identification } = form;
  const representative =
    form.applicant === 'representative'
      ? authority.status === 'linked' && identification.status === 'linked'
        ? {
            name: form.repName.trim(),
            idNumber: form.repIdNumber.trim(),
            authorityUploadId: authority.uploadId,
            idUploadId: identification.uploadId,
          }
        : undefined
      : null;
  if (representative === undefined) return null;
  return {
    rosterRecordId: form.declarant.id,
    declarationId,
    version: Number(version),
    identityNote: identityNoteOf({
      applicant: form.applicant,
      document: form.document,
      note: form.note,
    }),
    representative,
    deliveryMethod: form.delivery,
  };
}

/** Two choices side by side, stacked on a phone. */
const TWO_UP = 'grid gap-2 min-[520px]:grid-cols-2';

/** The order the problems are focused in: the form's own order. */
const FIELD_ORDER: RecordField[] = [
  'declarant',
  'matches',
  'note',
  'repName',
  'repIdNumber',
  'authority',
  'identification',
  'version',
];

/**
 * Recording a declarant's written self-access application (Administrative Mechanism 32): find
 * the declarant on the roster, record the identity check (and for a representative their name,
 * ID number, written authority and ID as uploads), choose the version and how the copy is
 * delivered. Recording orders the certified copy at once; the officer lands on the application
 * to follow it.
 */
export function RecordApplicationForm({
  slug,
  commissionCode,
}: {
  slug: string;
  /** "PSC": the Commission the copy is collected at. */
  commissionCode: string;
}) {
  const id = useId();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [form, setForm] = useState<RecordForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<RecordErrors>({});
  const [versions, setVersions] = useState<VersionsLoad | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // One key per body: a retry after an outage records once, a changed form is a new request.
  const idempotencyKey = useIdempotencyKey();
  const latestVersions = useRef(0);
  const summaryRef = useRef<HTMLDivElement>(null);

  const change = (next: Partial<RecordForm>, cleared: RecordField[] = []) => {
    setForm((current) => ({ ...current, ...next }));
    if (cleared.some((field) => errors[field])) {
      setErrors((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([field]) => !cleared.includes(field as RecordField)),
        ),
      );
    }
  };

  const chooseDeclarant = (record: RosterCandidate | null) => {
    change({ declarant: record, version: null }, ['declarant', 'version']);
    const ticket = ++latestVersions.current;
    if (!record) {
      setVersions(null);
      return;
    }
    setVersions({ state: 'loading' });
    void getDeclarantVersions({ data: { slug, rosterRecordId: record.id } })
      .catch((): SelfAccessResult<DeclarantVersions> => ({
        ok: false,
        error: { kind: 'unavailable', detail: null },
      }))
      .then((result) => {
        if (ticket !== latestVersions.current) return;
        if (!result.ok && result.error.kind === 'unauthenticated') {
          goToSignIn();
          return;
        }
        setVersions({ state: 'done', result });
        // The version in force of the latest declaration, as the prototype preselects it.
        const first = result.ok ? result.data.versions.find((each) => !each.superseded) : undefined;
        if (first) setForm((current) => ({ ...current, version: versionKey(first) }));
      });
  };

  const focusFirst = (found: RecordErrors) => {
    const first = FIELD_ORDER.find((field) => found[field]);
    if (!first) return;
    requestAnimationFrame(() => {
      document.getElementById(`${id}-${first}`)?.focus();
    });
  };

  const submit = async () => {
    const found = recordErrors(form);
    setErrors(found);
    setFailure(null);
    const input = recordInput(form);
    if (Object.keys(found).length > 0 || !input) {
      focusFirst(found);
      return;
    }
    setBusy(true);
    const result = await recordSelfAccessApplication({
      data: { slug, input, idempotencyKey: idempotencyKey.keyFor(input) },
    }).catch((): Awaited<ReturnType<typeof recordSelfAccessApplication>> => ({
      ok: false,
      error: { kind: 'unavailable', detail: null },
    }));
    if (result.ok) {
      toast({ title: m.recorded });
      await navigate({
        to: '/access/certified-copies/$applicationId',
        params: { applicationId: result.data.id },
      });
      return;
    }
    setBusy(false);
    const failed = recordFailure(result.error);
    if (failed.signIn) {
      goToSignIn();
      return;
    }
    if (failed.field) {
      const next = { [failed.field]: failed.message };
      setErrors(next);
      focusFirst(next);
      if (failed.field === 'authority' || failed.field === 'identification') {
        setForm((current) => ({ ...current, [failed.field as string]: EMPTY_PROOF }));
      }
      return;
    }
    setFailure(failed.message);
    requestAnimationFrame(() => summaryRef.current?.focus());
  };

  const representative = form.applicant === 'representative';
  const errorCount = Object.keys(errors).length;

  return (
    // Not a <form>: the roster search inside is one, and forms do not nest.
    <div role="form" aria-labelledby={`${id}-title`}>
      <div className="mb-[22px]">
        <h1
          id={`${id}-title`}
          className="text-[22px] leading-tight font-semibold tracking-[-0.02em] min-[700px]:text-[26px]"
        >
          {m.formTitle}
        </h1>
        <p className="mt-1 text-[14.5px] text-muted-foreground">{m.formIntro}</p>
      </div>
      <Card className="min-w-0 divide-y p-0 sm:p-0">
        <Section title={m.declarantTitle}>
          <DeclarantPicker
            id={`${id}-declarant`}
            slug={slug}
            selected={form.declarant}
            error={errors.declarant}
            onSelect={chooseDeclarant}
          />
        </Section>

        <Section title={m.identityTitle}>
          <RadioGroup legend={m.whoApplied}>
            <div className={TWO_UP}>
              {(['declarant', 'representative'] as const).map((applicant) => (
                <RadioCard
                  key={applicant}
                  name={`${id}-applicant`}
                  value={applicant}
                  checked={form.applicant === applicant}
                  onChange={() => {
                    change({ applicant, matches: false }, [
                      'matches',
                      'repName',
                      'repIdNumber',
                      'authority',
                      'identification',
                    ]);
                  }}
                  label={applicant === 'declarant' ? m.whoDeclarant : m.whoRepresentative}
                />
              ))}
            </div>
          </RadioGroup>
          <FormField
            label={representative ? m.documentOnAuthority : m.documentSeen}
            className="max-w-[360px]"
          >
            <Select
              id={`${id}-document`}
              value={form.document}
              onValueChange={(value) => {
                change({ document: value as IdentityDocument });
              }}
            >
              {IDENTITY_DOCUMENTS.map((document) => (
                <SelectItem key={document} value={document}>
                  {m.documents[document]}
                </SelectItem>
              ))}
            </Select>
          </FormField>
          <div className="grid gap-1.5">
            <CheckboxItem
              id={`${id}-matches`}
              label={representative ? m.authorityMatchesRoster : m.matchesRoster}
              checked={form.matches}
              aria-invalid={errors.matches ? true : undefined}
              aria-describedby={errors.matches ? `${id}-matches-error` : undefined}
              onChange={(event) => {
                change({ matches: event.target.checked }, ['matches']);
              }}
            />
            {errors.matches ? (
              <FieldError id={`${id}-matches-error`}>{errors.matches}</FieldError>
            ) : null}
          </div>
          <FormField
            label={
              <span className="flex w-full items-baseline justify-between gap-2">
                {m.note}
                <span className="text-[13px] font-normal text-muted-foreground">{m.optional}</span>
              </span>
            }
            hint={m.noteHint}
            error={errors.note}
          >
            <Input
              id={`${id}-note`}
              value={form.note}
              maxLength={NOTE_MAX + 50}
              placeholder={m.notePlaceholder}
              onChange={(event) => {
                change({ note: event.target.value }, ['note']);
              }}
            />
          </FormField>
        </Section>

        {representative ? (
          <Section title={m.representativeTitle}>
            <div className="grid gap-4 min-[640px]:grid-cols-2">
              <FormField label={m.repName} hint={m.repNameHint} error={errors.repName}>
                <Input
                  id={`${id}-repName`}
                  value={form.repName}
                  maxLength={200}
                  autoComplete="off"
                  onChange={(event) => {
                    change({ repName: event.target.value }, ['repName']);
                  }}
                />
              </FormField>
              <FormField label={m.repIdNumber} hint={m.repIdNumberHint} error={errors.repIdNumber}>
                <Input
                  id={`${id}-repIdNumber`}
                  value={form.repIdNumber}
                  maxLength={50}
                  autoComplete="off"
                  onChange={(event) => {
                    change({ repIdNumber: event.target.value }, ['repIdNumber']);
                  }}
                />
              </FormField>
            </div>
            <div className="grid gap-4 min-[640px]:grid-cols-2">
              <div id={`${id}-authority`} tabIndex={-1} className="outline-none">
                <ProofField
                  label={m.authority}
                  addLabel={m.authorityAdd}
                  value={form.authority}
                  error={errors.authority}
                  disabled={busy}
                  onChange={(slot) => {
                    change({ authority: slot }, ['authority']);
                  }}
                />
              </div>
              <div id={`${id}-identification`} tabIndex={-1} className="outline-none">
                <ProofField
                  label={m.identification}
                  addLabel={m.identificationAdd}
                  value={form.identification}
                  error={errors.identification}
                  disabled={busy}
                  onChange={(slot) => {
                    change({ identification: slot }, ['identification']);
                  }}
                />
              </div>
            </div>
            <p className="text-[13px] text-muted-foreground">{m.proofHint}</p>
          </Section>
        ) : null}

        <Section title={m.versionTitle}>
          <div id={`${id}-version`} tabIndex={-1} className="outline-none">
            <VersionPicker
              load={versions}
              value={form.version}
              error={errors.version}
              onChange={(version) => {
                change({ version }, ['version']);
              }}
            />
          </div>
        </Section>

        <Section title={m.deliveryTitle}>
          <RadioGroup legend={m.deliveryLabel} legendHidden>
            <div className={TWO_UP}>
              {(['collection', 'dispatch'] as const).map((delivery) => (
                <RadioCard
                  key={delivery}
                  name={`${id}-delivery`}
                  value={delivery}
                  checked={form.delivery === delivery}
                  onChange={() => {
                    change({ delivery });
                  }}
                  label={delivery === 'collection' ? m.collect(commissionCode) : m.dispatch}
                />
              ))}
            </div>
          </RadioGroup>
        </Section>

        <div className="grid gap-3 px-5 py-4">
          {failure ? (
            <Alert variant="destructive" ref={summaryRef} tabIndex={-1}>
              <Icon icon={AlertCircleIcon} />
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          ) : errorCount > 0 ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {m.fixErrors(errorCount)}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <div className="grid min-w-0 flex-1 gap-1 text-[13px] text-muted-foreground">
              <div className="flex flex-wrap items-center gap-2">
                <DeadlineChip
                  due={addDays(new Date().toISOString(), 14)}
                  soonDays={deadlineSoonDays.certifiedCopy}
                  label={m.issueBy}
                />
                <span>{m.issueWithin}</span>
              </div>
              <p>{m.issuesAtOnce}</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  void navigate({ to: '/access/certified-copies' });
                }}
              >
                {m.cancel}
              </Button>
              <Button
                type="button"
                disabled={busy}
                aria-busy={busy || undefined}
                onClick={() => void submit()}
              >
                {busy ? <Spinner className="size-4" /> : null}
                {m.record}
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid gap-4 px-5 py-5">
      <h2 id={id} className="text-[15px] font-semibold tracking-[-0.01em]">
        {title}
      </h2>
      {children}
    </section>
  );
}
