import { describe, expect, it } from 'vitest';

import { countQuestion } from '../../src/assistant/theme-counts.js';
import type { Transaction } from '../../src/db/transaction.js';

/**
 * Counting a question (spec 11 S8) in a savepoint of the transaction that stores its answer: only
 * the row-level security's refusal is skipped (the integration suite covers it end to end);
 * anything else fails the store, rather than reading as "not counted".
 */

function failingWith(error: Error): Transaction {
  return { transaction: () => Promise.reject(error) } as unknown as Transaction;
}

/** A Postgres error as Drizzle wraps it: the driver's error, with its SQLSTATE, as the cause. */
function postgresError(code: string): Error {
  return new Error('Failed query', { cause: Object.assign(new Error('driver'), { code }) });
}

const question = {
  tenant: 'psc',
  text: "Do I declare my wife's salary?",
  at: new Date('2027-11-15T09:00:00.000Z'),
  declined: false,
};

describe('countQuestion', () => {
  it('skips a count the row-level security refuses, giving the theme', async () => {
    await expect(countQuestion(failingWith(postgresError('42501')), question)).resolves.toBe(
      'income',
    );
  });

  it.each([
    ['a serialization failure', postgresError('40001')],
    ['a lost connection', new Error('Connection terminated unexpectedly')],
  ])('fails on %s', async (_, error) => {
    await expect(countQuestion(failingWith(error), question)).rejects.toBe(error);
  });
});
