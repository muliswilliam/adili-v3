import { describe, expect, it } from 'vitest';

import { preparePrompt } from '../../src/policy/prompt.js';
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

    it('takes a declaration type the declarations service has, or none', () => {
      const typed = (declarationType: unknown) =>
        task.input.safeParse({
          ...answerInput,
          context: { ...answerInput.context, declarationType },
        }).success;
      expect(['initial', 'biennial', 'final', null].map(typed)).toEqual([true, true, true, true]);
      expect(typed('annual')).toBe(false);
    });

    const withResiduals = (residuals: unknown[]) =>
      task.input.safeParse({ ...hintsInput, context: { ...hintsInput.context, residuals } })
        .success;

    it('takes as many residuals as a hint set has hints, twenty, and no more', () => {
      const residual = hintsInput.context.residuals[0];
      expect(withResiduals(Array.from({ length: 20 }, () => residual))).toBe(true);
      expect(withResiduals(Array.from({ length: 21 }, () => residual))).toBe(false);
    });

    it('takes the rule ids and field paths the completeness check reports', () => {
      const residual = (ruleId: string, fieldPath: string) =>
        withResiduals([{ sectionKey: 'statement:officer', ruleId, fieldPath }]);
      // Its own rules' kebab-case codes, and the schema's issues under their ajv keywords.
      const reported = [
        ['spouse-required', '/spouses'],
        ['nil-or-items-required', '/assets'],
        ['none-conflicts-with-items', '/children/none'],
        ['required', '/assets/1/change/explanation'],
        ['required', '/employment/designation'],
        ['value-change-25', '/assets/10/value'],
        ['minLength', '/assets/0/description'],
        ['minLength', '/birth/place'],
        ['minItems', '/income'],
        ['maxItems', '/assets'],
        ['exclusiveMinimum', '/assets/0/joint/sharePercent'],
        ['additionalProperties', '/assets/0/ownership'],
        ['required', '/registrableInterests/directorships/0/change/kind'],
        ['required', '/spouses/items/0/separationDate'],
        ['type', ''],
      ];
      expect(reported.map(([ruleId = '', fieldPath = '']) => residual(ruleId, fieldPath))).toEqual(
        reported.map(() => true),
      );
    });

    it('refuses rule ids and field paths that could carry a value', () => {
      const residual = (ruleId: string, fieldPath: string) =>
        withResiduals([{ sectionKey: 'statement:officer', ruleId, fieldPath }]);
      expect(
        [
          ['required', '/vehicles/0/KDA 123X'],
          ['required', '/assets/0/kda123x value'],
          ['required', '/AB1234567'],
          ['required', '/assets/01'],
          ['required', 'assets/0'],
          ['required', '/statements/Jane Wanjiku/assets'],
          ['Required for KDA 123X', '/assets'],
          ['required: 28765432', '/assets'],
          ['required_', '/assets'],
          ['min Length', '/assets'],
          ['minLength!', '/assets'],
          ['25-percent-change', '/assets'],
          ['MinLength', '/assets'],
        ].map(([ruleId = '', fieldPath = '']) => residual(ruleId, fieldPath)),
      ).toEqual(Array.from({ length: 13 }, () => false));
    });
  });

  it('streams answers and runs hints as jobs', () => {
    expect(task.streamed?.(answerInput)).toBe(true);
    expect(task.streamed?.(hintsInput)).toBe(false);
  });

  it('cuts an answer off at 2,048 output tokens, well inside the stream deadline, and hints at 8,192', () => {
    const limit = (input: AnswerInput) =>
      preparePrompt(task, task.currentPromptVersion, input, 'model').request.maxOutputTokens;
    expect(limit(answerInput)).toBe(2048);
    expect(limit(hintsInput)).toBe(8192);
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

    it("links a block to the declarant's section or a residual, never a place the model made up", () => {
      const linked = (sectionLink: AnswerOutput['blocks'][number]['sectionLink']) =>
        validate(answerInput, {
          declined: false,
          blocks: [{ ...cited(['p-31']), sectionLink }],
          followUps: [],
        });

      // The section the declarant is on, or a residual's own section and field.
      expect(linked({ sectionKey: 'statement:officer', fieldPath: null })).toEqual([]);
      expect(linked({ sectionKey: 'statement:officer', fieldPath: '/assets/1/value' })).toEqual([]);
      // Another section, or a field no residual names.
      expect(linked({ sectionKey: 'household', fieldPath: null })).toEqual([
        { kind: 'unknown-link', block: 0 },
      ]);
      expect(linked({ sectionKey: 'statement:officer', fieldPath: '/assets/7/value' })).toEqual([
        { kind: 'unknown-link', block: 0 },
      ]);
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

    it('passes twenty hints for twenty residuals, the most a hint set has', () => {
      const input = {
        ...hintsInput,
        context: {
          ...hintsInput.context,
          residuals: Array.from({ length: 20 }, (_, i) => ({
            sectionKey: 'statement:officer',
            ruleId: 'required',
            fieldPath: `/assets/${i}/value`,
          })),
        },
      };
      const output = {
        declined: false,
        blocks: input.context.residuals.map((each) => hint(each.sectionKey, each.fieldPath)),
        followUps: [],
      };

      expect(task.input.safeParse(input).success).toBe(true);
      expect(task.output.safeParse(output).success).toBe(true);
      expect(validate(input, output)).toEqual([]);
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
