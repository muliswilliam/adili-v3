/** The unique constraint a failed query violated, looking through Drizzle's error wrapper. */
export function violatedUniqueConstraint(error: unknown): string | undefined {
  for (let cause = error; cause instanceof Error; cause = cause.cause) {
    if ('code' in cause && cause.code === '23505' && 'constraint' in cause) {
      return typeof cause.constraint === 'string' ? cause.constraint : undefined;
    }
  }
  return undefined;
}

/** Whether a failed query gave up waiting for a lock (`lock_timeout`, SQLSTATE 55P03). */
export function failedToLock(error: unknown): boolean {
  for (let cause = error; cause instanceof Error; cause = cause.cause) {
    if ('code' in cause && cause.code === '55P03') return true;
  }
  return false;
}
