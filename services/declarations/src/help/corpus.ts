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
  'declaration',
  'definition',
  'dependent-child',
  'directorship',
  'dual-citizenship',
  'due-date',
  'employment',
  'filing',
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
] as const;

export type CorpusTag = (typeof CORPUS_TAGS)[number];

const IsoDate = z.iso.date();

/**
 * Citations: `Act s.31`, `Act s.2 "family"`, `Act First Schedule, note 13` (or `introduction`,
 * `guidelines`, `para. 8`, `solemn declaration`), `Act Second Schedule` (`, item 15`),
 * `Regs r.21`, `Regs r.2 "gift"`; `AM` is reserved for the Administrative Mechanisms (#426).
 */
const CITATION =
  /^(?:Act s\.\d+(?: "[^"]+")?|Regs r\.\d+(?: "[^"]+")?|Act First Schedule, (?:introduction|guidelines|note \d+|para\. \d+|solemn declaration)|Act Second Schedule(?:, item \d+)?|AM .+)$/u;

const CorpusFilePassageSchema = z.strictObject({
  citation: z.string().regex(CITATION, 'is not a corpus citation'),
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
  /** The corpus version that last wrote this passage. */
  version: string;
}

const DEFAULT_DIR = join(import.meta.dirname, '..', '..', 'corpus');

/** Reads and validates every corpus file, in file name order. */
export function loadCorpus(dir: string = DEFAULT_DIR): CorpusFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      let json: unknown;
      try {
        json = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      } catch (error) {
        throw new Error(`${name}: not valid JSON (${(error as Error).message})`, { cause: error });
      }
      const parsed = CorpusFileSchema.safeParse(json);
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
  /** Stored passages with new content or a new end date. */
  update: CorpusPassage[];
  /** Stored passages the files no longer hold, e.g. an amendment entered with the wrong date. */
  remove: CorpusPassage[];
  unchanged: number;
}

type PassageId = Pick<CorpusPassage, 'source' | 'citation' | 'effectiveFrom'>;

/** One wording: a citation of a source from its effective date. */
export const passageKey = ({ source, citation, effectiveFrom }: PassageId) =>
  JSON.stringify([source, citation, effectiveFrom]);

const citationKey = ({ source, citation }: PassageId) => JSON.stringify([source, citation]);

/** Stored order: by source, citation, then effective date. */
export function byWording(a: PassageId, b: PassageId): number {
  return (
    a.source.localeCompare(b.source) ||
    a.citation.localeCompare(b.citation) ||
    a.effectiveFrom.localeCompare(b.effectiveFrom)
  );
}

/** The files' passages as stored, each with its effective date and no end date yet. */
export function toPassages(files: CorpusFile[], version: string): CorpusPassage[] {
  return files.flatMap((file) =>
    file.passages.map((passage) => ({
      source: file.source,
      citation: passage.citation,
      title: passage.title,
      textEn: passage.text,
      textSw: passage.textSw ?? null,
      tags: passage.tags,
      effectiveFrom: passage.effectiveFrom ?? file.effectiveFrom,
      effectiveTo: null,
      version,
    })),
  );
}

/**
 * What an import changes. The files are the whole statutory corpus: a wording they hold is
 * inserted, or updated in place when its content changed (a transcription correction); a stored
 * wording they no longer hold is removed; and every wording of a citation ends where the next
 * begins. Help articles are not statutory and not part of this.
 */
export function planImport(
  files: CorpusFile[],
  stored: CorpusPassage[],
  version: string,
): ImportPlan {
  const incoming = new Map<string, CorpusPassage>();
  for (const wording of toPassages(files, version)) {
    if (incoming.has(passageKey(wording))) {
      throw new Error(`${wording.citation} is in the corpus twice from ${wording.effectiveFrom}`);
    }
    incoming.set(passageKey(wording), wording);
  }

  // Each wording of a citation ends where the next one begins.
  const effectiveToByKey = new Map<string, string | null>();
  for (const wordings of Map.groupBy(incoming.values(), citationKey).values()) {
    const ordered = wordings.toSorted(byWording);
    ordered.forEach((wording, index) =>
      effectiveToByKey.set(passageKey(wording), ordered[index + 1]?.effectiveFrom ?? null),
    );
  }

  const storedByKey = new Map(stored.map((passage) => [passageKey(passage), passage]));
  const plan: ImportPlan = {
    insert: [],
    update: [],
    remove: stored.filter((passage) => !incoming.has(passageKey(passage))),
    unchanged: 0,
  };
  for (const [key, wording] of incoming) {
    const next = { ...wording, effectiveTo: effectiveToByKey.get(key) ?? null };
    const current = storedByKey.get(key);
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
  /**
   * Applies a plan and records the version, all or nothing. The plan is built outside this call,
   * so a database store must lock the corpus (or re-check the current version) inside the
   * transaction, or two concurrent imports could both apply plans made against stale rows.
   */
  apply(plan: ImportPlan, version: string): Promise<void>;
}

export interface ImportResult {
  version: string;
  /** True when this version was already imported and nothing was done. */
  skipped: boolean;
  inserted: number;
  updated: number;
  removed: number;
  unchanged: number;
}

/** Imports the corpus once per version; importing the same data again does nothing. */
export async function importCorpus(store: CorpusStore, files: CorpusFile[]): Promise<ImportResult> {
  const version = corpusVersion(files);
  if ((await store.currentVersion()) === version) {
    return { version, skipped: true, inserted: 0, updated: 0, removed: 0, unchanged: 0 };
  }
  const plan = planImport(files, await store.passages(), version);
  await store.apply(plan, version);
  return {
    version,
    skipped: false,
    inserted: plan.insert.length,
    updated: plan.update.length,
    removed: plan.remove.length,
    unchanged: plan.unchanged,
  };
}
