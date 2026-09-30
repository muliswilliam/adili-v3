import { type SQL, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import type { CorpusSource, CorpusTag } from './corpus.js';

/**
 * The help module's tables (spec 11): the statutory corpus, imported from `corpus/*.json`, and
 * the help articles Commissions and the platform write. Both carry generated `tsvector` columns
 * for Postgres full-text search (ADR-001: no other search store): `search_en` in the `english`
 * configuration and `search_sw` in `simple`, weighted title A, tags B, text C.
 *
 * Row-level security (migration 0012): the corpus is public law and has no tenant, so it has no
 * policy; help articles are tenant data, with platform articles (no tenant) readable by all.
 */

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

export const CORPUS_SOURCE_VALUES = [
  'act',
  'regs',
  'am',
] as const satisfies readonly CorpusSource[];

/**
 * The weighted vector of a title, tags and a body in a text search configuration.
 * `help_tags_text` (migration 0011) is an immutable `array_to_string`, which a generated column
 * needs.
 */
function weighted(config: 'english' | 'simple', title: SQL, tags: SQL, body: SQL): SQL {
  const vector = (value: SQL) => sql`to_tsvector('${sql.raw(config)}'::regconfig, ${value})`;
  return sql`setweight(${vector(title)}, 'A') || setweight(${vector(sql`help_tags_text(${tags})`)}, 'B') || setweight(${vector(body)}, 'C')`;
}

/**
 * One wording of a statutory passage for the period it was in force (`effective_to` exclusive),
 * as `importCorpus` plans it. `version` is the corpus version that last wrote the row.
 */
export const corpusPassages = pgTable(
  'corpus_passages',
  {
    id: uuid().primaryKey(),
    source: text({ enum: CORPUS_SOURCE_VALUES }).notNull(),
    citation: text().notNull(),
    title: text().notNull(),
    textEn: text().notNull(),
    textSw: text(),
    tags: text().array().$type<CorpusTag[]>().notNull(),
    effectiveFrom: date({ mode: 'string' }).notNull(),
    effectiveTo: date({ mode: 'string' }),
    version: text().notNull(),
    searchEn: tsvector().generatedAlwaysAs((): SQL =>
      weighted(
        'english',
        sql`${corpusPassages.title}`,
        sql`${corpusPassages.tags}`,
        sql`${corpusPassages.textEn}`,
      ),
    ),
    searchSw: tsvector().generatedAlwaysAs((): SQL =>
      weighted(
        'simple',
        sql`${corpusPassages.title}`,
        sql`${corpusPassages.tags}`,
        sql`coalesce(${corpusPassages.textSw}, '')`,
      ),
    ),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('corpus_passages_wording_key').on(table.source, table.citation, table.effectiveFrom),
    index('corpus_passages_search_en_idx').using('gin', table.searchEn),
    index('corpus_passages_search_sw_idx').using('gin', table.searchSw),
    check(
      'corpus_passages_effective_check',
      sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),
  ],
);

/**
 * Each corpus import that changed something; the latest is the corpus version in force (a
 * revert to an earlier corpus is a new import of an old version).
 */
export const corpusImports = pgTable('corpus_imports', {
  id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  version: text().notNull(),
  inserted: integer().notNull(),
  updated: integer().notNull(),
  removed: integer().notNull(),
  importedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/**
 * A help article: a Commission's own (`tenant`) or the platform's (`tenant` null), in English
 * with an optional Swahili body. Only published articles in force reach help search. `version`
 * counts saves.
 */
export const helpArticles = pgTable(
  'help_articles',
  {
    id: uuid().primaryKey(),
    tenant: text(),
    title: text().notNull(),
    bodyEn: text().notNull(),
    bodySw: text(),
    tags: text().array().$type<CorpusTag[]>().notNull(),
    effectiveFrom: date({ mode: 'string' }).notNull(),
    effectiveTo: date({ mode: 'string' }),
    published: boolean().notNull().default(false),
    version: integer().notNull().default(1),
    updatedBy: text().notNull(),
    searchEn: tsvector().generatedAlwaysAs((): SQL =>
      weighted(
        'english',
        sql`${helpArticles.title}`,
        sql`${helpArticles.tags}`,
        sql`${helpArticles.bodyEn}`,
      ),
    ),
    searchSw: tsvector().generatedAlwaysAs((): SQL =>
      weighted(
        'simple',
        sql`${helpArticles.title}`,
        sql`${helpArticles.tags}`,
        sql`coalesce(${helpArticles.bodySw}, '')`,
      ),
    ),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('help_articles_tenant_idx').on(table.tenant),
    index('help_articles_search_en_idx').using('gin', table.searchEn),
    index('help_articles_search_sw_idx').using('gin', table.searchSw),
    check(
      'help_articles_effective_check',
      sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),
  ],
);

export const helpSchema = { corpusPassages, corpusImports, helpArticles };
