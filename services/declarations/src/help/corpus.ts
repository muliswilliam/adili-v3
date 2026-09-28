import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

/**
 * The legal corpus the help search and the declarant assistant cite (spec 11, BE-1): the Act's
 * Part IV, definitions and schedules, and the Regulations, as structured passages with citations,
 * effective dates and tags. The data lives in `corpus/*.json` (see its README for provenance);
 * this module validates it and plans its import, so a re-import is idempotent and an amended
 * passage supersedes the old one by effective date. Storage is the help module's (#325).
 */

/**
 * Tags a passage may carry: the capture section kinds it helps with (for retrieval boosts) and
 * the topics it covers. A tag outside this list is refused, so search boosts stay predictable.
 */
export const CORPUS_TAGS = [
  // Capture section kinds (declarations.yaml SectionKey without the person key).
  'bio',
  'household',
  'statement',
  'other',
  // Topics.
  'access',
  'administrative-action',
  'assets',
  'biennial',
  'clarification',
  'complaints',
  'compliance-report',
  'confidentiality',
  'conflict-of-interest',
  'deadline',
  'declaration',
  'definition',
  'dependent-child',
  'directorship',
  'dual-citizenship',
  'employment',
  'final',
  'foreign',
  'gifts',
  'income',
  'income-period',
  'initial',
  'joint',
  'liabilities',
  'material-change',
  'membership',
  'offence',
  'pending-cases',
  'recusal',
  'registrable-interest',
  'responsible-commission',
  'spouse',
  'statement-date',
  'submission',
] as const;

export type CorpusTag = (typeof CORPUS_TAGS)[number];

const IsoDate = z.iso.date();

const CorpusFilePassageSchema = z.strictObject({
  citation: z.string().min(1),
  title: z.string().min(1),
  /** English text as published. */
  text: z.string().min(1),
  /** Swahili text where an official one exists; none does yet. */
  textSw: z.string().min(1).optional(),
  tags: z.array(z.enum(CORPUS_TAGS)).min(1),
  /** When this wording took effect, if later than the instrument's commencement. */
  effectiveFrom: IsoDate.optional(),
  /** Transcription notes, e.g. an error in the published text kept verbatim. */
  notes: z.string().optional(),
});

const CorpusFileSchema = z.strictObject({
  /** `am` (Administrative Mechanisms) is reserved until EACC's text is available. */
  source: z.enum(['act', 'regs', 'am']),
  title: z.string().min(1),
  /** Akoma Ntoso FRBR URI of the expression transcribed. */
  frbr: z.string().min(1),
  /** The instrument's commencement. */
  effectiveFrom: IsoDate,
  passages: z.array(CorpusFilePassageSchema).min(1),
});

export type CorpusFile = z.infer<typeof CorpusFileSchema>;
export type CorpusSource = CorpusFile['source'];

/** A statutory passage as stored: one wording of one citation, for the period it was in force. */
export interface CorpusPassage {
  source: CorpusSource;
  citation: string;
  title: string;
  textEn: string;
  textSw: string | null;
  tags: CorpusTag[];
  effectiveFrom: string;
  /** Exclusive: the day the next wording took effect; null while current. */
  effectiveTo: string | null;
}

const DEFAULT_DIR = join(import.meta.dirname, '..', '..', 'corpus');

/** Reads and validates every corpus file, in file name order. */
export function loadCorpus(dir: string = DEFAULT_DIR): CorpusFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const parsed = CorpusFileSchema.safeParse(JSON.parse(readFileSync(join(dir, name), 'utf8')));
      if (!parsed.success) throw new Error(`${name}: ${z.prettifyError(parsed.error)}`);
      return parsed.data;
    });
}

/** A content hash of the corpus: the same data always has the same version. */
export function corpusVersion(files: CorpusFile[]): string {
  return createHash('sha256').update(JSON.stringify(files)).digest('hex');
}

export interface ImportPlan {
  insert: CorpusPassage[];
  /** Stored passages with new content or a new end date, keyed as stored. */
  update: CorpusPassage[];
  unchanged: number;
}

