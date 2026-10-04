const NUMBER_FORMAT = new Intl.NumberFormat('en-KE');

/** `48312` → `48,312`. */
export function formatNumber(value: number): string {
  return NUMBER_FORMAT.format(value);
}

const PERCENT_FORMAT = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 1 });

/** `84.25` → `84.3%`: a percentage to one decimal place at most. */
export function formatPercent(percent: number): string {
  return `${PERCENT_FORMAT.format(percent)}%`;
}
