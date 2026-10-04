// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { MOCK_DECLARATION, MOCK_ITEM_IDS } from '../../../server/review/copilot-mock.server';
import { sourceRefResolver } from './source-refs';

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
      targetLabel: 'Assets · Plot Kisumu/Manyatta/1234 · John Kennedy Otieno',
      anchorId: `decl-item-${MOCK_ITEM_IDS.plot}`,
      target: 'item',
    });
  });

  it('says whose statement a jointly held item is, so its two chips read apart (e2e 07, 17)', () => {
    const joint = (id: string) => ({
      id,
      description: 'Residential plot with two-bedroom flat, Ruaka',
    });
    const document = {
      statements: [
        {
          personKey: 'officer',
          personName: { firstName: 'Wanjiku', surname: 'Kamau' },
          assets: [joint('a1'), { id: 'a2', description: 'Apartment, Dubai Marina' }],
        },
        {
          personKey: SPOUSE,
          personName: { firstName: 'Peter', surname: 'Kamau' },
          assets: [joint('b1')],
        },
      ],
    };
    const shared = sourceRefResolver(document);
    expect(shared(ref({ personKey: 'officer', itemId: 'a1' }))).toMatchObject({
      label: 'Residential plot with two-bedroom flat, Ruaka',
      detail: 'Wanjiku Kamau',
    });
    expect(shared(ref({ personKey: SPOUSE, itemId: 'b1' }))).toMatchObject({
      label: 'Residential plot with two-bedroom flat, Ruaka',
      detail: 'Peter Kamau',
    });
    // An item only one statement has keeps its description alone.
    expect(shared(ref({ personKey: 'officer', itemId: 'a2' }))).toMatchObject({
      label: 'Apartment, Dubai Marina',
      detail: null,
    });
  });

  it("opens a person's statement, by person key or a statement section key", () => {
    expect(resolve(ref({ sectionKey: `statement:${SPOUSE}` }))).toMatchObject({
      label: 'Lilian Akoth Otieno · Spouse',
      anchorId: `decl-statement-${SPOUSE}`,
      target: 'person',
    });
    expect(resolve(ref({ personKey: 'officer', sectionKey: 'assets' }))).toMatchObject({
      label: 'Assets · John Kennedy Otieno',
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
      label: 'Income · Lilian Akoth Otieno',
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
