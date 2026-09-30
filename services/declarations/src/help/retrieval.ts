import { sql } from 'drizzle-orm';

import type { Transaction } from '../db/transaction.js';
import type { CorpusSource, CorpusTag } from './corpus.js';
import {
  ENGLISH_SYNONYMS,
  expand,
  SWAHILI_GLOSSARY,
  SWAHILI_STOPWORDS,
  words,
} from './glossary.js';

/**
 * Deterministic retrieval over the statutory corpus and the help articles (spec 11): Postgres
 * full-text search, no AI. A question is matched as any of its words (an OR query, so a question
 * in the declarant's own words still finds passages) without the words most of the corpus has,
 * ranked by `ts_rank` over the weighted vectors (title A, tags B, text C) times how many of the
 * question's words the passage has, and boosted for each tag it shares with the section and items
 * the declarant is on. Only wordings in force on `date` count, and only published articles the
 * transaction may read: under `withPerson`, the platform's and those of the declarant's own
 * Commissions (row-level security, migration 0012).
 *
 * English questions search the `english` vectors, with the glossary's English synonyms (and the
 * English of any Swahili term in them) added.
 * Swahili questions search the `simple` vectors (Swahili article bodies) with their own words, and
 * the `english` vectors with the English words the Swahili glossary gives them.
 */

export type HelpLanguage = 'en' | 'sw';

export interface RetrievalQuery {
  question: string;
  language: HelpLanguage;
  /** The day the law is read at (`YYYY-MM-DD`). */
  date: string;
  /** Tags to boost: the section kind and the statement item types the declarant is on. */
  boost: readonly CorpusTag[];
  limit: number;
}

export interface RetrievedPassage {
  /** The corpus passage's or the help article's id. */
  id: string;
  source: CorpusSource | 'help';
  citation: string;
  title: string;
  snippet: string;
  /** The language of the snippet: Swahili only from a Swahili article body. */
  language: HelpLanguage;
  tags: CorpusTag[];
  effectiveFrom: string;
  effectiveTo: string | null;
  score: number;
}

/** Each boost tag a passage carries multiplies its rank by one more of this. */
export const TAG_BOOST = 0.5;

/** Below this score a match is noise (a stop-word-like term in a long passage). */
export const MIN_SCORE = 0.01;

/**
 * A question word in more than this share of the corpus ("declaration", "public", "officer") says
 * nothing about which passage answers it, so it is left out, unless it is all the question has.
 */
export const COMMON_SHARE = 0.25;

/** `ts_rank` normalisation 1: divide by 1 + the log of the document length. */
const RANK_NORMALISATION = 1;

const HEADLINE =
  'MaxFragments=2, MaxWords=30, MinWords=12, StartSel="", StopSel="", FragmentDelimiter=" ... "';

/** The words each vector is searched with. */
export function searchTerms(
  question: string,
  language: HelpLanguage,
): { english: string; simple: string } {
  const swahili = expand(question, SWAHILI_GLOSSARY);
  const synonyms = expand(question, ENGLISH_SYNONYMS);
  // Words only: no quotes or backslashes reach the lexemes the queries are built from.
  const clean = (parts: string[]) => words(parts.join(' ')).join(' ');
  if (language === 'en') {
    return { english: clean([question, ...synonyms, ...swahili]), simple: '' };
  }
  const stopwords = new Set(SWAHILI_STOPWORDS);
  return {
    english: clean([...swahili, ...synonyms]),
    simple: words(question)
      .filter((word) => !stopwords.has(word))
      .join(' '),
  };
}

