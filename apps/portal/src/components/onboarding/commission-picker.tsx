import { Combobox } from '@adili/ui';

import type { OnboardingCommission } from '../../server/directory/types';

/** Commissions whose name or code contains the typed text, ignoring case. */
export function matchCommissions(
  commissions: OnboardingCommission[],
  query: string,
): OnboardingCommission[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return commissions;
  return commissions.filter(
    (entry) =>
      entry.name.toLowerCase().includes(needle) || entry.issuerCode.toLowerCase().includes(needle),
  );
}

/** Searchable single selection, shared with the rest of the design system. */
export function CommissionPicker({
  commissions,
  value,
  onValueChange,
  onOpenChange,
  id,
  'aria-describedby': describedBy,
}: {
  commissions: OnboardingCommission[];
  value: string | null;
  onValueChange: (slug: string | null) => void;
  onOpenChange: (open: boolean) => void;
  id?: string;
  'aria-describedby'?: string;
}) {
  return (
    <Combobox
      id={id}
      aria-describedby={describedBy}
      options={commissions.map((entry) => ({
        value: entry.slug,
        label: entry.name,
        description: entry.issuerCode,
        secondaryText: entry.hasRoster ? undefined : 'Roster not imported yet',
      }))}
      value={value}
      onValueChange={onValueChange}
      onOpenChange={onOpenChange}
      placeholder="Search, e.g. Teachers"
      spellCheck={false}
      emptyText="No matching Commission. Try its short name, e.g. TSC."
    />
  );
}

/** The chosen Commission as a pill, on the steps after the Commission step. */
export function CommissionChip({ commission }: { commission: OnboardingCommission }) {
  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-card py-1.5 pr-2 pl-1.5 text-[13.5px] font-medium shadow-control">
      <span className="grid h-[22px] shrink-0 place-items-center rounded-full bg-brand-subtle px-[7px] font-mono text-[11px] font-semibold text-brand-subtle-foreground">
        {commission.issuerCode}
      </span>
      <span className="truncate">{commission.name}</span>
    </span>
  );
}
