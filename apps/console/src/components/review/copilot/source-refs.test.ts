// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MOCK_DECLARATION, MOCK_ITEM_IDS } from '../../../server/review/copilot-mock.server';
import {
  declarationAnchorId,
  HIGHLIGHT_MS,
  highlightInDeclaration,
  sourceRefResolver,
} from './source-refs';

const resolve = sourceRefResolver(MOCK_DECLARATION);
const SPOUSE = 'spouse:5b0e0000-0000-4000-8000-000000000201';
const ref = (over: Partial<Parameters<typeof resolve>[0]>) => ({
  sectionKey: null,
  personKey: null,
  itemId: null,
  fieldPath: null,
  ...over,
});

describe('sourceRefResolver', () => {
  it('names an item by its description and opens the item', () => {
    expect(resolve(ref({ personKey: 'officer', itemId: MOCK_ITEM_IDS.plot }))).toMatchObject({
      label: 'Plot Kisumu/Manyatta/1234',
      targetLabel: 'Assets · Plot Kisumu/Manyatta/1234 · John Otieno',
      anchorId: `decl-item-${MOCK_ITEM_IDS.plot}`,
      target: 'item',
    });
  });

  it("opens a person's statement, by person key or a statement section key", () => {
    expect(resolve(ref({ sectionKey: `statement:${SPOUSE}` }))).toMatchObject({
      label: 'Lilian Otieno · Spouse',
      anchorId: `decl-statement-${SPOUSE}`,
      target: 'person',
    });
    expect(resolve(ref({ personKey: 'officer', sectionKey: 'assets' }))).toMatchObject({
      label: 'Assets · John Otieno',
      anchorId: 'decl-statement-officer',
    });
  });

  it('opens a top-level section, by section key or field path', () => {
    expect(resolve(ref({ sectionKey: 'children' }))).toMatchObject({
      label: 'Dependent children',
      anchorId: 'decl-section-children',
      target: 'section',
    });
    expect(resolve(ref({ fieldPath: '/officer/employment/designation' }))).toMatchObject({
      label: 'Personal and employment details',
      anchorId: 'decl-section-personal',
      target: 'field',
    });
    expect(resolve(ref({ fieldPath: '/statements/1/income/0' }))).toMatchObject({
      label: 'Income · Lilian Otieno',
      anchorId: `decl-statement-${SPOUSE}`,
      target: 'field',
    });
  });

  it('leaves out a ref the document does not have, or one with no document', () => {
    expect(resolve(ref({ itemId: '00000000-0000-4000-8000-000000000000' }))).toBeNull();
    expect(resolve(ref({ personKey: 'child:nobody' }))).toBeNull();
    expect(resolve(ref({}))).toBeNull();
    expect(sourceRefResolver(null)(ref({ itemId: MOCK_ITEM_IDS.plot }))).toBeNull();
  });
});

describe('highlightInDeclaration', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('scrolls to the target and highlights it for a moment', () => {
    vi.useFakeTimers();
    const id = declarationAnchorId({ kind: 'item', itemId: MOCK_ITEM_IDS.plot });
    document.body.innerHTML = `<div id="${id}">Plot</div>`;
    const target = document.getElementById(id);
    if (!target) throw new Error('no target');
    const scroll = vi.fn();
    target.scrollIntoView = scroll;
    expect(highlightInDeclaration(id)).toBe(true);
    expect(scroll).toHaveBeenCalled();
    expect(target.hasAttribute('data-copilot-highlight')).toBe(true);
    expect(document.activeElement).toBe(target);
    vi.advanceTimersByTime(HIGHLIGHT_MS);
    expect(target.hasAttribute('data-copilot-highlight')).toBe(false);
  });

  it('does nothing when the pane does not show the target', () => {
    expect(highlightInDeclaration('decl-item-missing')).toBe(false);
  });
});