export async function retrieve(
  tx: Transaction,
  query: RetrievalQuery,
): Promise<RetrievedPassage[]> {
  const terms = searchTerms(query.question, query.language);
  const boost = sql`${`{${query.boost.join(',')}}`}::text[]`;
  const rank = (table: string) =>
    sql.raw(
      `(ts_rank(${table}.search_en, q.en, ${String(RANK_NORMALISATION)}) + ts_rank(${table}.search_sw, q.sw, ${String(RANK_NORMALISATION)}))`,
    );
  // How many of the question's words the passage has: a passage with two of them beats one that
  // repeats a single word.
  const matched = (table: string) =>
    sql.raw(
      `(cardinality(array(select unnest(tsvector_to_array(${table}.search_en)) intersect select unnest(q.en_lexemes))) + cardinality(array(select unnest(tsvector_to_array(${table}.search_sw)) intersect select unnest(q.sw_lexemes))))`,
    );
  const boosted = (table: string) =>
    sql`${rank(table)} * ${matched(table)} * (1 + ${sql.raw(String(TAG_BOOST))} * cardinality(array(select unnest(${sql.raw(table)}.tags) intersect select unnest(${boost}))))`;
  const inForce = (table: string) =>
    sql.raw(
      `${table}.effective_from <= q.day and (${table}.effective_to is null or ${table}.effective_to > q.day)`,
    );
  const matches = (table: string) =>
    sql.raw(`(${table}.search_en @@ q.en or ${table}.search_sw @@ q.sw)`);

  const result = await tx.execute<{
    id: string;
    source: CorpusSource | 'help';
    citation: string;
    title: string;
    snippet: string;
    language: HelpLanguage;
    tags: CorpusTag[];
    effective_from: string;
    effective_to: string | null;
    score: number;
  }>(sql`
    with lexemes as (
      select
        array(select distinct lexeme from unnest(to_tsvector('english', ${terms.english}))) as en_all,
        array(select distinct lexeme from unnest(to_tsvector('simple', ${terms.simple}))) as sw_lexemes
    ),
    common as (
      select coalesce(array_agg(word), '{}') as words
      from ts_stat('select search_en from corpus_passages')
      where ndoc > ${sql.raw(String(COMMON_SHARE))} * (select count(*) from corpus_passages)
    ),
    chosen as (
      select lexemes.sw_lexemes,
        coalesce(
          nullif(array(select unnest(lexemes.en_all) except select unnest(common.words)), '{}'),
          lexemes.en_all
        ) as en_lexemes
      from lexemes, common
    ),
    q as (
      select chosen.en_lexemes, chosen.sw_lexemes,
        array_to_string(array(select quote_literal(l) from unnest(chosen.en_lexemes) l), ' | ')::tsquery as en,
        array_to_string(array(select quote_literal(l) from unnest(chosen.sw_lexemes) l), ' | ')::tsquery as sw,
        ${query.date}::date as day
      from chosen
    ),
    hits as (
      select p.id, p.source, p.citation, p.title, p.tags, p.effective_from, p.effective_to,
        p.text_en as body_en, null::text as body_sw, false as sw_hit,
        ${boosted('p')} as score
      from corpus_passages p, q
      where ${matches('p')} and ${inForce('p')}
      union all
      select a.id, 'help', 'Help: ' || a.title, a.title, a.tags, a.effective_from, a.effective_to,
        a.body_en, a.body_sw, coalesce(a.search_sw @@ q.sw and a.body_sw is not null, false),
        ${boosted('a')}
      from help_articles a, q
      where a.published and ${matches('a')} and ${inForce('a')}
    ),
    top as (
      select * from hits
      where score >= ${sql.raw(String(MIN_SCORE))}
      order by score desc, citation, effective_from
      limit ${query.limit}
    )
    select top.id, top.source, top.citation, top.title, top.tags,
      top.effective_from::text as effective_from, top.effective_to::text as effective_to,
      case
        when top.sw_hit then ts_headline('simple', top.body_sw, q.sw, ${HEADLINE})
        else ts_headline('english', top.body_en, q.en, ${HEADLINE})
      end as snippet,
      case when top.sw_hit then 'sw' else 'en' end as language,
      top.score
    from top, q
    order by top.score desc, top.citation, top.effective_from
  `);

  return result.rows.map((row) => ({
    id: row.id,
    source: row.source,
    citation: row.citation,
    title: row.title,
    snippet: row.snippet,
    language: row.language,
    tags: row.tags,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    score: row.score,
  }));
}
