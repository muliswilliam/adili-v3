import type { AiLabelDetails } from '@adili/ui';
import { describe, expect, it } from 'vitest';

import { MOCK_DECLARATION, MOCK_ITEM_IDS } from '../server/review/copilot-mock.server';
import {
  composerProblems,
  composerReducer,
  composerToInput,
  draftComposer,
  emptyComposer,
  type ComposerState,
} from './composer';
import { clarificationTargets } from './targets';

const targets = clarificationTargets(MOCK_DECLARATION);
const JOB = '0199a000-0000-7000-8000-00000000d0b1';
const plot = targets.find((target) => target.ref.itemId === MOCK_ITEM_IDS.plot);
const bio = targets.find((target) => target.key === 'section:bio');
const AI: AiLabelDetails = {
  task: 'draft-clarification',
  provider: 'anthropic',
  model: 'claude',
  promptVersion: 1,
  generatedAt: '2026-10-01T08:00:00Z',
};

function filled(): ComposerState {
  let state = emptyComposer();
  const [first] = state.items;
  if (!first || !plot) throw new Error('fixture');
  state = composerReducer(state, { type: 'target', key: first.key, target: plot });
  state = composerReducer(state, {
    type: 'requirement',
    key: first.key,
    requirement: 'explain-discrepancy',
  });
  return composerReducer(state, { type: 'text', key: first.key, text: 'Explain the change.' });
}

describe('composer state', () => {
  it('starts a new clarification with one blank item', () => {
    expect(emptyComposer().items).toEqual([
      {
        key: 'item-1',
        target: null,
        requirement: null,
        text: '',
        ai: null,
        aiJobId: null,
        edited: false,
      },
    ]);
    expect(emptyComposer().opening).toBeNull();
  });

  it('adds and removes items', () => {
    let state = composerReducer(emptyComposer(), { type: 'add' });
    expect(state.items.map((item) => item.key)).toEqual(['item-1', 'item-2']);
    state = composerReducer(state, { type: 'remove', key: 'item-1' });
    expect(state.items.map((item) => item.key)).toEqual(['item-2']);
  });

  it('opens a saved draft with its items on their targets and its opening paragraph', () => {
    const state = draftComposer(
      {
        items: [
          {
            sectionKey: 'statement:officer',
            personKey: 'officer',
            itemId: MOCK_ITEM_IDS.plot,
            requirement: 'explain-discrepancy',
            text: 'Explain the change.',
          },
        ],
        opening: 'Thank you for your declaration.',
      },
      targets,
    );
    // Saved, it is the reviewer's text: no AI label any more.
    expect(state.opening).toEqual({
      text: 'Thank you for your declaration.',
      ai: null,
      aiJobId: null,
      edited: false,
    });
    expect(state.items).toEqual([
      {
        key: 'item-1',
        target: plot,
        requirement: 'explain-discrepancy',
        text: 'Explain the change.',
        ai: null,
        aiJobId: null,
        edited: false,
      },
    ]);
  });

  it('opens a draft without items empty, so the reviewer adds one', () => {
    expect(draftComposer({ items: [], opening: null }, targets)).toMatchObject({
      items: [],
      opening: null,
    });
  });
});

