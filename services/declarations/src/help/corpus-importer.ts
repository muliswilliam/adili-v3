import { setTimeout } from 'node:timers/promises';

import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { type Database, InjectDatabase } from '@adili/data-access';
import { EventPublisher } from '@adili/events';

import type { DeclarationsSchema } from '../db/schema.js';
import { type CorpusFile, importCorpus, type ImportResult, loadCorpus } from './corpus.js';
import { corpusImported, type CorpusImportTrigger } from './events.js';
import { lockCorpus, PostgresCorpusStore } from './postgres-corpus-store.js';

/** How often the boot import is tried, and the pause before the next try (times the attempt). */
const BOOT_IMPORT_ATTEMPTS = 4;
const BOOT_IMPORT_RETRY_MS = 1_000;

/** The corpus files the service imports: `corpus/*.json` as deployed. A Nest token for tests. */
@Injectable()
export class CorpusFiles {
  load(): CorpusFile[] {
    return loadCorpus();
  }
}

/** What started an import, for its audit record, and the platform admin who asked, if any. */
export interface CorpusImportCause {
  trigger: CorpusImportTrigger;
  by: string | null;
}

/**
 * Imports the corpus files into `corpus_passages`, all under the corpus lock in one transaction,
 * with the audit record of an import that changed the corpus (ADR-008) in the same transaction.
 */
export async function runCorpusImport(
  db: Database<DeclarationsSchema>,
  files: CorpusFile[],
  events: EventPublisher,
  cause: CorpusImportCause,
): Promise<ImportResult> {
  return db.transaction(async (tx) => {
    await lockCorpus(tx);
    const result = await importCorpus(new PostgresCorpusStore(tx), files);
    if (!result.skipped) {
      const { version, inserted, updated, removed } = result;
      await events.record(
        tx,
        corpusImported({
          version,
          inserted,
          updated,
          removed,
          trigger: cause.trigger,
          by: cause.by,
        }),
      );
    }
    return result;
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
    private readonly events: EventPublisher,
  ) {}

  /**
   * Imports on boot, retrying a failed attempt: the import is the first query at start-up, while
   * the Temporal worker bundles its workflows on the same event loop, and a stall there can time
   * out the pool's connect. Only the last failure fails the boot.
   */
  async onApplicationBootstrap(): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.run({ trigger: 'boot', by: null });
        return;
      } catch (error) {
        if (attempt >= BOOT_IMPORT_ATTEMPTS) throw error;
        this.logger.warn(`corpus import attempt ${String(attempt)} failed; retrying`);
        await setTimeout(BOOT_IMPORT_RETRY_MS * attempt);
      }
    }
  }

  /** Imports the deployed files; `cause` (what started it) goes into the audit record. */
  async run(cause: CorpusImportCause): Promise<ImportResult> {
    const result = await runCorpusImport(this.db, this.files.load(), this.events, cause);
    if (!result.skipped) {
      this.logger.log(
        `corpus ${result.version.slice(0, 12)} imported: ${String(result.inserted)} inserted, ${String(result.updated)} updated, ${String(result.removed)} removed`,
      );
    }
    return result;
  }
}
