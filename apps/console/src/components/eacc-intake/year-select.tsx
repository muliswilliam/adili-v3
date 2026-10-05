import { formatDate, Select, SelectItem } from '@adili/ui';
import { useId } from 'react';

import { financialYears } from './intake-view';
import { messages as m } from './messages';

/**
 * The financial year on show in EACC's compliance reports (the intake and the national report):
 * every year since the first, newest first, with its due date. On a phone the label is left to
 * screen readers and the select takes the row.
 */
export function YearSelect({
  today,
  fy,
  onChange,
}: {
  today: string;
  fy: number;
  onChange: (fy: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex w-full min-w-0 items-center gap-2.5 sm:w-auto">
      <label
        id={`${id}-label`}
        htmlFor={id}
        className="sr-only text-[13.5px] whitespace-nowrap text-muted-foreground sm:not-sr-only"
      >
        {m.financialYear}
      </label>
      <Select
        id={id}
        aria-labelledby={`${id}-label`}
        value={String(fy)}
        onValueChange={(value) => {
          onChange(Number(value));
        }}
        className="h-10 w-full min-w-0 text-[14.5px] sm:w-auto sm:min-w-[260px]"
      >
        {financialYears(today).map((option) => (
          <SelectItem key={option.fy} value={String(option.fy)}>
            {m.fyOption(m.fyLabel(option.fy), formatDate(option.dueDate), option.current)}
          </SelectItem>
        ))}
      </Select>
    </div>
  );
}