describe('Draft with AI insertion (spec 07c FE-3)', () => {
  const drafted = {
    sectionKey: 'statement:officer',
    personKey: 'officer',
    itemId: MOCK_ITEM_IDS.plot,
    requirement: 'explain-discrepancy' as const,
    text: 'The plot is valued 150% higher. Explain the change.',
  };
  const draft = {
    label: AI,
    jobId: JOB,
    opening: 'Thank you for your declaration.',
    items: [
      {
        sectionKey: 'statement:officer',
        personKey: 'officer',
        itemId: MOCK_ITEM_IDS.plot,
        requirement: 'explain-discrepancy' as const,
        text: 'The plot is valued 150% higher. Explain the change.',
      },
    ],
  };

  it('replaces a lone blank item and labels what it inserts', () => {
    const state = composerReducer(emptyComposer(), { type: 'insert', draft, targets });
    expect(state.items).toEqual([
      {
        key: 'item-2',
        target: plot,
        requirement: 'explain-discrepancy',
        text: 'The plot is valued 150% higher. Explain the change.',
        ai: AI,
        aiJobId: JOB,
        edited: false,
      },
    ]);
    expect(state.opening).toEqual({
      text: 'Thank you for your declaration.',
      ai: AI,
      aiJobId: JOB,
      edited: false,
    });
  });

  it('appends after the reviewer’s own items', () => {
    const state = composerReducer(filled(), { type: 'insert', draft, targets });
    expect(state.items.map((item) => [item.key, item.ai === null])).toEqual([
      ['item-1', true],
      ['item-2', false],
    ]);
  });

  it('marks an AI item edited once changed, and keeps the reviewer’s own unmarked', () => {
    let state = composerReducer(emptyComposer(), { type: 'insert', draft, targets });
    state = composerReducer(state, { type: 'text', key: 'item-2', text: 'Explain the value.' });
    expect(state.items[0]?.edited).toBe(true);
    state = composerReducer(state, { type: 'opening', text: 'Dear officer,' });
    expect(state.opening).toEqual({ text: 'Dear officer,', ai: AI, aiJobId: JOB, edited: true });
    expect(filled().items[0]?.edited).toBe(false);
  });

  it('replaces an untouched drafted opening, but never one the reviewer wrote or saved', () => {
    const again = { ...draft, opening: 'Asante kwa tamko lako.' };
    let state = composerReducer(emptyComposer(), { type: 'insert', draft, targets });
    state = composerReducer(state, { type: 'insert', draft: again, targets });
    expect(state.opening?.text).toBe('Asante kwa tamko lako.');

    state = composerReducer(state, { type: 'opening', text: 'Dear officer,' });
    state = composerReducer(state, { type: 'insert', draft, targets });
    expect(state.opening).toEqual({ text: 'Dear officer,', ai: AI, aiJobId: JOB, edited: true });

    const saved = draftComposer({ items: [], opening: 'Saved opening.' }, targets);
    expect(composerReducer(saved, { type: 'insert', draft, targets }).opening?.text).toBe(
      'Saved opening.',
    );
  });

  it('discards the opening paragraph', () => {
    const state = composerReducer(emptyComposer(), { type: 'insert', draft, targets });
    expect(composerReducer(state, { type: 'discard-opening' }).opening).toBeNull();
  });

  it('inserts the reviewer’s own items too, unlabelled', () => {
    const state = composerReducer(emptyComposer(), {
      type: 'insert',
      draft: {
        label: null,
        jobId: null,
        opening: null,
        items: [{ ...drafted, requirement: null }],
      },
      targets,
    });
    expect(state.items[0]).toMatchObject({
      target: plot,
      requirement: null,
      ai: null,
      aiJobId: null,
    });
  });
});

describe('AI-assisted text stays labelled (ADR-007)', () => {
  const draft = {
    label: AI,
    jobId: JOB,
    opening: 'Thank you for your declaration.',
    items: [
      {
        sectionKey: 'statement:officer',
        personKey: 'officer',
        itemId: MOCK_ITEM_IDS.plot,
        requirement: 'explain-discrepancy' as const,
        text: 'Explain the change.',
      },
    ],
  };

  it('saves the drafting job with each drafted item and the opening, also once edited', () => {
    let state = composerReducer(filled(), { type: 'insert', draft, targets });
    state = composerReducer(state, { type: 'text', key: 'item-2', text: 'Explain the value.' });
    state = composerReducer(state, { type: 'opening', text: 'Dear declarant,' });
    const input = composerToInput(state);
    expect(input.items.map((item) => item.aiJobId)).toEqual([null, JOB]);
    expect(input.openingAiJobId).toBe(JOB);
  });

  it('keeps the drafting job of a saved draft, labelled without the details it did not keep', () => {
    const state = draftComposer(
      {
        items: [{ ...draft.items[0], aiJobId: JOB } as never],
        opening: 'Thank you.',
        openingAiJobId: JOB,
      },
      targets,
    );
    expect(state.items[0]).toMatchObject({ ai: null, aiJobId: JOB });
    expect(state.opening).toMatchObject({ ai: null, aiJobId: JOB });
    expect(composerToInput(state)).toMatchObject({
      items: [{ aiJobId: JOB }],
      openingAiJobId: JOB,
    });
  });

  it('drops the job with the opening once the reviewer clears it', () => {
    let state = composerReducer(emptyComposer(), { type: 'insert', draft, targets });
    state = composerReducer(state, { type: 'opening', text: '  ' });
    expect(composerToInput(state)).toMatchObject({ opening: null, openingAiJobId: null });
  });
});

