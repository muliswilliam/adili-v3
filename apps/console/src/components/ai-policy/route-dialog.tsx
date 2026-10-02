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
  useToast,
} from '@adili/ui';
import { AlertCircleIcon, Loading03Icon, Route02Icon } from '@hugeicons/core-free-icons';
import { useRouter } from '@tanstack/react-router';
import { type SyntheticEvent, useId, useState } from 'react';

import type { Route, RouteInput } from '../../server/ai-gateway/types';
import type { RouteRow } from '../../server/ai-policy.server';
import type { ServiceResult } from '../../server/service-call';
import { messages as m } from './messages';
import {
  EFFORTS,
  type RouteDraft,
  routeDraft,
  type RouteErrors,
  routeErrors,
  routeInput,
  type RouteTask,
  TASK_NAMES,
} from './model';

/** Routes a task for every Commission (tenant null) or one; the page passes the server function. */
export type SaveRoute = (
  input: { tenant: string | null; task: RouteTask } & RouteInput,
) => Promise<ServiceResult<Route>>;

/** Removes a Commission's own route of a task; the page passes the server function. */
export type RemoveRoute = (input: {
  tenant: string;
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
  save: SaveRoute;
  remove: RemoveRoute;
  onClose: () => void;
  onUnauthenticated: () => void;
}

const FAILED: ServiceResult<never> = { ok: false, error: { kind: 'unavailable', detail: null } };

/**
 * "Edit route" and "Add a Commission's route" (spec 07c story 17, S16): where a task's calls go,
 * the provider, model and call parameters, on an approval reference the gateway records in the
 * audit trail. A Commission's own route can be removed, so it follows every Commission's again.
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
  const errors = submitted ? { ...routeErrors(draft), ...serverErrors } : serverErrors;
  const field = (name: keyof RouteDraft) => `${id}-${name}`;
  const scopeTenant = route ? route.tenant : tenant;

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
      else if (paths.includes('approvalRef'))
        setServerErrors({ approvalRef: m.approvalRefRequired });
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

  const removeRoute = async () => {
    if (busy || !route?.tenant) return;
    setFailure(null);
    if (!draft.approvalRef.trim()) {
      setSubmitted(false);
      setServerErrors({ approvalRef: m.approvalRefRequired });
      document.getElementById(field('approvalRef'))?.focus();
      return;
    }
    setBusy('remove');
    const result = await props
      .remove({ tenant: route.tenant, task: route.task, approvalRef: draft.approvalRef.trim() })
      .catch(() => FAILED);
    setBusy(null);
    if (!result.ok) {
      failed(result);
      return;
    }
    toast({ title: m.routeRemoved });
    onClose();
    void router.invalidate();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent busy={busy !== null}>
        <DialogHeader className="flex-row items-start gap-3">
          <CardIcon className="mb-0">
            <Icon icon={Route02Icon} />
          </CardIcon>
          <div className="grid gap-0.5">
            <DialogTitle>{route ? m.routeTitleEdit : m.routeTitleAdd}</DialogTitle>
            <DialogDescription>
              {route ? `${route.task} · ${props.scope ?? m.allCommissions}` : m.routingAudited}
            </DialogDescription>
          </div>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(event) => void submit(event)}
          aria-busy={busy !== null}
          className="flex min-h-0 flex-1 flex-col"
        >
          <DialogBody>
            <fieldset disabled={busy !== null} className="m-0 grid min-w-0 gap-4.5 border-0 p-0">
              {failure ? (
                <Alert variant="destructive">
                  <Icon icon={AlertCircleIcon} />
                  <AlertTitle>{failure}</AlertTitle>
                </Alert>
              ) : null}
              {route ? null : (
                <div className="grid gap-4.5 sm:grid-cols-2">
                  <FormField label={m.routeTask} controlId={`${id}-task`}>
                    <Select
                      value={task}
                      onValueChange={(value) => {
                        setTask(TASK_NAMES.find((each) => each === value) ?? task);
                      }}
                    >
                      {TASK_NAMES.map((each) => (
                        <SelectItem key={each} value={each}>
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
                      inputMode="numeric"
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
            {route?.tenant ? (
              <Button
                type="button"
                variant="destructive-ghost"
                className="sm:mr-auto"
                disabled={busy !== null}
                onClick={() => void removeRoute()}
              >
                {busy === 'remove' ? (
                  <>
                    <Icon icon={Loading03Icon} className="animate-spin" />
                    {m.saving}
                  </>
                ) : (
                  m.removeRoute
                )}
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
              ) : (
                m.saveRoute
              )}
            </Button>
          </DialogFooter>
        </form>
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
