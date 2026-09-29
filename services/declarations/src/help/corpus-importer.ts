import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { type Database, InjectDatabase } from '@adili/data-access';

import type { DeclarationsSchema } from '../db/schema.js';
import { type CorpusFile, importCorpus, type ImportResult, loadCorpus } from './corpus.js';
import { lockCorpus, PostgresCorpusStore } from './postgres-corpus-store.js';

/** The corpus files the service imports: `corpus/*.json` as deployed. A Nest token for tests. */
@Injectable()
export class CorpusFiles {
  load(): CorpusFile[] {
    return loadCorpus();
  }
}

/** Imports the corpus files into `corpus_passages`, all under the corpus lock in one transaction. */
export async function runCorpusImport(
  db: Database<DeclarationsSchema>,
  files: CorpusFile[],
): Promise<ImportResult> {
  return db.transaction(async (tx) => {
    await lockCorpus(tx);
    return importCorpus(new PostgresCorpusStore(tx), files);
  });
}

/**
 * Keeps the stored corpus at the deployed files' version: on boot (a no-op when nothing changed,
 * and safe with several replicas booting at once) and when a platform administrator re-imports.
 */
@Injectable()
export class CorpusImporter implements OnApplicationBootstrap {
  private readonly logger = new Logger(CorpusImporter.name);

  constructor(
    @InjectDatabase() private readonly db: Database<DeclarationsSchema>,
    private readonly files: CorpusFiles,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.run();
  }

  async run(): Promise<ImportResult> {
    const result = await runCorpusImport(this.db, this.files.load());
    if (!result.skipped) {
      this.logger.log(
        `corpus ${result.version.slice(0, 12)} imported: ${String(result.inserted)} inserted, ${String(result.updated)} updated, ${String(result.removed)} removed`,
      );
    }
    return result;
  }
}
