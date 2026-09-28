import {
  byWording,
  type CorpusPassage,
  type CorpusStore,
  type ImportPlan,
  passageKey,
} from './corpus.js';

/** A corpus store in memory, for tests until the help module's table (#325) implements one. */
export class InMemoryCorpusStore implements CorpusStore {
  version: string | null = null;
  rows: CorpusPassage[] = [];

  currentVersion(): Promise<string | null> {
    return Promise.resolve(this.version);
  }

  passages(): Promise<CorpusPassage[]> {
    return Promise.resolve(structuredClone(this.rows));
  }

  apply(plan: ImportPlan, version: string): Promise<void> {
    const removed = new Set(plan.remove.map(passageKey));
    const updates = new Map(plan.update.map((passage) => [passageKey(passage), passage]));
    this.rows = [
      ...this.rows
        .filter((row) => !removed.has(passageKey(row)))
        .map((row) => updates.get(passageKey(row)) ?? row),
      ...plan.insert,
    ].sort(byWording);
    this.version = version;
    return Promise.resolve();
  }
}