describe('composerProblems', () => {
  it('requires at least one item to issue (S19)', () => {
    const none = composerReducer(emptyComposer(), { type: 'remove', key: 'item-1' });
    expect(composerProblems(none, 'issue')).toEqual({
      none: true,
      opening: null,
      items: {},
      any: true,
    });
    expect(composerProblems(none, 'save').any).toBe(false);
  });

  it('requires a target, a requirement and the text of every item (S19)', () => {
    let state = composerReducer(filled(), { type: 'add' });
    state = composerReducer(state, { type: 'text', key: 'item-1', text: '  ' });
    state = composerReducer(state, { type: 'requirement', key: 'item-1', requirement: null });
    expect(composerProblems(state, 'issue')).toEqual({
      none: false,
      opening: null,
      items: {
        'item-1': { requirement: 'required', text: 'required' },
        'item-2': { target: 'required', requirement: 'required', text: 'required' },
      },
      any: true,
    });
  });

  it('keeps the text within 1,000 characters', () => {
    const state = composerReducer(filled(), {
      type: 'text',
      key: 'item-1',
      text: 'x'.repeat(1001),
    });
    expect(composerProblems(state, 'issue').items['item-1']).toEqual({ text: 'too-long' });
  });

  it('saves a draft with blank items left out, but checks the started ones', () => {
    let state = composerReducer(filled(), { type: 'add' });
    expect(composerProblems(state, 'save').any).toBe(false);
    state = composerReducer(state, { type: 'target', key: 'item-2', target: bio ?? null });
    expect(composerProblems(state, 'save').items).toEqual({
      'item-2': { requirement: 'required', text: 'required' },
    });
  });
});

describe('composerToInput', () => {
  it('is review.yaml ClarificationInput, blank items left out', () => {
    const state = composerReducer(filled(), { type: 'add' });
    expect(composerToInput(state)).toEqual({
      opening: null,
      openingAiJobId: null,
      items: [
        {
          sectionKey: 'statement:officer',
          personKey: 'officer',
          itemId: MOCK_ITEM_IDS.plot,
          requirement: 'explain-discrepancy',
          text: 'Explain the change.',
          aiJobId: null,
        },
      ],
    });
  });
});

describe('the opening paragraph', () => {
  const withOpening = (text: string) =>
    composerReducer(filled(), {
      type: 'insert',
      draft: { label: AI, jobId: JOB, opening: text, items: [] },
      targets,
    });

  it('is saved and issued trimmed, and a blank one as none', () => {
    expect(composerToInput(withOpening('  Thank you.  ')).opening).toBe('Thank you.');
    const blanked = composerReducer(withOpening('Thank you.'), { type: 'opening', text: '   ' });
    expect(composerToInput(blanked).opening).toBeNull();
  });

  it('keeps to 800 characters', () => {
    expect(composerProblems(withOpening('x'.repeat(800)), 'issue')).toMatchObject({
      opening: null,
      any: false,
    });
    expect(composerProblems(withOpening('x'.repeat(801)), 'save')).toMatchObject({
      opening: 'too-long',
      any: true,
    });
  });
});
