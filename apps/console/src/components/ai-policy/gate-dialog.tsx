import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  CardIcon,
  Checkbox,
  cn,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Icon,
  Input,
  useToast,
} from '@adili/ui';
import {
  AlertCircleIcon,
  Globe02Icon,
  Loading03Icon,
  Shield01Icon,
  SquareLock02Icon,
} from '@hugeicons/core-free-icons';
import { useRouter } from '@tanstack/react-router';
import { type SyntheticEvent, useId, useState } from 'react';

import type { TenantPolicy } from '../../server/ai-gateway/types';
import type { AiTenantRow, GateChange } from '../../server/ai-policy.server';
import type { ServiceResult } from '../../server/service-call';
import { messages as m } from './messages';
import { DataClassesTip } from './parts';
import {
  confirmText,
  DATA_CLASSES,
  gateChanges,
  type GateDraft,
  gateDraft,
  PROVIDER_CLASSES,
} from './model';

/** Saves the changed cells, all or none, on one approval reference; the page passes the server function. */
export type SaveGate = (input: {
  tenant: string;
  changes: GateChange[];
  approvalRef: string;
}) => Promise<ServiceResult<TenantPolicy>>;

export interface GateDialogProps {
  row: AiTenantRow;
  save: SaveGate;
  /** Back to the Commission's drawer: on Cancel, Esc, and after saving. */
  onClose: () => void;
  onUnauthenticated: () => void;
}

interface SaveFailure {
  title: string;
  text?: string;
}

/**
 * "Edit gate policy" (spec 07c FE-4, S16): a checkbox per data class and provider class, then a
 * confirm step that says in words what changes for the Commission and requires the approval
 * reference, which the gateway records in the audit trail with the change.
 */
