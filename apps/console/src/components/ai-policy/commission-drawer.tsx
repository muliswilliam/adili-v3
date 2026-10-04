import {
  Alert,
  AlertDescription,
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  formatDateTime,
  Icon,
  UsageMeter,
} from '@adili/ui';
import {
  Alert02Icon,
  DashboardSpeed02Icon,
  PencilEdit02Icon,
  Tick02Icon,
  UnavailableIcon,
} from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

import type { TenantUsage } from '../../server/ai-gateway/types';
import type { AiTenantRow } from '../../server/ai-policy.server';

import { formatNumber } from '../format';
import { messages as m } from './messages';
import { DataClassesTip, EnabledBadge } from './parts';
import {
  accessOf,
  accessText,
  budgetResetsOn,
  changedByText,
  changeText,
  DATA_CLASSES,
  formatCost,
  gateHistory,
  isEnabled,
  longMonth,
  PROVIDER_CLASSES,
  usageShare,
} from './model';

export interface CommissionDrawerProps {
  /** The Commission that is open; null when the drawer is closed. */
  row: AiTenantRow | null;
  onClose: () => void;
  onEditPolicy: () => void;
  onEditBudget: () => void;
}

/**
 * One Commission's AI policy (spec 07c FE-4): whether AI assistance is enabled and how, the gate
 * with the approval reference of each cell the Commission has a rule for, this month's usage and budget, and the
 * latest decision per cell; with the way to edit the policy and the budget.
 */
export function CommissionDrawer({
  row,
  onClose,
  onEditPolicy,
  onEditBudget,
}: CommissionDrawerProps) {
  return (
    <Drawer
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {row ? (
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{row.name}</DrawerTitle>
            <DrawerDescription className="font-mono text-[12.5px]">{row.slug}</DrawerDescription>
          </DrawerHeader>
          <DrawerBody className="gap-6">
            <AiStatusBadge row={row} />
            <Section title={m.gatePolicy} id="ai-drawer-gate">
              <GateMatrix row={row} />
            </Section>
            {row.usage ? (
              <Section title={m.usageHeading(longMonth(row.usage.month))} id="ai-drawer-usage">
                <Usage usage={row.usage} />
              </Section>
            ) : (
              <Alert variant="warning" role="status">
                <Icon icon={Alert02Icon} />
                <AlertDescription>{m.usageLoadError}</AlertDescription>
              </Alert>
            )}
            <Section title={m.changes} id="ai-drawer-changes">
              <Changes row={row} />
            </Section>
          </DrawerBody>
          <DrawerFooter>
            <Button variant="secondary" onClick={onEditBudget} disabled={row.usage === null}>
              <Icon icon={DashboardSpeed02Icon} />
              {m.editBudget}
            </Button>
            <Button onClick={onEditPolicy}>
              <Icon icon={PencilEdit02Icon} />
              {m.editPolicy}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      ) : null}
    </Drawer>
  );
}

function Section({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-2.5">
      <h3 id={id} className="text-[13.5px] font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** "Enabled" or "Not enabled", with what is allowed in words. */
function AiStatusBadge({ row }: { row: AiTenantRow }) {
  const enabled = isEnabled(row);
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-secondary-foreground">
      <EnabledBadge enabled={enabled} />
      <span>{accessText(accessOf(row)) ?? m.aiNotEnabledText}</span>
    </p>
  );
}

function GateMatrix({ row }: { row: AiTenantRow }) {
  return (
    <div className="overflow-x-auto rounded-xl shadow-card">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{m.gateCaption}</caption>
        <thead>
          <tr className="border-b">
            <th
              scope="col"
              className="px-3 py-2.5 text-left text-[12.5px] font-medium whitespace-nowrap text-muted-foreground"
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
                className="px-3 py-2.5 text-left text-[12.5px] font-medium whitespace-nowrap text-muted-foreground"
              >
                {m.providerClass[providerClass]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DATA_CLASSES.map((dataClass) => (
            <tr key={dataClass} className="border-b last:border-0">
              <th scope="row" className="px-3 py-2.5 text-left font-medium">
                {m.dataClass[dataClass]}
              </th>
              {PROVIDER_CLASSES.map((providerClass) => {
                const cell = row.gate.find(
                  (each) => each.dataClass === dataClass && each.providerClass === providerClass,
                );
                return (
                  <td key={providerClass} className="px-3 py-2.5">
                    {cell?.allowed ? (
                      <span className="inline-flex items-center gap-1.5 font-medium text-success">
                        <Icon icon={Tick02Icon} className="size-3.5" strokeWidth={2.4} />
                        {m.allowed}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{m.blocked}</span>
                    )}
                    {cell?.rule?.tasks ? (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {m.tasksOnly(cell.rule.allowed, cell.rule.tasks)}
                      </span>
                    ) : null}
                    {cell?.rule ? (
                      <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                        {cell.rule.approvalRef}
                      </span>
                    ) : (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {m.defaultRule}
                      </span>
                    )}
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

function Usage({ usage }: { usage: TenantUsage }) {
  const usedUp = usageShare(usage) >= 100;
  const figures: [string, string][] = [
    [m.jobs, formatNumber(usage.jobs)],
    [m.blockedJobs, formatNumber(usage.blocked)],
    [m.failedJobs, formatNumber(usage.failed)],
    [m.cost, formatCost(usage.costMicros)],
    [m.monthlyBudget, m.tokens(usage.monthlyTokens)],
    [m.rateLimit, m.perMinute(usage.perMinute)],
  ];
  return (
    <>
      <UsageMeter tokensUsed={usage.tokensUsed} monthlyTokens={usage.monthlyTokens} size="lg" />
      {usedUp ? (
        <Alert variant="destructive" role="status">
          <Icon icon={Alert02Icon} />
          <AlertDescription>{m.usedUpCallout(budgetResetsOn(usage.month))}</AlertDescription>
        </Alert>
      ) : null}
      <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-3 min-[440px]:grid-cols-3">
        {figures.map(([term, value]) => (
          <div key={term} className="min-w-0">
            <dt className="text-[12.5px] text-muted-foreground">{term}</dt>
            <dd className="font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function Changes({ row }: { row: AiTenantRow }) {
  const history = gateHistory(row.gate);
  if (history.length === 0) {
    return <p className="text-[13px] text-muted-foreground">{m.noChanges}</p>;
  }
  return (
    <ul className="grid gap-2.5">
      {history.map((rule) => (
        <li
          key={`${rule.dataClass}|${rule.providerClass}`}
          className="grid grid-cols-[26px_minmax(0,1fr)] gap-2.5 text-[13.5px]"
        >
          <span className="grid size-[26px] place-items-center rounded-lg bg-muted text-secondary-foreground">
            <Icon icon={rule.allowed ? Tick02Icon : UnavailableIcon} className="size-3.5" />
          </span>
          <div className="min-w-0">
            <p>{changeText(rule)}</p>
            <p className="text-[12.5px] text-muted-foreground">
              {changedByText(rule)} · {formatDateTime(rule.changedAt)} ·{' '}
              <span className="font-mono">{rule.approvalRef}</span>
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
