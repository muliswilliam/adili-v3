import { describe, expect, it } from 'vitest';

import { TaggedAnswerReader } from '../../src/tasks/tagged-answer.js';

/** Feeds the chunks to a reader: the prose it streamed, and what it read at the end. */
function read(...chunks: string[]) {
  const reader = new TaggedAnswerReader();
  const deltas = chunks.map((chunk) => reader.push(chunk));
  const end = reader.end();
  return { prose: [...deltas, end.delta].join(''), answer: end.answer };
}

const ANSWER = [
  '<block>Declare your spouse’s income in their own statement. <cite ids="p-31,p-note-2"/>',
  ' <link section="statement:officer" field="/income"/></block>\n',
  '<block>The statement date is 1 November. <cite ids="p-34"/></block>\n',
  '<followup>Do I declare my children’s savings?</followup>',
].join('');

describe('tagged answer reader', () => {
  it('streams the blocks’ prose without tags and reads blocks, citations, links and follow-ups', () => {
    const { prose, answer } = read(ANSWER);

    expect(prose).toBe(
      'Declare your spouse’s income in their own statement.\n\nThe statement date is 1 November.',
    );
    expect(answer).toEqual({
      ok: true,
      answer: {
        declined: false,
        blocks: [
          {
            text: 'Declare your spouse’s income in their own statement.',
            passageIds: ['p-31', 'p-note-2'],
            sectionLink: { sectionKey: 'statement:officer', fieldPath: '/income' },
          },
          { text: 'The statement date is 1 November.', passageIds: ['p-34'], sectionLink: null },
        ],
        followUps: ['Do I declare my children’s savings?'],
      },
    });
  });

  it('streams the same prose whatever the chunk boundaries, holding back partial tags', () => {
    const whole = read(ANSWER);
    for (const size of [1, 2, 3, 7, 13]) {
      const chunks = ANSWER.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g')) ?? [];
      const reader = new TaggedAnswerReader();
      const deltas = chunks.map((chunk) => reader.push(chunk));
      const end = reader.end();

      expect([...deltas, end.delta].join(''), `chunks of ${size}`).toBe(whole.prose);
      expect(end.answer).toEqual(whole.answer);
      expect(deltas.join(''), `no tag text streamed in chunks of ${size}`).not.toMatch(/[<>]/);
    }
  });

  it('holds back an identifier token until it is whole, so it can be restored', () => {
    const reader = new TaggedAnswerReader();

    expect(reader.push('<block>Ask [[PER')).toBe('Ask');
    expect(reader.push('SON_1]] about it')).toBe(' [[PERSON_1]] about it');
  });

  it('reads a lone <declined/> as a decline that streams nothing', () => {
    expect(read(' <declined/>\n')).toEqual({
      prose: '',
      answer: { ok: true, answer: { declined: true, blocks: [], followUps: [] } },
    });
  });

  it('reads a link without a field as a link to the section', () => {
    const { answer } = read(
      '<block>See household. <cite ids="a"/><link section="household"/></block>',
    );

    expect(answer.ok && answer.answer.blocks[0]?.sectionLink).toEqual({
      sectionKey: 'household',
      fieldPath: null,
    });
  });

  describe('refuses what breaks the grammar, saying where but not what was written', () => {
    const problems = (text: string) => {
      const { answer } = read(text);
      return answer.ok ? [] : answer.problems;
    };

    it.each([
      ['text outside a block', 'Hello <block>x <cite ids="a"/></block>', 'text-outside-block'],
      ['a block without a citation', '<block>Uncited.</block>', 'uncited-block'],
      ['a block cited twice', '<block>x <cite ids="a"/><cite ids="b"/></block>', 'cite-repeated'],
      ['an empty citation', '<block>x <cite ids=" "/></block>', 'uncited-block'],
      [
        'a block linked twice',
        '<block>x <cite ids="a"/><link section="bio"/><link section="bio"/></block>',
        'link-repeated',
      ],
      [
        'a link without a section',
        '<block>x <cite ids="a"/><link field="/a"/></block>',
        'link-invalid',
      ],
      ['a block left open', '<block>x <cite ids="a"/>', 'unclosed-block'],
      ['a block in a block', '<block>x <block>y</block></block>', 'nested-block'],
      ['an unknown tag', '<block>x <cite ids="a"/><b>y</b></block>', 'unknown-tag'],
      [
        'a decline with an answer',
        '<declined/><block>x <cite ids="a"/></block>',
        'declined-with-answer',
      ],
      ['nothing at all', '  ', 'empty-answer'],
      ['an empty block', '<block><cite ids="a"/></block>', 'empty-block'],
    ])('%s', (_, text, kind) => {
      expect(problems(text).map((problem) => problem.kind)).toContain(kind);
    });

    it('names the block a problem is in', () => {
      expect(problems('<block>a <cite ids="x"/></block><block>b</block>')).toEqual([
        { kind: 'uncited-block', block: 1 },
      ]);
    });
  });
});
