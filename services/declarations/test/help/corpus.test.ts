import { describe, expect, it } from 'vitest';

import {
  CORPUS_TAGS,
  type CorpusFile,
  corpusVersion,
  importCorpus,
  InMemoryCorpusStore,
  loadCorpus,
  planImport,
} from '../../src/help/corpus.js';

const committed = loadCorpus();

function file(overrides: Partial<CorpusFile> = {}): CorpusFile {
  return {
    source: 'act',
    title: 'Conflict of Interest Act, 2025 (Act No. 11 of 2025)',
    frbr: '/akn/ke/act/2025/11/eng@2025-08-05',
    effectiveFrom: '2025-08-19',
    passages: [
      {
        citation: 'Act s.34',
        title: 'Timelines for declaration',
        text: '(1) A public officer shall, within thirty days of appointment ...',
        tags: ['deadline', 'initial'],
      },
      {
        citation: 'Act s.35',
        title: 'Clarification',
        text: '(1) Upon receipt of the declaration made under section 31 ...',
        tags: ['clarification'],
      },
    ],
    ...overrides,
  };
}

describe('the committed corpus', () => {
  const passages = committed.flatMap((corpusFile) =>
    corpusFile.passages.map((passage) => ({ ...passage, source: corpusFile.source })),
  );

  it('holds the Act (Part IV, definitions, schedules) and the Regulations', () => {
    expect(committed.map((corpusFile) => [corpusFile.source, corpusFile.effectiveFrom])).toEqual([
      ['act', '2025-08-19'],
      ['regs', '2026-03-26'],
    ]);
    const citations = passages.map((passage) => passage.citation);
    expect(citations).toEqual(
      expect.arrayContaining([
        'Act s.31',
        'Act s.34',
        'Act s.40',
        'Act s.2 "family"',
        'Act First Schedule, note 13',
        'Act First Schedule, para. 8',
        'Act Second Schedule, item 15',
        'Regs r.1',
        'Regs r.21',
        'Regs r.34',
      ]),
    );
    expect(passages.filter((passage) => passage.source === 'regs')).toHaveLength(34);
  });

  it('gives every passage a citation, title, English text and at least one known tag', () => {
    const tags = new Set<string>(CORPUS_TAGS);
    const incomplete = passages.filter(
      (passage) =>
        !passage.citation ||
        !passage.title ||
        passage.text.length < 10 ||
        passage.tags.length === 0 ||
        passage.tags.some((tag) => !tags.has(tag)),
    );

    expect(incomplete.map((passage) => passage.citation)).toEqual([]);
  });

  it('cites each passage once', () => {
    const citations = passages.map((passage) => passage.citation);

    expect(citations.length).toBe(new Set(citations).size);
  });

  it('keeps the text as published: no ligatures, page furniture or stray whitespace', () => {
    const suspect = passages.filter(
      (passage) =>
        /[ﬀ-ﬆ]/u.test(passage.text) ||
        /\(Act No\. 11 of 2025\)$|Legal Notice 53 of 2026\)$/u.test(passage.text) ||
        passage.text !== passage.text.replace(/\s+/gu, ' ').trim(),
    );

    expect(suspect.map((passage) => passage.citation)).toEqual([]);
  });

  it('quotes the law’s own words where the form relies on them', () => {
    const text = (citation: string) =>
      passages.find((passage) => passage.citation === citation)?.text ?? '';

    expect(text('Act s.31')).toContain(
      '“material change” means— (a) at least twenty-five percent increase or decrease',
    );
    expect(text('Act First Schedule, para. 8')).toContain(
      'For an initial declaration, the period is the year ending on the statement date.',
    );
    expect(text('Regs r.21')).toBe(
      'A material change shall, for purposes of section 31(4) of the Act, be specified by the declarant in paragraph 9 of the declaration form set out in the First Schedule to the Act.',
    );
  });

  it('has a version that changes only when the corpus does', () => {
    expect(corpusVersion(committed)).toMatch(/^[0-9a-f]{64}$/u);
    expect(corpusVersion(structuredClone(committed))).toBe(corpusVersion(committed));
    expect(corpusVersion([file()])).not.toBe(corpusVersion(committed));
  });
});

describe('importCorpus', () => {
  it('inserts every passage once and records the version', async () => {
    const store = new InMemoryCorpusStore();

    const result = await importCorpus(store, [file()]);

    expect(result).toEqual({
      version: corpusVersion([file()]),
      skipped: false,
      inserted: 2,
      updated: 0,
      unchanged: 0,
    });
    expect(store.version).toBe(corpusVersion([file()]));
    expect(store.rows.map((row) => [row.citation, row.effectiveFrom, row.effectiveTo])).toEqual([
      ['Act s.34', '2025-08-19', null],
      ['Act s.35', '2025-08-19', null],
    ]);
    expect(store.rows[0]).toMatchObject({
      source: 'act',
      textSw: null,
      tags: ['deadline', 'initial'],
    });
  });

  it('does nothing when the same corpus is imported again', async () => {
    const store = new InMemoryCorpusStore();
    await importCorpus(store, [file()]);
    const before = structuredClone(store.rows);

    const result = await importCorpus(store, [file()]);

    expect(result).toMatchObject({ skipped: true, inserted: 0, updated: 0 });
    expect(store.rows).toEqual(before);
  });

  it('supersedes a passage when an amended one takes effect, keeping the old for its period', async () => {
    const store = new InMemoryCorpusStore();
    await importCorpus(store, [file()]);
    const amended = file();
    amended.passages.push({
      citation: 'Act s.34',
      title: 'Timelines for declaration',
      text: '(1) A public officer shall, within sixty days of appointment ...',
      tags: ['deadline', 'initial'],
      effectiveFrom: '2027-01-01',
    });

    const result = await importCorpus(store, [amended]);

    expect(result).toMatchObject({ skipped: false, inserted: 1, updated: 1, unchanged: 1 });
    expect(
      store.rows
        .filter((row) => row.citation === 'Act s.34')
        .map((row) => [row.effectiveFrom, row.effectiveTo, row.textEn.includes('sixty days')]),
    ).toEqual([
      ['2025-08-19', '2027-01-01', false],
      ['2027-01-01', null, true],
    ]);
  });

  it('corrects a passage in place when its text changes for the same effective date', async () => {
    const store = new InMemoryCorpusStore();
    await importCorpus(store, [file()]);
    const corrected = file();
    const [first] = corrected.passages;
    if (!first) throw new Error('the file has passages');
    first.text = `${first.text} (corrected)`;

    const result = await importCorpus(store, [corrected]);

    expect(result).toMatchObject({ inserted: 0, updated: 1, unchanged: 1 });
    expect(store.rows).toHaveLength(2);
    expect(store.rows[0]?.textEn).toMatch(/\(corrected\)$/u);
  });

  it('imports the committed corpus, and again as a no-op', async () => {
    const store = new InMemoryCorpusStore();

    const first = await importCorpus(store, committed);
    const second = await importCorpus(store, committed);

    expect(first.inserted).toBe(committed.flatMap((corpusFile) => corpusFile.passages).length);
    expect(second.skipped).toBe(true);
  });
});

describe('planImport', () => {
  it('refuses a file that cites a passage twice for the same date', () => {
    const duplicated = file();
    const [first] = duplicated.passages;
    if (!first) throw new Error('the file has passages');
    duplicated.passages.push({ ...first, title: 'Again' });

    expect(() => planImport([duplicated], [])).toThrow(
      'Act s.34 is in the corpus twice from 2025-08-19',
    );
  });
});
