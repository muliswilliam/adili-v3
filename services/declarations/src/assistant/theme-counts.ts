import { Injectable, Logger } from '@nestjs/common';
import type { Principal } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { and, asc, desc, eq, sql } from 'drizzle-orm';

import type { DeclarationsSchema } from '../db/schema.js';
import type { Transaction } from '../db/transaction.js';
import { articleReadTenant } from '../help/access.js';
import { nairobiDate } from '../obligations/dates.js';
import type { QuestionThemeCount, ThemesQuery } from './representation.js';
import { assistantThemeCounts } from './schema.js';
import { type QuestionTheme, themeOf } from './themes.js';

const logger = new Logger('ThemeCounts');

/** A question being stored with its answer: its Commission, words, time and whether declined. */
export interface CountedQuestion {
  tenant: string;
  text: string;
  at: Date;
  declined: boolean;
}

/**
 * Counts the question at the conversation's Commission, in a savepoint of the transaction that
 * stores it: a count the row-level security refuses (the person no longer has an obligation
 * there) is logged and skipped rather than losing the answer; any other failure fails the store.
 * Returns its theme.
 */
export async function countQuestion(
  tx: Transaction,
  question: CountedQuestion,
): Promise<QuestionTheme> {
  const theme = themeOf(question.text);
  try {
    await tx.transaction((savepoint) => upsertCount(savepoint, question, theme));
  } catch (error) {
    if (!refusedByRowSecurity(error)) throw error;
    logger.warn({ err: error }, 'A question could not be counted');
  }
  return theme;
}

/**
 * Whether row-level security refused the query, through Drizzle's wrapper: SQLSTATE 42501
 * (`insufficient_privilege`), which a person transaction holding its grants gets only from RLS.
 */
function refusedByRowSecurity(error: unknown): boolean {
  for (let cause = error; cause instanceof Error; cause = cause.cause) {
    if ('code' in cause && cause.code === '42501') return true;
  }
  return false;
}

async function upsertCount(
  tx: Transaction,
  question: Omit<CountedQuestion, 'text'>,
  theme: QuestionTheme,
): Promise<void> {
  const unanswered = question.declined ? 1 : 0;
  await tx
    .insert(assistantThemeCounts)
    .values({
      tenant: question.tenant,
      month: nairobiDate(question.at).slice(0, 7),
      theme,
      count: 1,
      unanswered,
    })
    .onConflictDoUpdate({
      target: [assistantThemeCounts.tenant, assistantThemeCounts.month, assistantThemeCounts.theme],
      set: {
        count: sql`${assistantThemeCounts.count} + 1`,
        unanswered: sql`${assistantThemeCounts.unanswered} + ${unanswered}`,
      },
    });
}

/**
 * A Commission's anonymised question counts (spec 11 S8): each question is counted, by its
 * theme (the keyword rules of `themes.ts`), in the transaction that stores it with its answer,
 * so a question is counted once whatever becomes of its conversation, and its text is read only
 * there, already in hand. Counted by month (Nairobi) and theme, with the unanswered ones: those
 * whose answer is the decline. The Commission's administrators and reporting officers read them.
 */
@Injectable()
export class ThemeCounts {
  constructor(@InjectDatabase() private readonly db: Database<DeclarationsSchema>) {}

  /** The Commission's counts, of one month or all; newest month first, then the most asked. */
  async read(
    principal: Principal,
    slug: string,
    query: ThemesQuery,
  ): Promise<QuestionThemeCount[]> {
    const tenant = articleReadTenant(principal, slug);
    return withTenant(this.db, { tenant, subject: principal.subject }, (tx) =>
      tx
        .select({
          month: assistantThemeCounts.month,
          theme: assistantThemeCounts.theme,
          count: assistantThemeCounts.count,
          unanswered: assistantThemeCounts.unanswered,
        })
        .from(assistantThemeCounts)
        .where(
          and(
            eq(assistantThemeCounts.tenant, tenant),
            query.month === undefined ? undefined : eq(assistantThemeCounts.month, query.month),
          ),
        )
        .orderBy(
          desc(assistantThemeCounts.month),
          desc(assistantThemeCounts.count),
          asc(assistantThemeCounts.theme),
        ),
    );
  }
}
