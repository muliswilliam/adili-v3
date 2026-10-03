import {
  Alert,
  AlertTitle,
  Button,
  CardIcon,
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
  Select,
  SelectItem,
  cn,
  useToast,
} from '@adili/ui';
import {
  AlertCircleIcon,
  ArrowTurnBackwardIcon,
  Delete02Icon,
  Loading03Icon,
  Route02Icon,
} from '@hugeicons/core-free-icons';
import { useRouter } from '@tanstack/react-router';
import { type SyntheticEvent, useId, useState } from 'react';

import type { Route, RouteInput } from '../../server/ai-gateway/types';
import type { RouteRow } from '../../server/ai-policy.server';
import type { ServiceResult } from '../../server/service-call';
import { messages as m } from './messages';
import {
  COMMISSION_TASKS,
  EFFORTS,
  type RouteDraft,
  routeDraft,
  type RouteErrors,
  routeErrors,
  routeInput,
  type RouteTask,
} from './model';

/** Routes a task for every Commission (tenant null) or one; the page passes the server function. */
export type SaveRoute = (
  input: { tenant: string | null; task: RouteTask } & RouteInput,
) => Promise<ServiceResult<Route>>;

/**
 * Removes a Commission's own route of a task, or (tenant null) a task's default route so it is
 * back on the gateway's configured provider and model; the page passes the server function.
 */
export type RemoveRoute = (input: {
  tenant: string | null;
  task: RouteTask;
  approvalRef: string;
}) => Promise<ServiceResult<null>>;

export interface RouteDialogProps {
  /** The route to edit; null to add a Commission's route. */
  route: RouteRow | null;
  /** Its scope as the table names it ("All Commissions" or the Commission's name). */
  scope: string | null;
  /** The Commissions a new route may be for, by name. */
  commissions: readonly { slug: string; name: string }[];
  /** The routing table, so adding a route a Commission already has says it replaces it. */
  routes: readonly RouteRow[];
  save: SaveRoute;
  remove: RemoveRoute;
  onClose: () => void;
  onUnauthenticated: () => void;
}

const FAILED: ServiceResult<never> = { ok: false, error: { kind: 'unavailable', detail: null } };

/**
 * "Edit route" and "Add a Commission's route" (spec 07c story 17, S16): where a task's calls go,
 * the provider, model and call parameters, on an approval reference the gateway records in the
 * audit trail. A Commission's own route can be removed, so it follows every Commission's again,
 * and an edited default route reset to the configured provider; both after a confirm step.
 */
