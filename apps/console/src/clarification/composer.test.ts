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
      { key: 'item-1', target: null, requirement: null, text: '', ai: null, edited: false },
    ]);
    expect(emptyComposer().opening).toBeNull();
  });

  it('adds and removes items', () => {
    let state = composerReducer(emptyComposer(), { type: 'add' });
    expect(state.items.map((item) => item.key)).toEqual(['item-1', 'item-2']);
    state = composerReducer(state, { type: 'remove', key: 'item-1' });
    expect(state.items.map((item) => item.key)).toEqual(['item-2']);
  });

  it('opens a saved draft with its items on their targets', () => {
    const state = draftComposer(
      [
        {
          sectionKey: 'statement:officer',
          personKey: 'officer',
          itemId: MOCK_ITEM_IDS.plot,
          requirement: 'explain-discrepancy',
          text: 'Explain the change.',
        },
      ],
      targets,
    );
    expect(state.items).toEqual([
      {
        key: 'item-1',
        target: plot,
        requirement: 'explain-discrepancy',
        text: 'Explain the change.',
        ai: null,
        edited: false,
      },
    ]);
  });

  it('opens a draft without items empty, so the reviewer adds one', () => {
    expect(draftComposer([], targets).items).toEqual([]);
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
        edited: false,
      },
    ]);
    expect(state.opening).toEqual({
      text: 'Thank you for your declaration.',
      ai: AI,
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
    expect(state.opening).toEqual({ text: 'Dear officer,', ai: AI, edited: true });
    expect(filled().items[0]?.edited).toBe(false);
  });

  it('discards the opening paragraph', () => {
    const state = composerReducer(emptyComposer(), { type: 'insert', draft, targets });
    expect(composerReducer(state, { type: 'discard-opening' }).opening).toBeNull();
  });

  it('inserts the reviewer’s own items too, unlabelled', () => {
    const state = composerReducer(emptyComposer(), {
      type: 'insert',
      draft: { label: null, opening: null, items: [{ ...drafted, requirement: null }] },
      targets,
    });
    expect(state.items[0]).toMatchObject({ target: plot, requirement: null, ai: null });
  });
});

describe('composerProblems', () => {
  it('requires at least one item to issue (S19)', () => {
    const none = composerReducer(emptyComposer(), { type: 'remove', key: 'item-1' });
    expect(composerProblems(none, 'issue')).toEqual({ none: true, items: {}, any: true });
    expect(composerProblems(none, 'save').any).toBe(false);
  });

  it('requires a target, a requirement and the text of every item (S19)', () => {
    let state = composerReducer(filled(), { type: 'add' });
    state = composerReducer(state, { type: 'text', key: 'item-1', text: '  ' });
    state = composerReducer(state, { type: 'requirement', key: 'item-1', requirement: null });
    expect(composerProblems(state, 'issue')).toEqual({
      none: false,
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
      items: [
        {
          sectionKey: 'statement:officer',
          personKey: 'officer',
          itemId: MOCK_ITEM_IDS.plot,
          requirement: 'explain-discrepancy',
          text: 'Explain the change.',
        },
      ],
    });
  });
});
