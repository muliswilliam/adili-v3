const NUMBER_FORMAT = new Intl.NumberFormat('en-KE');

/** `48312` → `48,312`. */
export function formatNumber(value: number): string {
  return NUMBER_FORMAT.format(value);
}

const PERCENT_FORMAT = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 1 });

const FIXED_PERCENT_FORMAT = new Intl.NumberFormat('en-KE', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/**
 * `84.25` → `84.3%`: a percentage to one decimal place at most. `fixed` always shows the decimal
 * (`90.0%`), so a column of rates lines up.
 */
export function formatPercent(
  percent: number,
  { fixed = false }: { fixed?: boolean } = {},
): string {
  return `${(fixed ? FIXED_PERCENT_FORMAT : PERCENT_FORMAT).format(percent)}%`;
}