const key = ({
  source,
  citation,
  effectiveFrom,
}: Pick<CorpusPassage, 'source' | 'citation' | 'effectiveFrom'>) =>
  `${source}\u0000${citation}\u0000${effectiveFrom}`;

/**
 * What an import changes. A passage is one wording of a citation from its effective date: new
 * ones are inserted, changed ones (a transcription correction) updated in place, and every
 * wording of a citation ends where the next begins. Stored passages the files no longer hold are
 * left as they are.
 */
export function planImport(files: CorpusFile[], stored: CorpusPassage[]): ImportPlan {
  const incoming = new Map<string, CorpusPassage>();
  for (const file of files) {
    for (const passage of file.passages) {
      const next: CorpusPassage = {
        source: file.source,
        citation: passage.citation,
        title: passage.title,
        textEn: passage.text,
        textSw: passage.textSw ?? null,
        tags: passage.tags,
        effectiveFrom: passage.effectiveFrom ?? file.effectiveFrom,
        effectiveTo: null,
      };
      if (incoming.has(key(next))) {
        throw new Error(`${next.citation} is in the corpus twice from ${next.effectiveFrom}`);
      }
      incoming.set(key(next), next);
    }
  }

  const byKey = new Map(stored.map((passage) => [key(passage), passage]));
  const merged = new Map([...byKey, ...incoming]);
  // Each wording of a citation ends where the next one begins.
  const byCitation = Map.groupBy(
    merged.values(),
    (passage) => `${passage.source}\u0000${passage.citation}`,
  );
  const ends = new Map<string, string | null>();
  for (const wordings of byCitation.values()) {
    const ordered = wordings.toSorted((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    ordered.forEach((passage, index) =>
      ends.set(key(passage), ordered[index + 1]?.effectiveFrom ?? null),
    );
  }

  const plan: ImportPlan = { insert: [], update: [], unchanged: 0 };
  for (const [passageKey, passage] of merged) {
    const current = byKey.get(passageKey);
    const next = { ...passage, effectiveTo: ends.get(passageKey) ?? null };
    if (!current) plan.insert.push(next);
    else if (sameContent(current, next)) plan.unchanged += 1;
    else plan.update.push(next);
  }
  return plan;
}

function sameContent(a: CorpusPassage, b: CorpusPassage): boolean {
  return (
    a.title === b.title &&
    a.textEn === b.textEn &&
    a.textSw === b.textSw &&
    a.effectiveTo === b.effectiveTo &&
    a.tags.join() === b.tags.join()
  );
}

/** Where imported passages and the corpus version live; the help module's table implements it. */
export interface CorpusStore {
  currentVersion(): Promise<string | null>;
  passages(): Promise<CorpusPassage[]>;
  /** Applies a plan and records the version, all or nothing. */
  apply(plan: ImportPlan, version: string): Promise<void>;
}

export interface ImportResult {
  version: string;
  /** True when this version was already imported and nothing was done. */
  skipped: boolean;
  inserted: number;
  updated: number;
  unchanged: number;
}

/** Imports the corpus once per version; importing the same data again does nothing. */
export async function importCorpus(store: CorpusStore, files: CorpusFile[]): Promise<ImportResult> {
  const version = corpusVersion(files);
  if ((await store.currentVersion()) === version) {
    return { version, skipped: true, inserted: 0, updated: 0, unchanged: 0 };
  }
  const plan = planImport(files, await store.passages());
  await store.apply(plan, version);
  return {
    version,
    skipped: false,
    inserted: plan.insert.length,
    updated: plan.update.length,
    unchanged: plan.unchanged,
  };
}

/** A store in memory, for tests and for the import's dry runs. */
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
    const updates = new Map(plan.update.map((passage) => [key(passage), passage]));
    this.rows = [...this.rows.map((row) => updates.get(key(row)) ?? row), ...plan.insert].sort(
      (a, b) =>
        a.source.localeCompare(b.source) ||
        a.citation.localeCompare(b.citation) ||
        a.effectiveFrom.localeCompare(b.effectiveFrom),
    );
    this.version = version;
    return Promise.resolve();
  }
}
