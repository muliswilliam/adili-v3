import {
  Alert,
  AlertDescription,
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
  useToast,
} from '@adili/ui';
import {
  Alert02Icon,
  AlertCircleIcon,
  DashboardSpeed02Icon,
  Loading03Icon,
} from '@hugeicons/core-free-icons';
import { useRouter } from '@tanstack/react-router';
import { type SyntheticEvent, useId, useState } from 'react';

import type { TenantUsage } from '../../server/ai-gateway/types';
import type { AiTenantRow } from '../../server/ai-policy.server';
import type { ServiceResult } from '../../server/service-call';
import { formatNumber } from '../format';
import { messages as m } from './messages';
import {
  belowUsage,
  budgetErrors,
  type BudgetErrors,
  budgetResetsOn,
  parseWholeNumber,
} from './model';

/** Sets the monthly token budget and per-minute limit; the page passes the server function. */
export type SaveBudget = (input: {
  tenant: string;
  monthlyTokens: number;
  perMinute: number;
}) => Promise<ServiceResult<TenantUsage>>;

export interface BudgetDialogProps {
  row: AiTenantRow;
  usage: TenantUsage;
  save: SaveBudget;
  /** Back to the Commission's drawer: on Cancel, Esc, and after saving. */
  onClose: () => void;
  onUnauthenticated: () => void;
}

/**
 * "Edit budget" (spec 07c FE-4, S16): the monthly token budget and the requests a minute. Warns
 * when the budget is under what the Commission has already used this month, as requests then
 * stop until the month ends.
 */
export function BudgetDialog({ row, usage, save, onClose, onUnauthenticated }: BudgetDialogProps) {
  const id = useId();
  const router = useRouter();
  const { toast } = useToast();
  const [tokens, setTokens] = useState(formatNumber(usage.monthlyTokens));
  const [perMinute, setPerMinute] = useState(String(usage.perMinute));
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<BudgetErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const errors = submitted ? { ...budgetErrors(tokens, perMinute), ...serverErrors } : {};
  const tokensId = `${id}-tokens`;
  const perMinuteId = `${id}-per-minute`;

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSubmitted(true);
    setServerErrors({});
    setFailure(null);
    const found = budgetErrors(tokens, perMinute);
    const monthlyTokens = parseWholeNumber(tokens);
    const limit = parseWholeNumber(perMinute);
    if (found.monthlyTokens || found.perMinute || monthlyTokens === null || limit === null) {
      document.getElementById(found.monthlyTokens ? tokensId : perMinuteId)?.focus();
      return;
    }
    setSaving(true);
    const result = await save({ tenant: row.slug, monthlyTokens, perMinute: limit }).catch(
      (): ServiceResult<TenantUsage> => ({
        ok: false,
        error: { kind: 'unavailable', detail: null },
      }),
    );
    setSaving(false);
    if (result.ok) {
      toast({ title: m.budgetSaved });
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
      setServerErrors({ monthlyTokens: m.monthlyTokensError, perMinute: m.perMinuteError });
      return;
    }
    setFailure(
      error.kind === 'problem' && error.problem.status === 403 ? m.saveForbidden : m.budgetError,
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent busy={saving}>
        <DialogHeader className="flex-row items-start gap-3">
          <CardIcon className="mb-0">
            <Icon icon={DashboardSpeed02Icon} />
          </CardIcon>
          <div className="grid gap-0.5">
            <DialogTitle>{m.budgetTitle}</DialogTitle>
            <DialogDescription>{row.name}</DialogDescription>
          </div>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(event) => void submit(event)}
          aria-busy={saving}
          className="flex min-h-0 flex-1 flex-col"
        >
          <DialogBody>
            <fieldset disabled={saving} className="m-0 grid min-w-0 gap-4.5 border-0 p-0">
              {failure ? (
                <Alert variant="destructive">
                  <Icon icon={AlertCircleIcon} />
                  <AlertTitle>{failure}</AlertTitle>
                </Alert>
              ) : null}
              <FormField
                label={m.monthlyTokens}
                hint={m.usedThisMonth(usage.tokensUsed)}
                error={errors.monthlyTokens}
                controlId={tokensId}
              >
                <Input
                  inputMode="numeric"
                  autoComplete="off"
                  className="tabular-nums"
                  value={tokens}
                  onChange={(event) => {
                    setTokens(event.target.value);
                    setServerErrors({});
                  }}
                />
              </FormField>
              <FormField
                label={m.requestsPerMinute}
                error={errors.perMinute}
                controlId={perMinuteId}
              >
                <Input
                  inputMode="numeric"
                  autoComplete="off"
                  className="tabular-nums"
                  value={perMinute}
                  onChange={(event) => {
                    setPerMinute(event.target.value);
                    setServerErrors({});
                  }}
                />
              </FormField>
              {belowUsage(tokens, usage) ? (
                <Alert variant="warning" role="status">
                  <Icon icon={Alert02Icon} />
                  <AlertDescription>{m.belowUsage(budgetResetsOn(usage.month))}</AlertDescription>
                </Alert>
              ) : null}
            </fieldset>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>
              {m.cancel}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? (
                <>
                  <Icon icon={Loading03Icon} className="animate-spin" />
                  {m.saving}
                </>
              ) : (
                m.saveBudget
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
