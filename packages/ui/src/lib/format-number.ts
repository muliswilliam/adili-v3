const NUMBER_FORMAT = new Intl.NumberFormat('en-KE');

/** `48312` → `48,312`. */
export function formatNumber(value: number): string {
  return NUMBER_FORMAT.format(value);
}
