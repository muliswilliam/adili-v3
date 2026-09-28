/**
 * The identify match rule's normalisation (spec 03): the personnel file number is compared
 * trimmed and case-insensitively (the roster's unique key is on `lower(personnel_file_number)`),
 * the national ID as digits only (the roster stores digits).
 */
export function normaliseFileNumber(value: string): string {
  return value.trim().toLowerCase();
}

export function normaliseNationalId(value: string): string {
  return value.replace(/\D/g, '');
}
