import { describe, expect, it } from 'vitest';

import {
  type AnswerInput,
  type AnswerOutput,
  answerDeclarantQuestion,
} from '../../src/tasks/answer-declarant-question.js';
import { answerInput, hintsInput } from '../support/inputs.js';

const task = answerDeclarantQuestion;
const validate = (input: AnswerInput, output: AnswerOutput) => task.validate?.(input, output);

const cited = (passageIds: string[]): AnswerOutput['blocks'][number] => ({
  text: 'Declare it in your spouse’s statement.',
  passageIds,
  sectionLink: null,
});

describe('answer-declarant-question', () => {
  describe('input', () => {
    it('accepts an answer request and a hints request', () => {
      expect(task.input.safeParse(answerInput).success).toBe(true);
      expect(task.input.safeParse(hintsInput).success).toBe(true);
    });

    it('needs a question in answer mode, and none in hints mode', () => {
      expect(task.input.safeParse({ ...answerInput, question: null }).success).toBe(false);
      expect(task.input.safeParse({ ...hintsInput, question: 'What is missing?' }).success).toBe(
        false,
      );
    });

    it('refuses a section key the declaration does not have', () => {
      const context = { ...answerInput.context, sectionKey: 'statement:Jane Wanjiku' };
      expect(task.input.safeParse({ ...answerInput, context }).success).toBe(false);
    });
  });

  it('streams answers and runs hints as jobs', () => {
    expect(task.streamed?.(answerInput)).toBe(true);
    expect(task.streamed?.(hintsInput)).toBe(false);
  });

  describe('answer mode', () => {
    it('passes an answer whose every block cites passages from the input', () => {
      expect(
        validate(answerInput, { declined: false, blocks: [cited(['p-31'])], followUps: [] }),
      ).toEqual([]);
    });

    it('fails a block citing a passage the input does not hold, without naming it', () => {
      const output = { declined: false, blocks: [cited(['p-31']), cited(['p-99'])], followUps: [] };

      expect(validate(answerInput, output)).toEqual([{ kind: 'unknown-passage', block: 1 }]);
    });

    it('fails a block that cites nothing', () => {
      expect(
        validate(answerInput, { declined: false, blocks: [cited([])], followUps: [] }),
      ).toEqual([{ kind: 'uncited-block', block: 0 }]);
    });

    it('passes a decline, and fails an answer with no blocks that does not decline', () => {
      expect(validate(answerInput, { declined: true, blocks: [], followUps: [] })).toEqual([]);
      expect(validate(answerInput, { declined: false, blocks: [], followUps: [] })).toEqual([
        { kind: 'empty-answer' },
      ]);
    });
  });

  describe('hints mode', () => {
    const hint = (sectionKey: string, fieldPath: string): AnswerOutput['blocks'][number] => ({
      text: 'Add your spouse or tick "No spouse".',
      passageIds: [],
      sectionLink: { sectionKey, fieldPath },
    });
    const residuals = hintsInput.context.residuals;
    const hints = residuals.map((each) => hint(each.sectionKey, each.fieldPath));

    it('passes one hint per residual, in order, linked to it, citations optional', () => {
      expect(validate(hintsInput, { declined: false, blocks: hints, followUps: [] })).toEqual([]);
    });

    it('fails a missing hint, and a hint linked to another field', () => {
      expect(
        validate(hintsInput, { declined: false, blocks: hints.slice(1), followUps: [] }),
      ).toContainEqual({
        kind: 'hint-count',
        expected: residuals.length,
        found: residuals.length - 1,
      });
      const swapped = [hints[1], hints[0], ...hints.slice(2)].filter((each) => each !== undefined);
      expect(validate(hintsInput, { declined: false, blocks: swapped, followUps: [] })).toEqual([
        { kind: 'hint-not-for-residual', block: 0 },
        { kind: 'hint-not-for-residual', block: 1 },
      ]);
    });

    it('fails a declined hint set and follow-ups', () => {
      expect(
        validate(hintsInput, { declined: true, blocks: hints, followUps: ['Anything else?'] }),
      ).toEqual([{ kind: 'declined-hints' }, { kind: 'hint-follow-ups' }]);
    });
  });

  it('labels its output as help, not legal advice, in the answer’s language', () => {
    expect(task.disclaimer?.en).toMatch(/not legal advice/i);
    expect(task.disclaimer?.sw).toMatch(/si ushauri wa kisheria/i);
  });
});
