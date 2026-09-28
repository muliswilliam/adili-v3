/**
 * A loggable description of a thrown value that never carries its message, which can quote
 * personal data (recipients, identifiers): the error name, plus its `code` when it has one
 * (e.g. `Error:ECONNREFUSED`).
 */
export function errorType(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? `${error.name}:${code}` : error.name;
}
