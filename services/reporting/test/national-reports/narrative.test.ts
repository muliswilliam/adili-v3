import { describe, expect, it } from 'vitest';

import {
  narrativeOf,
  type Paragraph,
  paragraphsOf,
  saveSection,
} from '../../src/national-reports/narrative.js';

/**
 * S11 narrative storage: a section's text maps onto stored paragraphs so unchanged paragraphs keep
 * their ids and labels (spec 09b's AI-draft flag, aggregate references, candidates) and edits
 * clear the AI-draft label.
 */
describe('NCR narrative paragraphs', () => {
  let next = 0;
  const newId = () => `new-${String((next += 1))}`;

  const drafted = (id: string, position: number, text: string): Paragraph => ({
    id,
    section: 'findings',
    position,
    text,
    aiDraft: true,
    aggregateRefs: [`national.initial.rate`],
    candidateIds: [`candidate-${id}`],
  });

  it('splits a section at blank lines, trimming and dropping empty paragraphs', () => {
    expect(paragraphsOf('  First.\n\n\nSecond line one.\nline two.\r\n \r\nThird.  \n\n')).toEqual([
      'First.',
      'Second line one.\nline two.',
      'Third.',
    ]);
    expect(paragraphsOf('   ')).toEqual([]);
  });

  it('joins each section in position order', () => {
    expect(
      narrativeOf([
        { ...drafted('b', 1, 'Second.'), section: 'overview' },
        { ...drafted('a', 0, 'First.'), section: 'overview' },
        drafted('c', 0, 'Finding.'),
      ]),
    ).toEqual({ overview: 'First.\n\nSecond.', findings: 'Finding.', recommendations: '' });
  });

  it('keeps unchanged paragraphs with their labels wherever they move, and adds new ones', () => {
    const stored = [drafted('a', 0, 'Alpha.'), drafted('b', 1, 'Beta.')];

    const saved = saveSection('findings', stored, 'New.\n\nAlpha.\n\nBeta.', newId);

    expect(saved.map((p) => [p.id, p.position, p.aiDraft])).toEqual([
      ['new-1', 0, false],
      ['a', 1, true],
      ['b', 2, true],
    ]);
    expect(saved[1]).toMatchObject({
      aggregateRefs: ['national.initial.rate'],
      candidateIds: ['candidate-a'],
    });
    expect(saved[0]).toMatchObject({ aggregateRefs: [], candidateIds: [] });
  });

  it('an edited paragraph keeps its id and references and loses the AI-draft label', () => {
    const stored = [drafted('a', 0, 'Alpha.'), drafted('b', 1, 'Beta.')];

    const saved = saveSection('findings', stored, 'Alpha, edited.\n\nBeta.', newId);

    expect(saved).toEqual([
      { ...drafted('a', 0, 'Alpha, edited.'), aiDraft: false },
      drafted('b', 1, 'Beta.'),
    ]);
  });

  it('drops paragraphs no longer there and leaves other sections alone', () => {
    const stored = [
      drafted('a', 0, 'Alpha.'),
      drafted('b', 1, 'Beta.'),
      { ...drafted('o', 0, 'Overview.'), section: 'overview' as const },
    ];

    expect(saveSection('findings', stored, 'Beta.', newId)).toEqual([drafted('b', 0, 'Beta.')]);
    expect(saveSection('findings', stored, '', newId)).toEqual([]);
  });
});
