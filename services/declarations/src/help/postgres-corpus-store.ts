import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { Transaction } from '../db/transaction.js';
import type { CorpusPassage, CorpusStore, ImportPlan } from './corpus.js';
import { corpusImports, corpusPassages } from './schema.js';

/** The advisory lock every corpus import holds for its transaction. */
const CORPUS_LOCK = sql`select pg_advisory_xact_lock(hashtext('declarations.corpus-import'))`;

/**
 * Holds the corpus lock until the transaction ends: imports on other connections (another
 * replica booting, a platform-admin re-import) wait, then see what this one wrote.
 */
export async function lockCorpus(tx: Transaction): Promise<void> {
  await tx.execute(CORPUS_LOCK);
}

/**
 * The corpus in `corpus_passages`, within one transaction. `apply` takes the corpus lock and
 * re-checks the version under it, so of two imports of the same version the second does nothing;
 * run the whole import under `lockCorpus` (as `CorpusImporter` does) so the plan is also read
 * under the lock and cannot be stale.
 */
export class PostgresCorpusStore implements CorpusStore {
  constructor(private readonly tx: Transaction) {}

  async currentVersion(): Promise<string | null> {
    const [latest] = await this.tx
      .select({ version: corpusImports.version })
      .from(corpusImports)
      .orderBy(desc(corpusImports.id))
      .limit(1);
    return latest?.version ?? null;
  }

  async passages(): Promise<CorpusPassage[]> {
    return this.tx
      .select({
        source: corpusPassages.source,
        citation: corpusPassages.citation,
        title: corpusPassages.title,
        textEn: corpusPassages.textEn,
        textSw: corpusPassages.textSw,
        tags: corpusPassages.tags,
        effectiveFrom: corpusPassages.effectiveFrom,
        effectiveTo: corpusPassages.effectiveTo,
        version: corpusPassages.version,
      })
      .from(corpusPassages)
      .orderBy(
        asc(corpusPassages.source),
        asc(corpusPassages.citation),
        asc(corpusPassages.effectiveFrom),
      );
  }

  async apply(plan: ImportPlan, version: string): Promise<void> {
    await lockCorpus(this.tx);
    if ((await this.currentVersion()) === version) return;
    for (const passage of plan.remove) {
      await this.tx.delete(corpusPassages).where(wording(passage));
    }
    for (const passage of plan.update) {
      await this.tx
        .update(corpusPassages)
        .set({
          title: passage.title,
          textEn: passage.textEn,
          textSw: passage.textSw,
          tags: passage.tags,
          effectiveTo: passage.effectiveTo,
          version: passage.version,
        })
        .where(wording(passage));
    }
    if (plan.insert.length > 0) {
      await this.tx
        .insert(corpusPassages)
        .values(plan.insert.map((passage) => ({ id: uuidv7(), ...passage })));
    }
    await this.tx.insert(corpusImports).values({
      version,
      inserted: plan.insert.length,
      updated: plan.update.length,
      removed: plan.remove.length,
    });
  }
}

function wording({ source, citation, effectiveFrom }: CorpusPassage) {
  return and(
    eq(corpusPassages.source, source),
    eq(corpusPassages.citation, citation),
    eq(corpusPassages.effectiveFrom, effectiveFrom),
  );
}
