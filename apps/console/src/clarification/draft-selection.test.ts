import { describe, expect, it } from 'vitest';

import {
  MOCK_DECLARATION,
  MOCK_FLAG_IDS as F,
  MOCK_ITEM_IDS as I,
  mockFlags,
} from '../server/review/copilot-mock.server';
import {
  addPick,
  draftInput,
  NO_SELECTION,
  pickable,
  pickedOf,
  removePick,
  selectionSize,
  toggleFlag,
} from './draft-selection';
import { clarificationTargets } from './targets';

const flags = mockFlags('v2');
const targets = clarificationTargets(MOCK_DECLARATION);

describe('Draft with AI selection (spec 07c FE-3)', () => {
  it('adds each flag and item once, and takes them out again', () => {
    let selection = addPick(NO_SELECTION, `flag:${F.valueChange}`);
    selection = addPick(selection, `item:${I.plot}`);
    selection = addPick(selection, `flag:${F.valueChange}`);
    expect(selection).toEqual({ flagIds: [F.valueChange], itemIds: [I.plot] });
    expect(selectionSize(selection)).toBe(2);
    expect(removePick(selection, `item:${I.plot}`)).toEqual({
      flagIds: [F.valueChange],
      itemIds: [],
    });
    expect(toggleFlag(toggleFlag(NO_SELECTION, F.growth), F.growth)).toEqual(NO_SELECTION);
  });

  it('offers the open flags and the items not picked yet', () => {
    const selection = { flagIds: [F.valueChange], itemIds: [I.plot] };
    const options = pickable(selection, flags, targets);
    // Late filing is reviewed: nothing left to ask about.
    expect(options.flags.map((flag) => flag.id)).toEqual([F.acquisition, F.growth, F.foreign]);
    expect(options.items.map((target) => target.ref.itemId)).not.toContain(I.plot);
    expect(options.items.every((target) => target.kind === 'item')).toBe(true);
    expect(options.items.find((target) => target.ref.itemId === I.shop)?.item).toEqual({
      category: 'income',
      description: 'Profit from a cereals shop in Kibuye market',
    });
  });

  it('is review.yaml CopilotDraftInput, leaving out picks the case no longer has', () => {
    const selection = {
      flagIds: [F.growth, 'f1a90000-0000-4000-8000-0000000000ff'],
      itemIds: [I.plot, '1e2d3c4b-0000-4000-8000-0000000000ff'],
    };
    expect(pickedOf(selection, flags, targets).items).toHaveLength(1);
    expect(draftInput(selection, flags, targets, 'sw')).toEqual({
      flagIds: [F.growth],
      itemRefs: [
        {
          sectionKey: 'statement:officer',
          personKey: 'officer',
          itemId: I.plot,
          requirement: null,
        },
      ],
      language: 'sw',
    });
  });
});