export function GateDialog({ row, save, onClose, onUnauthenticated }: GateDialogProps) {
  const id = useId();
  const router = useRouter();
  const { toast } = useToast();
  const [draft, setDraft] = useState<GateDraft>(() => gateDraft(row.gate));
  const [step, setStep] = useState<'edit' | 'confirm'>('edit');
  const [approvalRef, setApprovalRef] = useState('');
  const [refError, setRefError] = useState<string>();
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [saving, setSaving] = useState(false);
  const changes = gateChanges(row.gate, draft);
  const refId = `${id}-ref`;
  const allowsExternal = changes.some(
    (change) => change.allowed && change.providerClass === 'external',
  );

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    if (!approvalRef.trim()) {
      setRefError(m.approvalRefRequired);
      document.getElementById(refId)?.focus();
      return;
    }
    setRefError(undefined);
    setFailure(null);
    setSaving(true);
    const result = await save({ tenant: row.slug, changes, approvalRef: approvalRef.trim() }).catch(
      (): ServiceResult<TenantPolicy> => ({
        ok: false,
        error: { kind: 'unavailable', detail: null },
      }),
    );
    setSaving(false);
    if (result.ok) {
      toast({ title: m.policySaved });
      onClose();
      void router.invalidate();
      return;
    }
    if (result.error.kind === 'unauthenticated') {
      onUnauthenticated();
      return;
    }
    const { error } = result;
    if (error.kind === 'problem' && error.problem.status === 400) {
      setRefError(m.approvalRefRequired);
    }
    setFailure(
      error.kind === 'problem' && error.problem.status === 403
        ? { title: m.saveForbidden }
        : error.kind === 'problem' && error.problem.status === 400
          ? { title: m.saveRejected }
          : { title: m.saveError, text: m.saveErrorText },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent busy={saving} className={cn(step === 'edit' && 'sm:max-w-[720px]')}>
        <DialogHeader className="flex-row items-start gap-3">
          <CardIcon
            className={cn(
              'mb-0',
              step === 'confirm' && allowsExternal && 'bg-warning-subtle text-warning',
            )}
          >
            <Icon icon={step === 'confirm' && allowsExternal ? Globe02Icon : Shield01Icon} />
          </CardIcon>
          <div className="grid gap-0.5">
            <DialogTitle>{step === 'edit' ? m.editTitle : m.confirmTitle}</DialogTitle>
            <DialogDescription>{row.name}</DialogDescription>
          </div>
        </DialogHeader>
        {step === 'edit' ? (
          <>
            <DialogBody className="gap-4">
              <EditMatrix
                draft={draft}
                onChange={(key, allowed) => {
                  setDraft((current) => ({ ...current, [key]: allowed }));
                }}
              />
              <p className="text-[13px] text-muted-foreground">{m.selfHostedNote}</p>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={onClose}>
                {m.cancel}
              </Button>
              <Button
                type="button"
                disabled={changes.length === 0}
                onClick={() => {
                  setStep('confirm');
                  requestAnimationFrame(() => document.getElementById(refId)?.focus());
                }}
              >
                {m.continue}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            noValidate
            onSubmit={(event) => void submit(event)}
            aria-busy={saving}
            className="flex min-h-0 flex-1 flex-col"
          >
            <DialogBody className="gap-4">
              {failure ? (
                <Alert variant="destructive">
                  <Icon icon={AlertCircleIcon} />
                  <AlertTitle>{failure.title}</AlertTitle>
                  {failure.text ? <AlertDescription>{failure.text}</AlertDescription> : null}
                </Alert>
              ) : null}
              {changes.length === 1 && changes[0] ? (
                <p className="rounded-xl bg-muted px-3.5 py-3 text-sm">
                  {confirmText(changes[0], row.name)}
                </p>
              ) : (
                <ul className="grid list-disc gap-2 rounded-xl bg-muted py-3 pr-3.5 pl-8 text-sm">
                  {changes.map((change) => (
                    <li key={`${change.dataClass}|${change.providerClass}`}>
                      {confirmText(change, row.name)}
                    </li>
                  ))}
                </ul>
              )}
              <FormField label={m.approvalRef} error={refError} controlId={refId}>
                <Input
                  value={approvalRef}
                  maxLength={200}
                  autoComplete="off"
                  placeholder={m.approvalRefPlaceholder}
                  disabled={saving}
                  onChange={(event) => {
                    setApprovalRef(event.target.value);
                    if (refError && event.target.value.trim()) setRefError(undefined);
                  }}
                />
              </FormField>
              <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <Icon icon={SquareLock02Icon} className="size-3.5 shrink-0" />
                {m.auditNote}
              </p>
            </DialogBody>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={saving}
                onClick={() => {
                  setFailure(null);
                  setRefError(undefined);
                  setStep('edit');
                }}
              >
                {m.back}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <>
                    <Icon icon={Loading03Icon} className="animate-spin" />
                    {m.saving}
                  </>
                ) : (
                  m.savePolicy
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditMatrix({
  draft,
  onChange,
}: {
  draft: GateDraft;
  onChange: (key: keyof GateDraft, allowed: boolean) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl shadow-card">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{m.editCaption}</caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="px-3 pt-2.5 pb-1 text-left text-[12.5px] font-medium whitespace-nowrap text-muted-foreground"
            >
              <span className="inline-flex items-center gap-1">
                {m.columnDataClass}
                <DataClassesTip />
              </span>
            </th>
            {PROVIDER_CLASSES.map((providerClass) => (
              <th
                key={providerClass}
                scope="col"
                className="px-3 pt-2.5 pb-1 text-left text-[12.5px] font-medium whitespace-nowrap text-muted-foreground"
              >
                {m.providerClass[providerClass]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DATA_CLASSES.map((dataClass) => (
            <tr key={dataClass} className="border-b last:border-0">
              <th scope="row" className="px-3 py-2.5 text-left font-medium whitespace-nowrap">
                {m.dataClass[dataClass]}
              </th>
              {PROVIDER_CLASSES.map((providerClass) => {
                const key = `${dataClass}|${providerClass}` as const;
                const allowed = draft[key];
                const provider = m.providerClass[providerClass];
                const data = m.dataClass[dataClass];
                return (
                  <td key={providerClass} className="px-3 py-2.5">
                    <label className="inline-flex cursor-pointer items-center gap-2.5">
                      <Checkbox
                        checked={allowed}
                        aria-label={m.allowLabel(provider, data)}
                        onChange={(event) => {
                          onChange(key, event.target.checked);
                        }}
                      />
                      <span
                        aria-hidden="true"
                        className={cn(!allowed && 'text-secondary-foreground')}
                      >
                        {allowed ? m.allowed : m.blocked}
                      </span>
                    </label>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