export function RouteDialog(props: RouteDialogProps) {
  const { route, commissions, onClose, onUnauthenticated } = props;
  const id = useId();
  const router = useRouter();
  const { toast } = useToast();
  const [task, setTask] = useState<RouteTask>(route?.task ?? 'draft-clarification');
  const [tenant, setTenant] = useState<string>(route?.tenant ?? commissions[0]?.slug ?? '');
  const [draft, setDraft] = useState<RouteDraft>(() => routeDraft(route));
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<RouteErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  const [step, setStep] = useState<'edit' | 'confirm'>('edit');
  const errors = submitted ? { ...routeErrors(draft), ...serverErrors } : serverErrors;
  const field = (name: keyof RouteDraft) => `${id}-${name}`;
  const scopeTenant = route ? route.tenant : tenant;
  // A Commission's own route is removed; a stored default route is reset to the configured one.
  const removal = !route ? null : route.tenant ? 'remove' : route.configured ? null : 'reset';
  const commissionName = (slug: string) =>
    commissions.find((each) => each.slug === slug)?.name ?? slug;
  const replaces = route
    ? null
    : (props.routes.find((each) => each.tenant === tenant && each.task === task) ?? null);

  const update = (patch: Partial<RouteDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setServerErrors({});
  };

  /** Folds a failed save or removal into the dialog: field errors, or what went wrong. */
  const failed = (result: Extract<ServiceResult<unknown>, { ok: false }>) => {
    if (result.error.kind === 'unauthenticated') {
      onUnauthenticated();
      return;
    }
    const { error } = result;
    if (error.kind === 'problem' && error.problem.status === 400) {
      const paths = problemPaths(error.problem);
      if (paths.includes('provider')) setServerErrors({ provider: m.routeProviderUnknown });
      else if (paths.includes('approvalRef')) {
        // The field lives on the edit step; a removal refused for it goes back there (N20).
        setServerErrors({ approvalRef: m.approvalRefRequired });
        setStep('edit');
      }
      setFailure(m.routeRejected);
      return;
    }
    setFailure(
      error.kind === 'problem' && error.problem.status === 403 ? m.saveForbidden : m.routeError,
    );
  };

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setSubmitted(true);
    setServerErrors({});
    setFailure(null);
    const found = routeErrors(draft);
    const first = (Object.keys(found) as (keyof RouteDraft)[])[0];
    if (first) {
      document.getElementById(field(first))?.focus();
      return;
    }
    setBusy('save');
    const result = await props
      .save({ tenant: scopeTenant ?? null, task, ...routeInput(draft) })
      .catch(() => FAILED);
    setBusy(null);
    if (!result.ok) {
      failed(result);
      return;
    }
    toast({ title: m.routeSaved });
    onClose();
    void router.invalidate();
  };

  /** Remove or reset asks for the approval reference, then for a confirm. */
  const confirmRemoval = () => {
    if (busy || !removal) return;
    setFailure(null);
    if (!draft.approvalRef.trim()) {
      setSubmitted(false);
      setServerErrors({ approvalRef: m.approvalRefRequired });
      document.getElementById(field('approvalRef'))?.focus();
      return;
    }
    setStep('confirm');
  };

  const removeRoute = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !route || !removal) return;
    setFailure(null);
    setBusy('remove');
    const result = await props
      .remove({ tenant: route.tenant, task: route.task, approvalRef: draft.approvalRef.trim() })
      .catch(() => FAILED);
    setBusy(null);
    if (!result.ok) {
      failed(result);
      return;
    }
    toast({ title: removal === 'reset' ? m.routeReset : m.routeRemoved });
    onClose();
    void router.invalidate();
  };

  const failureAlert = failure ? (
    <Alert variant="destructive">
      <Icon icon={AlertCircleIcon} />
      <AlertTitle>{failure}</AlertTitle>
    </Alert>
  ) : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent busy={busy !== null}>
        <DialogHeader className="flex-row items-start gap-3">
          <CardIcon
            className={cn('mb-0', step === 'confirm' && 'bg-destructive-subtle text-destructive')}
          >
            <Icon
              icon={
                step === 'edit'
                  ? Route02Icon
                  : removal === 'reset'
                    ? ArrowTurnBackwardIcon
                    : Delete02Icon
              }
            />
          </CardIcon>
          <div className="grid gap-0.5">
            <DialogTitle>
              {step === 'confirm'
                ? removal === 'reset'
                  ? m.confirmResetTitle
                  : m.confirmRemoveTitle
                : route
                  ? m.routeTitleEdit
                  : m.routeTitleAdd}
            </DialogTitle>
            <DialogDescription>
              {route ? `${route.task} · ${props.scope ?? m.allCommissions}` : m.routingAudited}
            </DialogDescription>
          </div>
        </DialogHeader>
        {step === 'confirm' && route ? (
          <form
            noValidate
            onSubmit={(event) => void removeRoute(event)}
            aria-busy={busy !== null}
            className="flex min-h-0 flex-1 flex-col"
          >
            <DialogBody className="gap-4">
              {failureAlert}
              <p className="rounded-xl bg-muted px-3.5 py-3 text-sm">
                {route.tenant
                  ? m.confirmRemoveText(route.task, props.scope ?? commissionName(route.tenant))
                  : m.confirmResetText(route.task)}
              </p>
              <dl className="grid gap-0.5 text-sm">
                <dt className="text-[13px] text-muted-foreground">{m.approvalRefTerm}</dt>
                <dd className="break-words">{draft.approvalRef.trim()}</dd>
              </dl>
            </DialogBody>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={busy !== null}
                onClick={() => {
                  setFailure(null);
                  setStep('edit');
                }}
              >
                {m.back}
              </Button>
              <Button type="submit" variant="destructive" disabled={busy !== null}>
                {busy === 'remove' ? (
                  <>
                    <Icon icon={Loading03Icon} className="animate-spin" />
                    {removal === 'reset' ? m.resetting : m.removing}
                  </>
                ) : removal === 'reset' ? (
                  m.confirmReset
                ) : (
                  m.removeRoute
                )}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form
            noValidate
            onSubmit={(event) => void submit(event)}
            aria-busy={busy !== null}
            className="flex min-h-0 flex-1 flex-col"
          >
            <DialogBody>
              <fieldset disabled={busy !== null} className="m-0 grid min-w-0 gap-4.5 border-0 p-0">
                {failureAlert}
                {route ? null : (
                  <div className="grid gap-4.5 sm:grid-cols-2">
                    <FormField label={m.routeTask} controlId={`${id}-task`}>
                      <Select
                        value={task}
                        className="font-mono text-[12.5px]"
                        onValueChange={(value) => {
                          setTask(COMMISSION_TASKS.find((each) => each === value) ?? task);
                        }}
                      >
                        {COMMISSION_TASKS.map((each) => (
                          <SelectItem key={each} value={each} className="font-mono text-[12.5px]">
                            {each}
                          </SelectItem>
                        ))}
                      </Select>
                    </FormField>
                    <FormField label={m.routeScope} controlId={`${id}-tenant`}>
                      <Select value={tenant} onValueChange={setTenant}>
                        {commissions.map((each) => (
                          <SelectItem key={each.slug} value={each.slug}>
                            {each.name}
                          </SelectItem>
                        ))}
                      </Select>
                    </FormField>
                  </div>
                )}
                {replaces ? (
                  <Alert variant="warning">
                    <Icon icon={AlertCircleIcon} />
                    <AlertTitle>{m.routeReplaces(commissionName(tenant), task)}</AlertTitle>
                  </Alert>
                ) : null}
                <FormField
                  label={m.routeProvider}
                  hint={m.routeProviderHint}
                  error={errors.provider}
                  controlId={field('provider')}
                >
                  <Input
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono"
                    maxLength={100}
                    value={draft.provider}
                    onChange={(event) => {
                      update({ provider: event.target.value });
                    }}
                  />
                </FormField>
                <FormField label={m.routeModel} error={errors.model} controlId={field('model')}>
                  <Input
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono"
                    maxLength={200}
                    value={draft.model}
                    onChange={(event) => {
                      update({ model: event.target.value });
                    }}
                  />
                </FormField>
                <div className="grid gap-1.5">
                  <div className="grid gap-4.5 sm:grid-cols-3">
                    <FormField
                      label={m.routeMaxTokens}
                      error={errors.maxOutputTokens}
                      controlId={field('maxOutputTokens')}
                    >
                      <Input
                        inputMode="numeric"
                        autoComplete="off"
                        className="tabular-nums"
                        value={draft.maxOutputTokens}
                        onChange={(event) => {
                          update({ maxOutputTokens: event.target.value });
                        }}
                      />
                    </FormField>
                    <FormField label={m.routeEffort} controlId={field('effort')}>
                      <Select
                        value={draft.effort || 'default'}
                        onValueChange={(value) => {
                          update({ effort: EFFORTS.find((each) => each === value) ?? '' });
                        }}
                      >
                        <SelectItem value="default">{m.routeTaskDefault}</SelectItem>
                        {EFFORTS.map((each) => (
                          <SelectItem key={each} value={each}>
                            {m.effort(each)}
                          </SelectItem>
                        ))}
                      </Select>
                    </FormField>
                    <FormField
                      label={m.routeTimeout}
                      error={errors.timeoutSeconds}
                      controlId={field('timeoutSeconds')}
                    >
                      <Input
                        inputMode="decimal"
                        autoComplete="off"
                        className="tabular-nums"
                        value={draft.timeoutSeconds}
                        onChange={(event) => {
                          update({ timeoutSeconds: event.target.value });
                        }}
                      />
                    </FormField>
                  </div>
                  <p className="text-[13px] text-muted-foreground">{m.routeOptionalHint}</p>
                </div>
                <FormField
                  label={m.approvalRef}
                  hint={m.auditNote}
                  error={errors.approvalRef}
                  controlId={field('approvalRef')}
                >
                  <Input
                    autoComplete="off"
                    maxLength={200}
                    placeholder={m.approvalRefPlaceholder}
                    value={draft.approvalRef}
                    onChange={(event) => {
                      update({ approvalRef: event.target.value });
                    }}
                  />
                </FormField>
              </fieldset>
            </DialogBody>
            <DialogFooter>
              {removal ? (
                <Button
                  type="button"
                  variant="destructive-ghost"
                  className="sm:mr-auto"
                  disabled={busy !== null}
                  onClick={confirmRemoval}
                >
                  {removal === 'reset' ? m.resetRoute : m.removeRoute}
                </Button>
              ) : null}
              <Button type="button" variant="secondary" disabled={busy !== null} onClick={onClose}>
                {m.cancel}
              </Button>
              <Button type="submit" disabled={busy !== null}>
                {busy === 'save' ? (
                  <>
                    <Icon icon={Loading03Icon} className="animate-spin" />
                    {m.saving}
                  </>
                ) : replaces ? (
                  m.replaceRoute
                ) : (
                  m.saveRoute
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The field paths of a validation problem's `errors`, without a leading slash. */
function problemPaths(problem: object): string[] {
  const errors = 'errors' in problem && Array.isArray(problem.errors) ? problem.errors : [];
  return errors.flatMap((each: unknown) =>
    typeof each === 'object' && each !== null && 'path' in each && typeof each.path === 'string'
      ? [each.path.replace(/^\//, '')]
      : [],
  );
}
