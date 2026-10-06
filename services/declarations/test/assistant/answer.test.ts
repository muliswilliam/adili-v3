import { describe, expect, it } from 'vitest';

import type { AnswerOutput } from '../../src/ai-gateway/ai-gateway-client.js';
import { checkAnswer, citeKey, resolveCiteKeys } from '../../src/assistant/answer.js';

// Two corpus ids from one import: alike but for the fourth group, which a model copied as
// `...-ad90-...` for `...-ad89-...` (#622).
const S31 = '01a10c16-f860-758e-ad88-4013a18a4fa0';
const PARA8 = '01a10c16-f860-758e-ad89-0d2b8eb090a6';

const answer = (...cited: string[][]): AnswerOutput =>
  ({
    label: {} as AnswerOutput['label'],
    declined: false,
    blocks: cited.map((passageIds) => ({ text: 'Yes.', passageIds, sectionLink: null })),
    followUps: [],
  }) satisfies AnswerOutput;

describe('cite keys (#622)', () => {
  it('keys passages by their place in the list sent', () => {
    expect([0, 1, 7].map(citeKey)).toEqual(['p1', 'p2', 'p8']);
  });

  it('puts back the id of the passage each key stands for, and the answer is grounded', () => {
    const resolved = resolveCiteKeys(answer(['p1'], ['p2', 'p1']), [S31, PARA8]);

    expect(resolved.blocks.map((block) => block.passageIds)).toEqual([[S31], [PARA8, S31]]);
    expect(checkAnswer(resolved, new Set([S31, PARA8]), new Set())).toMatchObject({
      declined: false,
      passageIds: [S31, PARA8],
    });
  });

  it('keeps a key no passage has, or a miscopied id, so the answer is declined', () => {
    for (const cited of ['p3', '01a10c16-f860-758e-ad90-0d2b8eb090a6']) {
      const resolved = resolveCiteKeys(answer(['p1'], [cited]), [S31, PARA8]);
      expect(resolved.blocks[1]?.passageIds).toEqual([cited]);
      expect(checkAnswer(resolved, new Set([S31, PARA8]), new Set())).toEqual({ declined: true });
    }
  });
});
